// EYAD 3D — files: model import (GLB / glTF / OBJ / STL / FBX), .eyad 3D
// projects (save / open / autosave / recovery), GLB export, image & video
// renders and hand-off to EYAD IMAGE / EYAD VIDEO.
import * as THREE from '../../vendor/three/three.module.js';
import { h, uid, formatBytes, sleep } from '../core/dom.js';
import { toast, dialog, formDialog, promptDialog, progressDialog, alertDialog } from '../core/ui.js';
import { getSettings } from '../core/settings.js';
import { chooseFiles } from '../core/open.js';
import { detectFile, sanitizeFilename, downloadBlob, baseName, extOf, pickFiles, loadImageFile } from '../core/files.js';
import { writeEyad, EYAD_VERSION, num, str, bool, oneOf, color } from '../core/eyad.js';
import { readZip } from '../core/zip.js';
import { saveProject, loadProjectBlob, getProject, touchProject, putRecovery, listRecovery, delRecovery, putHandoff, takeHandoff } from '../core/db.js';
import { ROUTES } from '../core/shell.js';
import { prepareImported, createLight, LIGHTS, boundsOf, editorObjects, isAux, isCam, createCamera, camOf, ensureAreaLights } from './objects.js';
import { validateAnim } from './anim.js';
import { defaultSettings, ENVS } from './viewport.js';
import { WebMWriter } from './webm.js';

export const MAX_MODEL = 200 * 1024 * 1024;
export const MODEL_EXTS = ['glb', 'gltf', 'obj', 'stl', 'fbx'];
export const ACCEPT_MODELS = '.glb,.gltf,.obj,.stl,.fbx,model/gltf-binary,model/gltf+json';
const MAX_TEXTURE = 64 * 1024 * 1024;

// ------------------------------------------------------------------ loaders (lazy)

let loaders = null;
async function getLoaders() {
  if (loaders) return loaders;
  const [{ GLTFLoader }, { OBJLoader }, { STLLoader }] = await Promise.all([
    import('../../vendor/three/addons/loaders/GLTFLoader.js'),
    import('../../vendor/three/addons/loaders/OBJLoader.js'),
    import('../../vendor/three/addons/loaders/STLLoader.js'),
  ]);
  // Imported files are untrusted: never let a model make the page fetch
  // anything except data it carries itself (data: / blob: URLs).
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (/^(data|blob):/i.test(url) ? url : 'data:application/octet-stream;base64,'));
  loaders = { manager, gltf: new GLTFLoader(manager), obj: new OBJLoader(manager), stl: new STLLoader(manager) };
  return loaders;
}

/** Sniff the model format from bytes (the extension is only a hint). */
function sniffModel(head, ext) {
  const ascii = String.fromCharCode(...head.slice(0, 32));
  if (ascii.startsWith('glTF')) return 'glb';
  if (ascii.startsWith('Kaydara FBX Binary')) return 'fbx';
  if (/^\s*\{/.test(ascii) && ext === 'gltf') return 'gltf';
  if (/^\s*;\s*FBX/i.test(ascii) || (ext === 'fbx' && /FBXHeaderExtension/.test(ascii))) return 'fbx';
  if (ext === 'stl') return 'stl';
  if (ext === 'obj') return 'obj';
  if (ext === 'fbx') return 'fbx';
  if (/^\s*\{/.test(ascii)) return 'gltf';
  if (/^solid\s/i.test(ascii)) return 'stl';
  return null;
}

/** glTF JSON must be self-contained: every buffer / image URI has to be embedded. */
function checkGltfJson(json) {
  if (!json || typeof json !== 'object' || !json.asset) throw new Error('This is not a glTF 2.0 file (the "asset" block is missing).');
  if (String(json.asset.version || '').split('.')[0] !== '2') throw new Error('Only glTF 2.0 is supported (this file says version ' + String(json.asset.version).slice(0, 8) + ').');
  const bad = [];
  for (const b of json.buffers || []) if (b.uri && !/^data:/i.test(b.uri)) bad.push(String(b.uri).slice(0, 80));
  for (const im of json.images || []) if (im.uri && !/^data:/i.test(im.uri)) bad.push(String(im.uri).slice(0, 80));
  if (bad.length) throw new Error(`This .gltf refers to ${bad.length} external file${bad.length > 1 ? 's' : ''} (${bad.slice(0, 3).join(', ')}). Export it as a single .glb or a .gltf with embedded data and try again.`);
  const req = (json.extensionsRequired || []).filter((e) => !['KHR_materials_unlit', 'KHR_texture_transform', 'KHR_mesh_quantization', 'KHR_materials_emissive_strength', 'KHR_lights_punctual', 'KHR_materials_clearcoat', 'KHR_materials_transmission', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_sheen', 'KHR_materials_volume', 'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_materials_dispersion', 'EXT_texture_webp', 'EXT_texture_avif', 'EXT_mesh_gpu_instancing'].includes(e));
  if (req.length) throw new Error('This model needs a compression extension EYAD 3D does not include: ' + req.join(', ').slice(0, 120) + '. Re-export it without Draco / Meshopt / KTX2 compression.');
}
function glbJson(buf) {
  const dv = new DataView(buf);
  if (dv.byteLength < 20 || dv.getUint32(0, true) !== 0x46546C67) throw new Error('Not a binary glTF (.glb) file.');
  if (dv.getUint32(4, true) !== 2) throw new Error('Only glTF 2.0 .glb files are supported.');
  const len = dv.getUint32(12, true), type = dv.getUint32(16, true);
  if (type !== 0x4E4F534A || 20 + len > dv.byteLength) throw new Error('The .glb file is damaged (bad JSON chunk).');
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len)));
}

/** Parse a model file into { object, animations, format }. Never executes content. */
export async function loadModelFile(file) {
  if (!file || !file.size) throw new Error('The file is empty.');
  if (file.size > MAX_MODEL) throw new Error(`This model is ${formatBytes(file.size)} — the limit is 200 MB.`);
  const ext = extOf(file.name);
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const fmt = sniffModel(head, ext);
  if (!fmt) throw new Error('Unrecognised 3D format. EYAD 3D opens .glb, .gltf (embedded), .obj, .stl and .fbx.');
  const L = await getLoaders();
  let object, animations = [];
  if (fmt === 'glb' || fmt === 'gltf') {
    const buf = await file.arrayBuffer();
    let json;
    try { json = fmt === 'glb' ? glbJson(buf) : JSON.parse(new TextDecoder().decode(buf)); } catch (e) { throw new Error(e instanceof SyntaxError ? 'The glTF JSON is damaged.' : e.message); }
    checkGltfJson(json);
    const gltf = await L.gltf.parseAsync(fmt === 'glb' ? buf : new TextDecoder().decode(buf), '');
    object = gltf.scene || gltf.scenes?.[0];
    animations = gltf.animations || [];
    if (!object) throw new Error('The glTF file has no scene.');
    prepareImported(object, { convert: false });
  } else if (fmt === 'obj') {
    const text = await file.text();
    object = L.obj.parse(text);
    prepareImported(object);
  } else if (fmt === 'stl') {
    const geo = L.stl.parse(await file.arrayBuffer());
    if (!geo.attributes.position || !geo.attributes.position.count) throw new Error('The STL file has no triangles.');
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: geo.hasColors ? 0xffffff : 0xb9b4aa, roughness: 0.5, metalness: 0.05, vertexColors: !!geo.hasColors });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = baseName(file.name);
    mesh.rotation.x = -Math.PI / 2; // STL files are usually Z-up
    object = new THREE.Group(); object.add(mesh);
    prepareImported(object, { convert: false });
  } else if (fmt === 'fbx') {
    const { FBXLoader } = await import('../../vendor/three/addons/loaders/FBXLoader.js');
    const fbx = new FBXLoader(L.manager).parse(await file.arrayBuffer(), '');
    object = fbx; animations = fbx.animations || [];
    prepareImported(object);
  }
  let tris = 0;
  object.traverse((n) => { if (n.isMesh && n.geometry) { const g = n.geometry; tris += g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3; } });
  if (!tris) throw new Error('No visible geometry was found in this file.');
  // a model exported from EYAD 3D carries editor tags on its nodes; an import is one new object
  object.traverse((n) => { if (n.userData) for (const k of Object.keys(n.userData)) if (/^eyad/.test(k) || k === 'cam') delete n.userData[k]; });
  object.name = sanitizeFilename(baseName(file.name), 'Model');
  object.userData = { ...(object.userData || {}), eyadId: uid('o'), eyadKind: 'model', eyadSrc: fmt };
  return { object, animations, format: fmt, triangles: Math.round(tris) };
}

/** Put a model on the ground at the origin and bring extreme sizes into a workable range. */
export function placeModel(object) {
  object.updateWorldMatrix(true, true);
  let box = boundsOf(object);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  let note = '';
  if (maxDim > 0 && (maxDim > 40 || maxDim < 0.05)) {
    const k = 2 / maxDim;
    object.scale.multiplyScalar(k);
    note = `Scaled ×${k < 0.01 ? k.toExponential(1) : +k.toFixed(3)} to fit the scene`;
    object.updateWorldMatrix(true, true);
    box = boundsOf(object);
  }
  const c = box.getCenter(new THREE.Vector3());
  object.position.x -= c.x; object.position.z -= c.z; object.position.y -= box.min.y;
  return note;
}

// ------------------------------------------------------------------ routing

export async function openDialog(app) {
  const files = await chooseFiles({ title: 'Open', accept: '.eyad,' + ACCEPT_MODELS, multiple: true, camera: false });
  if (files.length) handleFiles(app, files);
}
export async function importDialog(app) {
  const files = await chooseFiles({ title: 'Import model', accept: ACCEPT_MODELS, multiple: true, camera: false, recent: false });
  if (files.length) handleFiles(app, files);
}

export async function handleFiles(app, files) {
  for (const f of files) {
    const name = sanitizeFilename(f.name);
    let info = { kind: 'unknown' };
    try { info = await detectFile(f); } catch (e) { /* treat as unknown */ }
    if (info.kind === 'eyad') { await openEyadFile(app, f); continue; }
    if (info.kind === 'image' && app.selectedMaterial()) { await applyTextureFile(app, f); continue; }
    if (info.kind === 'image' || info.kind === 'psd') { toast(`${name} is an image — opening it in EYAD IMAGE.`); const id = await putHandoff([f]); location.href = ROUTES.image + '?handoff=' + id; return; }
    if (info.kind === 'video' || info.kind === 'audio' || info.kind === 'prproj') { toast(`${name} is media — opening it in EYAD VIDEO.`); const id = await putHandoff([f]); location.href = ROUTES.video + '?handoff=' + id; return; }
    await importModel(app, f);
  }
}

export async function importModel(app, f) {
  const name = sanitizeFilename(f.name);
  const prog = progressDialog('Importing ' + name, { cancellable: false });
  prog.set(null, 'Reading ' + formatBytes(f.size) + '…');
  try {
    await sleep(30);
    const res = await loadModelFile(f);
    prog.set(0.9, 'Placing in the scene…');
    const note = placeModel(res.object);
    app.addObject(res.object, { label: 'Import ' + res.object.name, clips: res.animations });
    app.viewport.frame(res.object);
    toast(`Imported ${res.object.name} — ${res.triangles.toLocaleString()} triangles${res.animations.length ? `, ${res.animations.length} animation clip${res.animations.length > 1 ? 's' : ''}` : ''}`, { type: 'ok', detail: note });
  } catch (e) {
    await alertDialog('Could not import model', `“${name}” was not imported.`, { detail: e.message || String(e) });
  } finally { prog.close(); }
}

// ------------------------------------------------------------------ textures

export async function pickTexture(app) {
  const files = await pickFiles({ accept: 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp' });
  if (files[0]) await applyTextureFile(app, files[0]);
}
export async function applyTextureFile(app, f) {
  try {
    const info = await detectFile(f);
    if (info.kind !== 'image' || info.format === 'svg') throw new Error('Use a PNG, JPEG or WebP image as a texture.');
    if (f.size > MAX_TEXTURE) throw new Error('Texture images are limited to 64 MB.');
    let canvas = await loadImageFile(f);
    const max = Math.min(4096, app.viewport.renderer.capabilities.maxTextureSize || 4096);
    if (canvas.width > max || canvas.height > max) {
      const s = max / Math.max(canvas.width, canvas.height);
      const c = document.createElement('canvas'); c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
      c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height); canvas = c;
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(8, app.viewport.renderer.capabilities.getMaxAnisotropy());
    tex.name = baseName(f.name);
    app.setMaterialMap(tex);
  } catch (e) { toast(e.message || 'That image could not be used as a texture.', { type: 'error' }); }
}

// ------------------------------------------------------------------ project (.eyad kind "3d")

async function exporter() { const { GLTFExporter } = await import('../../vendor/three/addons/exporters/GLTFExporter.js'); return new GLTFExporter(); }

/** GLB of the editable content (meshes / models; lights are stored in JSON). */
async function contentGLB(app, { forExport = false } = {}) {
  const content = app.viewport.content;
  const all = editorObjects(content);
  for (const o of all) {
    if (isAux(o)) continue;
    o.userData.eyadHidden = !o.visible;
    o.userData.eyadName = o.name; // glTF node names get sanitised on load; keep the real one
    o.traverse((n) => { if (n.isMesh) for (const m of Array.isArray(n.material) ? n.material : [n.material]) if (m) { if (m.wireframe) m.userData.eyadWireframe = true; else delete m.userData.eyadWireframe; if (m.flatShading) m.userData.eyadFlat = true; else delete m.userData.eyadFlat; } });
  }
  // lights / cameras parented to content are saved as JSON, so they sit out the glTF export
  const aux = all.filter(isAux).map((o) => ({ o, parent: o.parent, i: o.parent.children.indexOf(o) }));
  const findable = (clip) => clip.tracks.every((t) => { const nn = THREE.PropertyBinding.parseTrackName(t.name).nodeName; return !nn || THREE.PropertyBinding.findNode(content, nn); });
  const clips = app.clips.filter((c) => c.root.parent === content && (!forExport || c.root.visible)).map((c) => c.clip).filter(findable);
  const exp = await exporter();
  const prevName = content.name;
  content.userData.eyadContent = true;
  if (forExport) content.name = sanitizeFilename(app.name, 'Scene');
  try {
    if (forExport && !content.children.some((o) => o.visible)) throw new Error('There is nothing visible to export.');
    if (aux.length) { app.viewport.hold = true; for (const a of aux) a.parent.remove(a.o); }
    const res = await exp.parseAsync(content, { binary: true, onlyVisible: forExport, trs: true, animations: clips, maxTextureSize: 4096 });
    return new Uint8Array(res);
  } finally {
    content.name = prevName;
    if (aux.length) {
      for (const a of aux) { a.parent.add(a.o); a.parent.children.splice(a.parent.children.indexOf(a.o), 1); a.parent.children.splice(Math.min(a.i, a.parent.children.length), 0, a.o); }
      app.viewport.hold = false; app.viewport.invalidate();
    }
  }
}

const parentIdOf = (o) => (o.parent && o.parent.userData && o.parent.userData.eyadId) || null;
function lightsJSON(app) {
  return app.viewport.allLights().map((l) => ({
    id: l.userData.eyadId, name: l.name, type: l.userData.eyadLight, color: '#' + l.color.getHexString(), intensity: l.intensity,
    pos: l.position.toArray(), quat: l.quaternion.toArray(), scale: l.scale.toArray(), visible: l.visible, castShadow: !!l.castShadow, locked: !!l.userData.eyadLocked, parent: parentIdOf(l),
    distance: l.distance ?? 0, decay: l.decay ?? 2, angle: l.angle ?? 0, penumbra: l.penumbra ?? 0, groundColor: l.groundColor ? '#' + l.groundColor.getHexString() : null,
    width: l.width ?? null, height: l.height ?? null,
  }));
}
function camerasJSON(app) {
  return app.viewport.allObjects().filter(isCam).map((c) => ({
    id: c.userData.eyadId, name: c.name, pos: c.position.toArray(), quat: c.quaternion.toArray(), scale: c.scale.toArray(), visible: c.visible, locked: !!c.userData.eyadLocked, parent: parentIdOf(c), lens: camOf(c),
  }));
}

export function documentJSON(app) {
  const v = app.viewport;
  // while looking through a scene camera the free view is the one saved on the way in
  const sv = v.viewCam && v.savedView ? v.savedView : null;
  const cam = sv ? { type: sv.type, fov: sv.fov, pos: sv.pos, target: sv.target, zoom: sv.zoom, orthoHalf: sv.orthoHalf } : { type: v.camera.isOrthographicCamera ? 'ortho' : 'persp', fov: v.persp.fov, pos: v.camera.position.toArray(), target: v.orbit.target.toArray(), zoom: v.camera.zoom, orthoHalf: v.orthoHalf || 3 };
  return {
    format: 'eyad-3d', version: 1, name: app.name,
    settings: { ...app.settings, camera: cam },
    lights: lightsJSON(app),
    cameras: camerasJSON(app),
    anim: app.anim,
    bookmarks: app.bookmarks,
    order: v.content.children.map((o) => o.userData.eyadId),
    selected: app.selected?.userData?.eyadId || null,
  };
}

async function buildEyad(app) {
  const glb = await contentGLB(app);
  const thumb = await app.viewport.renderPNG(480, 300, { supersample: false }).catch(() => null);
  const blob = await writeEyad({ kind: '3d', name: app.name, document: documentJSON(app), thumb, created: app.rec.created, assets: [{ path: 'assets/scene.glb', blob: new Blob([glb], { type: 'model/gltf-binary' }), compress: true }] });
  return { blob, thumb };
}

/** Read a 3D .eyad (core/eyad.js readEyad only knows image / video / vector, so this mirrors its checks). */
export async function readEyad3D(blob) {
  let zip;
  try { zip = await readZip(blob); } catch (e) { throw new Error('This is not a valid .eyad project. ' + e.message); }
  const m = zip.get('manifest.json'), d = zip.get('document.json');
  if (!m || !d) throw new Error('This .eyad project is missing its manifest or document.');
  let manifest, doc;
  try { manifest = JSON.parse(await m.text()); } catch (e) { throw new Error('The project manifest is not valid JSON.'); }
  if (!manifest || manifest.format !== 'eyad') throw new Error('The file is a ZIP archive but not an EYAD project.');
  if (typeof manifest.version !== 'number' || manifest.version > EYAD_VERSION) throw new Error(`This project was made by a newer version of EYAD STUDIO (format v${manifest.version}).`);
  if (manifest.kind !== '3d') return { manifest, other: true };
  if (d.size > 64 * 1024 * 1024) throw new Error('Project document is too large to open safely.');
  try { doc = JSON.parse(await d.text()); } catch (e) { throw new Error('The project document is damaged (invalid JSON).'); }
  if (!doc || typeof doc !== 'object') throw new Error('The project document is empty.');
  const g = zip.get('assets/scene.glb');
  if (g && g.size > 1024 * 1024 * 1024) throw new Error('The scene inside this project is too large to open.');
  const glb = g ? await (await g.blob('model/gltf-binary')).arrayBuffer() : null;
  return { manifest, doc, glb };
}

const ID_RE = /^[a-z0-9]{1,40}$/i;
const vec3 = (v, d, min = -1e6, max = 1e6) => (Array.isArray(v) && v.length >= 3 ? v.slice(0, 3).map((x, i) => num(x, d[i], min, max)) : d.slice());
function quatFrom(q, v) { if (Array.isArray(v) && v.length >= 4) { q.fromArray(v.slice(0, 4).map((x) => num(x, 0, -1, 1))); if (q.lengthSq() < 1e-6) q.identity(); q.normalize(); } }
function validateSettings(s) {
  const d = defaultSettings();
  if (!s || typeof s !== 'object') return d;
  const e = s.env || {}, g = s.ground || {}, c = s.camera || {}, r = s.render || {}, vv = s.video || {}, sn = s.snap || {};
  const vec = (v, dd) => (Array.isArray(v) && v.length === 3 ? v.map((x, i) => num(x, dd[i], -1e6, 1e6)) : dd);
  return {
    env: { lighting: oneOf(e.lighting, ENVS.map((x) => x[0]), d.env.lighting), intensity: num(e.intensity, 1, 0, 10), background: oneOf(e.background, ['gradient', 'solid', 'transparent', 'environment'], d.env.background), color: color(e.color, d.env.color), top: color(e.top, d.env.top), bottom: color(e.bottom, d.env.bottom), blur: num(e.blur, d.env.blur, 0, 1), toneMapping: oneOf(e.toneMapping, ['aces', 'agx', 'neutral', 'none'], 'aces'), exposure: num(e.exposure, 1, 0.05, 8) },
    ground: { mode: oneOf(g.mode, ['shadow', 'solid', 'none'], 'shadow'), color: color(g.color, d.ground.color), opacity: num(g.opacity, 0.35, 0, 1), grid: bool(g.grid, true) },
    shadows: bool(s.shadows, true),
    snap: { on: bool(sn.on, false), move: num(sn.move, 0.25, 0.001, 100), rotate: num(sn.rotate, 15, 0.1, 180), scale: num(sn.scale, 0.1, 0.001, 10) },
    camera: { type: oneOf(c.type, ['persp', 'ortho'], 'persp'), fov: num(c.fov, 40, 1, 170), pos: vec(c.pos, d.camera.pos), target: vec(c.target, d.camera.target), zoom: num(c.zoom, 1, 0.001, 1000), orthoHalf: num(c.orthoHalf, 3, 0.001, 1e6) },
    render: { w: num(r.w, 1920, 16, 4096), h: num(r.h, 1080, 16, 4096), transparent: bool(r.transparent, false), ss: bool(r.ss, true), samples: oneOf(Number(r.samples), [1, 4, 8, 16, 32], 1), camera: oneOf(r.camera, ['active', 'view'], 'active') },
    fog: { on: bool(s.fog?.on, false), color: color(s.fog?.color, d.fog.color), density: num(s.fog?.density, d.fog.density, 0, 2) },
    shading: oneOf(s.shading, ['wire', 'solid', 'material', 'rendered'], 'rendered'),
    overlays: { on: bool(s.overlays?.on, true), axes: bool(s.overlays?.axes, true), helpers: bool(s.overlays?.helpers, true) },
    activeCamera: typeof s.activeCamera === 'string' && ID_RE.test(s.activeCamera) ? s.activeCamera : null,
    lockCamera: bool(s.lockCamera, false),
    video: { w: num(vv.w, 1280, 16, 3840), h: num(vv.h, 720, 16, 3840), fps: oneOf(Number(vv.fps), [24, 25, 30, 50, 60], 30), motion: oneOf(vv.motion, ['timeline', 'turntable'], 'timeline') },
  };
}

function lightsFromJSON(list) {
  if (!Array.isArray(list)) return [];
  const ids = LIGHTS.map((l) => l.id);
  return list.slice(0, 64).map((j) => {
    const type = oneOf(j?.type, ids, 'directional');
    const l = createLight(type, { name: str(j?.name, 'Light', 120), id: /^[a-z0-9]{1,40}$/i.test(j?.id) ? j.id : undefined });
    l.color.set(color(j?.color, '#ffffff'));
    l.intensity = num(j?.intensity, l.intensity, 0, 100000);
    if (Array.isArray(j?.pos)) l.position.fromArray(j.pos.slice(0, 3).map((x) => num(x, 0, -1e6, 1e6)));
    if (Array.isArray(j?.quat)) { l.quaternion.fromArray(j.quat.slice(0, 4).map((x) => num(x, 0, -1, 1))); if (l.quaternion.lengthSq() < 1e-6) l.quaternion.identity(); l.quaternion.normalize(); }
    l.visible = bool(j?.visible, true);
    if (l.shadow) l.castShadow = bool(j?.castShadow, l.castShadow);
    if (l.isPointLight || l.isSpotLight) { l.distance = num(j?.distance, 0, 0, 1e6); l.decay = num(j?.decay, 2, 0, 10); }
    if (l.isSpotLight) { l.angle = num(j?.angle, l.angle, 0.01, Math.PI / 2); l.penumbra = num(j?.penumbra, l.penumbra, 0, 1); }
    if (l.isHemisphereLight && j?.groundColor) l.groundColor.set(color(j.groundColor, '#3a2f24'));
    if (l.isRectAreaLight) { l.width = num(j?.width, 2, 0.01, 1000); l.height = num(j?.height, 2, 0.01, 1000); }
    if (Array.isArray(j?.scale)) l.scale.fromArray(vec3(j.scale, [1, 1, 1], -1e4, 1e4));
    if (j?.locked === true) l.userData.eyadLocked = true;
    if (typeof j?.parent === 'string' && ID_RE.test(j.parent)) l.userData._parent = j.parent;
    return l;
  });
}
function camerasFromJSON(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 64).map((j) => {
    const c = createCamera({ name: str(j?.name, 'Camera', 120), id: ID_RE.test(j?.id) ? j.id : undefined });
    c.userData.cam = camOf({ userData: { cam: j?.lens } });
    c.position.fromArray(vec3(j?.pos, [5, 3.5, 6]));
    c.quaternion.identity(); quatFrom(c.quaternion, j?.quat);
    c.scale.fromArray(vec3(j?.scale, [1, 1, 1], -1e4, 1e4));
    c.visible = bool(j?.visible, true);
    if (j?.locked === true) c.userData.eyadLocked = true;
    if (typeof j?.parent === 'string' && ID_RE.test(j.parent)) c.userData._parent = j.parent;
    return c;
  });
}

async function applyProject(app, { doc, glb }, { projectId = null } = {}) {
  let objects = [], clips = [], contentRoot = null;
  if (glb && glb.byteLength) {
    const L = await getLoaders();
    const gltf = await L.gltf.parseAsync(glb, '');
    const scene = gltf.scene;
    scene.traverse((n) => { if (!contentRoot && n.userData?.eyadContent) contentRoot = n; });
    contentRoot = contentRoot || scene;
    objects = [...contentRoot.children];
    clips = gltf.animations || [];
  }
  const seen = new Set();
  const fix = (o, top) => {
    o.visible = !o.userData.eyadHidden;
    if (typeof o.userData.eyadName === 'string') o.name = o.userData.eyadName.slice(0, 120);
    if (typeof o.userData.eyadId !== 'string' || !ID_RE.test(o.userData.eyadId) || seen.has(o.userData.eyadId)) o.userData.eyadId = uid('o');
    seen.add(o.userData.eyadId);
    if (!['primitive', 'model', 'mesh', 'text', 'empty'].includes(o.userData.eyadKind)) o.userData.eyadKind = 'model';
    if (o.userData.eyadLocked !== true) delete o.userData.eyadLocked;
    delete o.userData.cam;
    o.traverse((n) => {
      if (!n.isMesh) return;
      n.castShadow = true; n.receiveShadow = true;
      for (const m of Array.isArray(n.material) ? n.material : [n.material]) if (m) { if (m.userData?.eyadWireframe) m.wireframe = true; if (m.userData?.eyadFlat) { m.flatShading = true; m.needsUpdate = true; } }
    });
    // objects parented to this one were saved as tagged child nodes
    for (const c of o.children) if (c.userData && typeof c.userData.eyadId === 'string') fix(c, false);
    void top;
  };
  for (const o of objects) fix(o, true);
  const order = Array.isArray(doc.order) ? doc.order : [];
  objects.sort((a, b) => order.indexOf(a.userData.eyadId) - order.indexOf(b.userData.eyadId));
  const lights = lightsFromJSON(doc.lights), cameras = camerasFromJSON(doc.cameras);
  if (lights.some((l) => l.isRectAreaLight)) { try { await ensureAreaLights(); } catch (e) { /* area lights stay dark */ } }
  const parents = {};
  for (const o of [...lights, ...cameras]) { if (o.userData._parent) parents[o.userData.eyadId] = o.userData._parent; delete o.userData._parent; }
  app.loadScene({
    name: sanitizeFilename(str(doc.name, 'Untitled scene', 120), 'Untitled scene'),
    settings: validateSettings(doc.settings),
    objects, clips,
    lights, cameras, parents,
    anim: validateAnim(doc.anim),
    bookmarks: Array.isArray(doc.bookmarks) ? doc.bookmarks.slice(0, 64).map((b) => validateBookmark(b)).filter(Boolean) : [],
    selectedId: typeof doc.selected === 'string' ? doc.selected : null,
    projectId,
  });
}
export function validateBookmark(b) {
  if (!b || typeof b !== 'object') return null;
  const vec = (v) => (Array.isArray(v) && v.length === 3 ? v.map((x) => num(x, 0, -1e6, 1e6)) : null);
  const pos = vec(b.pos), target = vec(b.target);
  if (!pos || !target) return null;
  return { id: /^[a-z0-9]{1,40}$/i.test(b.id) ? b.id : uid('b'), name: sanitizeFilename(str(b.name, 'View', 60), 'View'), type: oneOf(b.type, ['persp', 'ortho'], 'persp'), pos, target, fov: num(b.fov, 40, 1, 170), zoom: num(b.zoom, 1, 0.001, 1000), orthoHalf: num(b.orthoHalf, 3, 0.001, 1e6) };
}

async function openEyadFile(app, file) {
  const prog = progressDialog('Opening project', { cancellable: false });
  prog.set(null, 'Reading ' + sanitizeFilename(file.name) + '…');
  try {
    const proj = await readEyad3D(file);
    if (proj.other) {
      const k = proj.manifest.kind;
      const route = { image: ROUTES.image, video: ROUTES.video, vector: ROUTES.vector }[k];
      if (!route) throw new Error('Unknown project type in manifest.');
      toast(`This is an ${k} project — opening it in EYAD ${String(k).toUpperCase()}.`);
      const id = await putHandoff([file]); location.href = route + '?handoff=' + id; return;
    }
    prog.close();
    if (app.dirty && !(await confirmLeave(app))) return;
    await applyProject(app, proj);
    updateUrl(app);
    toast('Opened ' + app.name, { type: 'ok', timeout: 1600 });
  } catch (e) { await alertDialog('Could not open project', e.message || String(e)); }
  finally { prog.close(); }
}

export async function openProject(app, id) {
  try {
    const meta = await getProject(id);
    const blob = await loadProjectBlob(id);
    if (!meta || !blob) { toast('That project is no longer in this browser.', { type: 'warn' }); return; }
    const proj = await readEyad3D(blob);
    if (proj.other) throw new Error('This project is not a 3D scene.');
    proj.doc.name = meta.name || proj.doc.name;
    await applyProject(app, proj, { projectId: id });
    app.rec.created = meta.created || Date.now();
    touchProject(id).catch(() => {});
    app.markSaved();
  } catch (e) { await alertDialog('Could not open project', e.message || String(e)); }
}

async function confirmLeave(app) {
  const r = await dialog({ title: 'Unsaved changes', body: h('p', { text: `Save “${app.name}” before continuing?` }), buttons: [{ label: 'Cancel', value: null }, { label: 'Don’t save', value: 'discard' }, { label: 'Save', value: 'save', primary: true }] });
  if (r === 'save') return save(app);
  return r === 'discard';
}
export async function newScene(app) {
  if (app.dirty && !(await confirmLeave(app))) return;
  app.resetScene();
  updateUrl(app);
}

export async function save(app, { silent = false } = {}) {
  if (!app.rec.projectId) return saveAs(app);
  return writeProject(app, { silent });
}
export async function saveAs(app) {
  const name = await promptDialog('Save project', 'Project name', app.name, { ok: 'Save' });
  if (!name) return false;
  app.name = sanitizeFilename(name, 'Untitled scene');
  app.rec.projectId = uid('p');
  const ok = await writeProject(app, {});
  updateUrl(app);
  return ok;
}
async function writeProject(app, { silent }) {
  if (app.saving) return false;
  app.saving = true;
  try {
    app.saveState = 'saving'; updateSaveIndicator(app);
    const { blob, thumb } = await buildEyad(app);
    const s = app.settings.render;
    await saveProject({ id: app.rec.projectId, name: app.name, kind: '3d', source: 'new', created: app.rec.created, width: s.w, height: s.h, duration: app.anim.duration, thumb }, blob);
    app.markSaved();
    app.saveState = 'saved';
    delRecovery(app.rec.id).catch(() => {});
    if (!silent) toast('Saved to Projects on this device', { type: 'ok', timeout: 1600 });
    return true;
  } catch (e) { app.saveState = 'error'; toast('Save failed', { type: 'error', detail: e.message || 'Storage may be full.' }); return false; }
  finally { app.saving = false; updateSaveIndicator(app); app.updateTitle(); }
}
export async function downloadEyad(app) {
  const prog = progressDialog('Preparing project', { cancellable: false }); prog.set(null, 'Packing scene…');
  try { const { blob } = await buildEyad(app); downloadBlob(blob, sanitizeFilename(app.name) + '.eyad'); }
  catch (e) { toast(e.message || 'Could not build the project file.', { type: 'error' }); }
  finally { prog.close(); }
}
export async function renameScene(app) {
  const v = await promptDialog('Rename scene', 'Name', app.name);
  if (!v) return;
  const before = app.name, after = sanitizeFilename(v, 'Untitled scene');
  app.exec('Rename', () => { app.name = after; app.updateTitle(); }, () => { app.name = before; app.updateTitle(); });
}
export function updateSaveIndicator(app) {
  const state = app.saveState === 'saving' ? 'saving' : app.saveState === 'error' ? 'error' : app.dirty ? 'dirty' : app.rec.projectId ? 'saved' : 'idle';
  app.saveInd?.set(state);
  app.saveIndStatus?.set(state);
}
export function updateUrl(app) {
  const u = new URL(location.href);
  ['handoff', 'new', 'open'].forEach((k) => u.searchParams.delete(k));
  if (app.rec.projectId) u.searchParams.set('project', app.rec.projectId); else u.searchParams.delete('project');
  history.replaceState(null, '', u.pathname + u.search);
}

// ------------------------------------------------------------------ autosave / recovery

export function startAutosave(app) {
  const tick = () => { autosaveNow(app); setTimeout(tick, Math.max(10, getSettings().autosaveSeconds || 20) * 1000); };
  setTimeout(tick, 20000);
}
export async function autosaveNow(app) {
  if (!app.dirty || !getSettings().autosave || app.saving || app.viewport.busy) return;
  const seq = app.hist.currentSeq;
  if (app.autosavedSeq === seq) return;
  try {
    if (app.rec.projectId && getSettings().autosaveProjects) { await writeProject(app, { silent: true }); app.autosavedSeq = seq; return; }
    const { blob } = await buildEyad(app);
    await putRecovery({ id: app.rec.id, kind: '3d', name: app.name, projectId: app.rec.projectId, blob, created: app.rec.created });
    app.autosavedSeq = seq;
  } catch (e) { /* storage full: the next tick retries */ }
}
async function offerRecovery(app) {
  let entries = [];
  try { entries = await listRecovery('3d'); } catch (e) { return; }
  if (!entries.length) return;
  const e = entries[0];
  const v = await dialog({ title: 'Recovered scene', body: h('div', { class: 'studio-stack' }, h('p', { text: `EYAD 3D closed before “${e.name}” was saved. Restore it?` }), h('p', { class: 'studio-dim studio-small', text: formatBytes(e.blob?.size || 0) + ' · ' + new Date(e.time).toLocaleString() })), buttons: [{ label: 'Discard', value: 'discard', danger: true }, { label: 'Restore', value: 'restore', primary: true }] });
  if (v === 'restore') {
    try {
      const proj = await readEyad3D(e.blob);
      if (proj.other) throw new Error('not 3d');
      await applyProject(app, proj, { projectId: e.projectId || null });
      app.forceDirty = true; app.updateTitle(); updateSaveIndicator(app);
      toast('Recovered — save to keep your work.', { type: 'ok' });
    } catch (err) { toast('The recovery copy was damaged.', { type: 'error' }); }
  }
  await delRecovery(e.id).catch(() => {});
  for (const x of entries.slice(1)) delRecovery(x.id).catch(() => {});
}

export async function boot(app) {
  const q = new URLSearchParams(location.search);
  await offerRecovery(app);
  if (q.get('project')) await openProject(app, q.get('project'));
  if (q.get('handoff')) { const files = await takeHandoff(q.get('handoff')); if (files && files.length) await handleFiles(app, files); }
  if ('launchQueue' in window) window.launchQueue.setConsumer(async (params) => { const files = []; for (const hnd of params.files || []) { try { files.push(await hnd.getFile()); } catch (e) { /* ignore */ } } if (files.length) handleFiles(app, files); });
  updateUrl(app);
}

// ------------------------------------------------------------------ export GLB

export async function exportGLB(app) {
  const prog = progressDialog('Exporting GLB', { cancellable: false }); prog.set(null, 'Writing binary glTF…');
  try {
    const glb = await contentGLB(app, { forExport: true });
    downloadBlob(new Blob([glb], { type: 'model/gltf-binary' }), sanitizeFilename(app.name) + '.glb');
    toast(`Exported ${formatBytes(glb.byteLength)} .glb`, { type: 'ok', timeout: 2200, detail: 'Meshes, materials, textures and glTF clips. Lights, keyframes and the environment stay in the .eyad project.' });
  } catch (e) { toast(e.message || 'Export failed', { type: 'error' }); }
  finally { prog.close(); }
}

// ------------------------------------------------------------------ render image

const IMG_PRESETS = [['view', 'Match viewport'], ['1920x1080', 'Full HD 1920 × 1080'], ['3840x2160', '4K UHD 3840 × 2160'], ['1080x1080', 'Square 1080 × 1080'], ['2048x2048', 'Square 2048 × 2048'], ['1080x1350', 'Portrait 4:5 1080 × 1350'], ['1080x1920', 'Story 9:16 1080 × 1920'], ['custom', 'Custom…']];

function cameraOptions(app) {
  const act = app.activeCamera();
  const opts = [];
  if (act) opts.push({ value: 'active', label: 'Active camera — ' + act.name });
  for (const c of app.cameras()) if (c !== act) opts.push({ value: c.userData.eyadId, label: c.name });
  opts.push({ value: 'view', label: app.viewport.viewCam ? 'Viewport (camera view)' : 'Viewport view' });
  return opts;
}

export async function renderImageDialog(app, { dest = 'download' } = {}) {
  const r = app.settings.render;
  const max = Math.min(4096, app.viewport.maxOutputSize());
  const cams = cameraOptions(app);
  const v = await formDialog({ title: 'Render image', ok: 'Render', width: 460, fields: [
    { key: 'camera', label: 'Camera', type: 'select', value: cams.some((c) => c.value === r.camera) ? r.camera : cams[0].value, options: cams },
    { key: 'preset', label: 'Size', type: 'select', value: 'custom', options: IMG_PRESETS.map(([value, label]) => ({ value, label })) },
    { key: 'w', label: 'Width', type: 'number', value: r.w, min: 16, max, suffix: 'px' },
    { key: 'h', label: 'Height', type: 'number', value: r.h, min: 16, max, suffix: 'px' },
    { key: 'samples', label: 'Samples', type: 'select', value: String(r.samples || 1), options: [[1, '1 — fast'], [4, '4'], [8, '8 — smooth edges'], [16, '16'], [32, '32 — best']].map(([value, label]) => ({ value: String(value), label })) },
    { key: 'ss', label: 'High quality (2× supersampling)', type: 'checkbox', value: r.ss },
    { key: 'transparent', label: 'Transparent background', type: 'checkbox', value: r.transparent },
    { key: 'dest', label: 'Then', type: 'select', value: dest, options: [{ value: 'download', label: 'Download PNG' }, { value: 'image', label: 'Send to EYAD IMAGE' }] },
    { type: 'note', label: `PNG up to ${max} px. More samples average jittered frames for cleaner edges. Grid, gizmos and helpers are never included.` },
  ] });
  if (!v) return;
  let W = v.w, H = v.h;
  if (v.preset === 'view') { const k = Math.min(max / app.viewport.w, max / app.viewport.h, 2); W = app.viewport.w * k; H = app.viewport.h * k; }
  else if (v.preset !== 'custom') [W, H] = v.preset.split('x').map(Number);
  W = Math.round(Math.max(16, Math.min(max, W || 1920))); H = Math.round(Math.max(16, Math.min(max, H || 1080)));
  const samples = Number(v.samples) || 1;
  app.settings.render = { w: W, h: H, transparent: !!v.transparent, ss: !!v.ss, samples, camera: v.camera === 'view' ? 'view' : 'active' };
  await renderImage(app, { W, H, transparent: v.transparent, ss: v.ss, samples, camera: v.camera, dest: v.dest });
}

/** Size / quality presets shared by the Render tab and the phone Render sheet. */
export const RENDER_SIZES = [['1920x1080', 'HD'], ['3840x2160', '4K'], ['1080x1080', 'Square'], ['1080x1350', '4:5'], ['1080x1920', 'Story']];
export const RENDER_QUALITY = [[1, 'Draft'], [8, 'Good'], [32, 'Best']];

/** Render a PNG straight from the saved render settings (no dialog). */
export async function renderImageNow(app, { dest = 'download' } = {}) {
  const r = app.settings.render;
  const max = Math.min(4096, app.viewport.maxOutputSize());
  const W = Math.round(Math.max(16, Math.min(max, r.w || 1920))), H = Math.round(Math.max(16, Math.min(max, r.h || 1080)));
  await renderImage(app, { W, H, transparent: r.transparent, ss: r.ss, samples: r.samples || 1, camera: r.camera === 'view' || !app.activeCamera() ? 'view' : 'active', dest });
}

async function renderImage(app, { W, H, transparent, ss, samples, camera, dest }) {
  const v = { transparent, ss, camera, dest };
  const prog = progressDialog('Rendering', { cancellable: false }); prog.set(null, `${W} × ${H} px…`);
  try {
    await sleep(40);
    const blob = await app.viewport.renderPNG(W, H, { transparent: v.transparent, supersample: v.ss, samples, camera: v.camera, onSample: async (i, n) => { prog.set(i / n, `Sample ${i} of ${n}`); await sleep(0); } });
    app.lastRender = { w: W, h: H, bytes: blob.size, samples };
    const fname = sanitizeFilename(app.name) + `-${W}x${H}.png`;
    if (v.dest === 'image') {
      const id = await putHandoff([new File([blob], fname, { type: 'image/png' })]);
      await leaveTo(app, ROUTES.image + '?handoff=' + id);
    } else {
      // desktop: the file downloads straight away; touch devices save from the result (a download prompt mid-render is awkward there)
      const touch = matchMedia('(pointer: coarse)').matches;
      if (!touch) downloadBlob(blob, fname);
      prog.close();
      renderResult(app, blob, fname, { W, H, samples, saved: !touch });
    }
  } catch (e) { toast(e.message || 'Render failed', { type: 'error' }); }
  finally { prog.close(); app.viewport.invalidate(); }
}

/** The finished render: preview, save / share, or continue in EYAD IMAGE. */
async function renderResult(app, blob, fname, { W, H, samples, saved }) {
  const url = URL.createObjectURL(blob);
  const img = h('img', { class: 't3-result-img', src: url, alt: 'Rendered image', width: W, height: H, draggable: false });
  const file = new File([blob], fname, { type: 'image/png' });
  const canShare = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
  const body = h('div', { class: 't3-result' }, h('div', { class: 't3-result-frame' }, img),
    h('p', { class: 'studio-dim studio-small', text: `${W} × ${H} px · ${samples} sample${samples > 1 ? 's' : ''} · ${formatBytes(blob.size)}${saved ? ' · saved to your downloads' : ''}` }));
  const buttons = [
    { label: 'Open in EYAD IMAGE', value: 'image' },
    canShare && !saved ? { label: 'Share…', value: 'share' } : null,
    { label: saved ? 'Download again' : 'Save PNG', value: 'save', primary: !saved },
    { label: 'Done', value: null, primary: saved },
  ].filter(Boolean);
  try {
    const act = await dialog({ title: 'Render', width: 720, className: 't3-result-dialog', body, buttons });
    if (act === 'save') { downloadBlob(blob, fname); toast(`Saved ${fname}`, { type: 'ok', timeout: 2000 }); }
    else if (act === 'share') { try { await navigator.share({ files: [file], title: fname }); } catch (e) { /* cancelled */ } }
    else if (act === 'image') { const id = await putHandoff([file]); await leaveTo(app, ROUTES.image + '?handoff=' + id); }
  } finally { setTimeout(() => URL.revokeObjectURL(url), 4000); }
}

async function leaveTo(app, url) {
  // keep work safe before navigating to another editor
  if (app.dirty) { if (app.rec.projectId) await writeProject(app, { silent: true }); else await autosaveNow(app); }
  app.leaving = true;
  location.href = url;
}

// ------------------------------------------------------------------ render video

const VID_PRESETS = [['1280x720', 'HD 1280 × 720'], ['1920x1080', 'Full HD 1920 × 1080'], ['1080x1080', 'Square 1080 × 1080'], ['1080x1920', 'Vertical 1080 × 1920'], ['854x480', 'SD 854 × 480'], ['custom', 'Custom…']];

async function webCodecsConfig(W, H, fps) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  const bitrate = Math.round(Math.min(40e6, Math.max(2e6, W * H * fps * 0.12)));
  for (const [codec, id] of [['vp09.00.40.08', 'V_VP9'], ['vp8', 'V_VP8']]) {
    const cfg = { codec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality' };
    try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) return { cfg: s.config || cfg, id }; } catch (e) { /* try next */ }
  }
  return null;
}
function recorderMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4']) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return null;
}

export async function renderVideoDialog(app, { dest = 'download', motion = null } = {}) {
  const vs = app.settings.video;
  const hasAnim = app.hasAnimation();
  const wc = typeof VideoEncoder !== 'undefined';
  const rec = recorderMime();
  if (!wc && !rec) { await alertDialog('Video rendering unavailable', 'This browser can neither encode video frames (WebCodecs) nor record a canvas (MediaRecorder).'); return; }
  const v = await formDialog({ title: 'Render video', ok: 'Render', width: 480, fields: [
    { key: 'preset', label: 'Resolution', type: 'select', value: VID_PRESETS.some((p) => p[0] === `${vs.w}x${vs.h}`) ? `${vs.w}x${vs.h}` : 'custom', options: VID_PRESETS.map(([value, label]) => ({ value, label })) },
    { key: 'w', label: 'Width (custom)', type: 'number', value: vs.w, min: 16, max: 3840, suffix: 'px' },
    { key: 'h', label: 'Height (custom)', type: 'number', value: vs.h, min: 16, max: 3840, suffix: 'px' },
    { key: 'fps', label: 'Frame rate', type: 'select', value: String(vs.fps), options: [24, 25, 30, 50, 60].map((f) => ({ value: String(f), label: f + ' fps' })) },
    { key: 'dur', label: 'Duration', type: 'number', value: +app.anim.duration.toFixed(2), min: 0.2, max: 120, step: 0.1, suffix: 's' },
    { key: 'camera', label: 'Camera', type: 'select', value: cameraOptions(app)[0].value, options: cameraOptions(app) },
    { key: 'motion', label: 'Motion', type: 'select', value: motion || (hasAnim ? 'timeline' : 'turntable'), options: [{ value: 'timeline', label: hasAnim ? 'Timeline animation' : 'Timeline animation (no keys yet)' }, { value: 'turntable', label: 'Viewport turntable (one full orbit, ignores the camera choice)' }] },
    { key: 'enc', label: 'Encoder', type: 'select', value: wc ? 'webcodecs' : 'recorder', options: [wc ? { value: 'webcodecs', label: 'Frame-accurate (WebCodecs, WebM)' } : null, rec ? { value: 'recorder', label: 'Real-time recorder (' + (rec.includes('mp4') ? 'MP4' : 'WebM') + ')' } : null].filter(Boolean) },
    { key: 'dest', label: 'Then', type: 'select', value: dest, options: [{ value: 'download', label: 'Download video' }, { value: 'video', label: 'Send to EYAD VIDEO' }] },
    { type: 'note', label: 'Frame-accurate rendering keeps exact timing even when frames are slow to draw. The real-time recorder captures as it plays, so heavy scenes may stutter.' },
  ] });
  if (!v) return;
  let [W, H] = v.preset === 'custom' ? [v.w, v.h] : v.preset.split('x').map(Number);
  const max = Math.min(3840, app.viewport.maxOutputSize());
  W = Math.max(16, Math.min(max, Math.round(W || 1280))); H = Math.max(16, Math.min(max, Math.round(H || 720)));
  W -= W % 2; H -= H % 2; // encoders want even sizes
  const fps = Number(v.fps) || 30;
  const dur = Math.max(0.2, Math.min(120, Number(v.dur) || app.anim.duration));
  app.settings.video = { w: W, h: H, fps, motion: v.motion };
  try {
    const blob = await renderVideo(app, { W, H, fps, dur, motion: v.motion, encoder: v.enc, camera: v.camera });
    if (!blob) return;
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const fname = sanitizeFilename(app.name) + `-${W}x${H}.${ext}`;
    if (v.dest === 'video') {
      const id = await putHandoff([new File([blob], fname, { type: blob.type })]);
      await leaveTo(app, ROUTES.video + '?handoff=' + id);
    } else { downloadBlob(blob, fname); toast(`Rendered ${dur.toFixed(1)} s ${W} × ${H} video (${formatBytes(blob.size)})`, { type: 'ok', timeout: 2600 }); }
  } catch (e) { toast(e.message || 'Video render failed', { type: 'error' }); }
}

/** Renders the animation to a video Blob. Returns null if cancelled. */
export async function renderVideo(app, { W, H, fps, dur, motion = 'timeline', encoder = 'webcodecs', camera = 'active', onProgress = null }) {
  const vp = app.viewport;
  if (motion === 'turntable') { camera = 'view'; if (vp.viewCam) { vp.exitCameraView({ keep: true }); app.onCamViewChanged?.(); } }
  const frames = Math.max(1, Math.round(dur * fps));
  const prog = progressDialog('Rendering video', { cancellable: true });
  let cancelled = false;
  prog.onCancel(() => { cancelled = true; });
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { alpha: false });
  const state = app.captureViewState();
  const tt = motion === 'turntable' ? app.makeCameraTurntable(dur) : null;
  const evalAt = (t) => { app.evaluate(t, { cameraKeys: tt }); };
  let blob = null;
  const wc = encoder === 'webcodecs' ? await webCodecsConfig(W, H, fps) : null;
  vp.beginOutput(W, H, { transparent: false, scale: 1, camera });
  try {
    if (wc) {
      const writer = new WebMWriter({ width: W, height: H, codec: wc.id, fps });
      let failure = null;
      const enc = new VideoEncoder({ output: (chunk) => writer.add(chunk), error: (e) => { failure = e; } });
      enc.configure(wc.cfg);
      for (let i = 0; i < frames && !cancelled; i++) {
        if (failure) throw failure;
        evalAt(i / fps);
        vp.drawOutput(ctx);
        const frame = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
        enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();
        while (enc.encodeQueueSize > 4) await sleep(4);
        if (i % 3 === 0) { prog.set(i / frames, `Frame ${i + 1} of ${frames}`); onProgress?.(i / frames); await sleep(0); }
      }
      await enc.flush();
      enc.close();
      if (failure) throw failure;
      if (!cancelled) blob = writer.finish();
    } else {
      const mime = recorderMime();
      if (!mime) throw new Error('This browser cannot record video.');
      const stream = c.captureStream(0);
      const track = stream.getVideoTracks()[0];
      const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.round(Math.min(40e6, Math.max(2e6, W * H * fps * 0.12))) });
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((res) => { mr.onstop = res; });
      mr.start(250);
      const t0 = performance.now();
      for (let i = 0; i < frames && !cancelled; i++) {
        evalAt(i / fps);
        vp.drawOutput(ctx);
        if (track.requestFrame) track.requestFrame();
        const wait = t0 + ((i + 1) * 1000) / fps - performance.now();
        if (wait > 0) await sleep(wait); else await sleep(0);
        if (i % 3 === 0) { prog.set(i / frames, `Recording frame ${i + 1} of ${frames}`); onProgress?.(i / frames); }
      }
      mr.stop();
      await stopped;
      track.stop();
      if (!cancelled) blob = new Blob(chunks, { type: mime.split(';')[0] });
    }
  } finally {
    vp.endOutput();
    app.restoreViewState(state);
    prog.close();
  }
  if (cancelled) { toast('Video render cancelled', { timeout: 1500 }); return null; }
  if (!blob || !blob.size) throw new Error('The encoder produced no data.');
  return blob;
}
