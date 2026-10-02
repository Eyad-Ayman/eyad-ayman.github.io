// EYAD 3D — scene objects: primitives, lights, materials, identity helpers.
import * as THREE from '../../vendor/three/three.module.js';
import { clone as skeletonClone } from '../../vendor/three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from '../../vendor/three/addons/utils/BufferGeometryUtils.js';
import { uid } from '../core/dom.js';

export const PRIMITIVES = [
  { id: 'cube', label: 'Cube', icon: 'cube' },
  { id: 'sphere', label: 'UV sphere', icon: 'sphere' },
  { id: 'ico', label: 'Ico sphere', icon: 'ico' },
  { id: 'cylinder', label: 'Cylinder', icon: 'cylinder' },
  { id: 'cone', label: 'Cone', icon: 'cone' },
  { id: 'torus', label: 'Torus', icon: 'torus' },
  { id: 'plane', label: 'Plane', icon: 'plane' },
  { id: 'capsule', label: 'Capsule', icon: 'capsule' },
  { id: 'knot', label: 'Torus Knot', icon: 'knot' },
];

export const LIGHTS = [
  { id: 'point', label: 'Point light', icon: 'bulb' },
  { id: 'directional', label: 'Sun light', icon: 'sun' },
  { id: 'spot', label: 'Spot light', icon: 'spot' },
  { id: 'area', label: 'Area light', icon: 'area' },
  { id: 'hemisphere', label: 'Hemisphere light', icon: 'hemi' },
  { id: 'ambient', label: 'Ambient light', icon: 'ambient' },
];

const PALETTE = ['#d02b2a', '#e8e4dc', '#2f6fe0', '#f2b134', '#23874a', '#8a5cf6', '#1f1f1f', '#ff7a45'];
let paletteIndex = 0;

/** detail scales the segment counts of round shapes (0.25 … 3). */
export function primitiveGeometry(kind, detail = 1) {
  const n = (v, min = 3) => Math.max(min, Math.round(v * detail));
  switch (kind) {
    case 'sphere': return new THREE.SphereGeometry(0.5, n(64, 6), n(32, 4));
    case 'ico': return new THREE.IcosahedronGeometry(0.5, Math.max(0, Math.min(6, Math.round(2 * detail))));
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, n(64), 1);
    case 'cone': return new THREE.ConeGeometry(0.5, 1, n(64), 1);
    case 'torus': return new THREE.TorusGeometry(0.4, 0.15, n(32), n(96, 6));
    case 'plane': { const k = Math.max(1, Math.round(detail)); return new THREE.PlaneGeometry(1, 1, k, k).rotateX(-Math.PI / 2); }
    case 'capsule': return new THREE.CapsuleGeometry(0.3, 0.5, n(12, 2), n(32, 6));
    case 'knot': return new THREE.TorusKnotGeometry(0.35, 0.12, n(200, 24), n(24, 4));
    default: { const k = Math.max(1, Math.round(detail)); return new THREE.BoxGeometry(1, 1, 1, k, k, k); }
  }
}

export function newStandardMaterial(color) {
  return new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color || PALETTE[paletteIndex++ % PALETTE.length]), metalness: 0, roughness: 0.45 });
}

/** A physical (glass-capable) copy of a standard material. */
export function toPhysical(m) {
  if (!m || m.isMeshPhysicalMaterial || !m.isMeshStandardMaterial) return m;
  const p = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(p, m);
  p.defines = { STANDARD: '', PHYSICAL: '' };
  p.userData = JSON.parse(JSON.stringify(m.userData || {}));
  return p;
}

export function createPrimitive(kind) {
  const def = PRIMITIVES.find((p) => p.id === kind) || PRIMITIVES[0];
  const mesh = new THREE.Mesh(primitiveGeometry(def.id), newStandardMaterial());
  mesh.name = def.label;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { eyadId: uid('o'), eyadKind: 'primitive', eyadPrim: def.id };
  if (def.id === 'ico') { mesh.material.flatShading = true; mesh.material.userData.eyadFlat = true; }
  if (def.id === 'plane') mesh.material.side = THREE.DoubleSide;
  // rest on the ground
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  mesh.position.y = def.id === 'plane' ? 0.001 : -bb.min.y;
  return mesh;
}

// -------------------------------------------------------------- modifiers (primitives only)
// userData.eyadMods = { detail, array: { count, x, y, z } } — the geometry is
// always rebuilt from the primitive, so the stack stays editable after reload.

export const defaultMods = () => ({ detail: 1, array: { count: 1, x: 1.1, y: 0, z: 0 } });
export function modsOf(o) {
  const d = defaultMods(), m = o?.userData?.eyadMods;
  if (!m || typeof m !== 'object') return d;
  const f = (v, dd, a, b) => (Number.isFinite(Number(v)) ? Math.min(b, Math.max(a, Number(v))) : dd);
  const ar = m.array && typeof m.array === 'object' ? m.array : {};
  return { detail: f(m.detail, 1, 0.1, 3), array: { count: Math.round(f(ar.count, 1, 1, 64)), x: f(ar.x, 1.1, -100, 100), y: f(ar.y, 0, -100, 100), z: f(ar.z, 0, -100, 100) } };
}
export function canModify(o) { return !!(o && o.isMesh && o.userData.eyadKind === 'primitive' && PRIMITIVES.some((p) => p.id === o.userData.eyadPrim)); }
/** Build the geometry for a primitive with its modifier stack applied. */
export function buildModGeometry(prim, mods) {
  let g = primitiveGeometry(prim, mods.detail);
  const n = mods.array.count;
  if (n > 1) {
    g.computeBoundingBox();
    const size = g.boundingBox.getSize(new THREE.Vector3());
    const step = new THREE.Vector3(mods.array.x * size.x, mods.array.y * (size.y || 1), mods.array.z * size.z);
    const parts = [];
    for (let i = 0; i < n; i++) { const c = g.clone(); c.translate(step.x * i, step.y * i, step.z * i); parts.push(c); }
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (merged) { g.dispose(); g = merged; }
  }
  return g;
}

/** Join mesh b into mesh a (both single meshes). Returns a new Mesh in a's space, or throws. */
export function joinMeshes(a, b) {
  const ok = (o) => o && o.isMesh && !o.isSkinnedMesh && !Array.isArray(o.material) && !o.children.some((c) => c.isMesh);
  if (!ok(a) || !ok(b)) throw new Error('Join works on two single-mesh objects with one material each (shapes, text or simple models).');
  a.updateWorldMatrix(true, false); b.updateWorldMatrix(true, false);
  let ga = a.geometry.clone(), gb = b.geometry.clone();
  gb.applyMatrix4(new THREE.Matrix4().copy(a.matrixWorld).invert().multiply(b.matrixWorld));
  if (!!ga.index !== !!gb.index) { if (ga.index) ga = ga.toNonIndexed(); if (gb.index) gb = gb.toNonIndexed(); }
  const keep = ['position', 'normal', 'uv'];
  for (const g of [ga, gb]) {
    for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of keep) { const at = g.attributes[k]; if (at.isInterleavedBufferAttribute || !(at.array instanceof Float32Array) || at.normalized) { const arr = new Float32Array(at.count * at.itemSize); for (let i = 0; i < at.count; i++) for (let j = 0; j < at.itemSize; j++) arr[i * at.itemSize + j] = at.getComponent(i, j); g.setAttribute(k, new THREE.BufferAttribute(arr, at.itemSize)); } }
  }
  const merged = mergeGeometries([ga, gb], true);
  ga.dispose(); gb.dispose();
  if (!merged) throw new Error('These two meshes could not be merged.');
  const mesh = new THREE.Mesh(merged, [a.material, b.material]);
  mesh.name = a.name;
  mesh.castShadow = a.castShadow; mesh.receiveShadow = a.receiveShadow;
  mesh.position.copy(a.position); mesh.quaternion.copy(a.quaternion); mesh.scale.copy(a.scale);
  mesh.userData = { eyadId: uid('o'), eyadKind: 'mesh' };
  return mesh;
}

// -------------------------------------------------------------- cameras / empties / text

export const SENSOR_FITS = [['auto', 'Auto'], ['h', 'Horizontal'], ['v', 'Vertical']];
export const defaultCam = () => ({ type: 'persp', focal: 50, sensor: 36, fit: 'auto', near: 0.1, far: 1000, orthoScale: 6 });
export function camOf(o) {
  const d = defaultCam(), c = o?.userData?.cam;
  if (!c || typeof c !== 'object') return d;
  const f = (v, dd, a, b) => (Number.isFinite(Number(v)) ? Math.min(b, Math.max(a, Number(v))) : dd);
  return { type: c.type === 'ortho' ? 'ortho' : 'persp', focal: f(c.focal, 50, 1, 5000), sensor: f(c.sensor, 36, 1, 200), fit: ['auto', 'h', 'v'].includes(c.fit) ? c.fit : 'auto', near: f(c.near, 0.1, 0.001, 1e5), far: f(c.far, 1000, 0.01, 1e7), orthoScale: f(c.orthoScale, 6, 0.001, 1e6) };
}
/** Vertical half-angle tangent (persp) or vertical half-height (ortho) for a render aspect. */
export function camLens(c, aspect) {
  const fit = c.fit === 'auto' ? (aspect >= 1 ? 'h' : 'v') : c.fit;
  if (c.type === 'ortho') return { ortho: true, half: (fit === 'h' ? c.orthoScale / aspect : c.orthoScale) / 2 };
  const sv = fit === 'h' ? c.sensor / aspect : c.sensor;
  return { ortho: false, tan: sv / 2 / c.focal };
}
export const focalToFov = (focal, sensor = 36) => THREE.MathUtils.radToDeg(2 * Math.atan(sensor / 2 / focal));
export const fovToFocal = (fov, sensor = 36) => sensor / 2 / Math.tan(THREE.MathUtils.degToRad(fov) / 2);

export function createCamera(opts = {}) {
  const o = new THREE.Object3D();
  o.name = opts.name || 'Camera';
  o.userData = { eyadId: opts.id || uid('c'), eyadKind: 'camera', cam: { ...defaultCam(), ...(opts.cam || {}) } };
  o.position.set(5, 3.5, 6);
  o.lookAt(0, 0.6, 0);
  return o;
}
export function createEmpty() {
  const o = new THREE.Object3D();
  o.name = 'Empty';
  o.userData = { eyadId: uid('o'), eyadKind: 'empty' };
  return o;
}
/** Flat text card: the text is drawn with a Studio font into a texture on a plane. */
export function createText(text, { color = '#ffffff', font = 'display' } = {}) {
  const str = String(text || 'Text').slice(0, 200);
  const fam = font === 'ui' ? "600 160px 'Studio Inter', 'Inter', sans-serif" : "700 160px 'Studio Oswald', 'Oswald', 'Arial Narrow', sans-serif";
  const c = document.createElement('canvas');
  let g = c.getContext('2d');
  g.font = fam;
  const lines = str.split('\n').slice(0, 8);
  const w = Math.max(...lines.map((l) => g.measureText(l).width), 40);
  const lh = 190;
  c.width = Math.min(4096, Math.ceil(w + 60)); c.height = Math.min(4096, lines.length * lh + 50);
  g = c.getContext('2d');
  g.font = fam; g.fillStyle = '#ffffff'; g.textBaseline = 'middle'; g.textAlign = 'center';
  lines.forEach((l, i) => g.fillText(l, c.width / 2, 25 + lh * (i + 0.5), c.width - 20));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.name = 'Text';
  const hgt = 0.5 * lines.length, wid = hgt * (c.width / c.height);
  const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), map: tex, transparent: false, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wid, hgt), mat);
  mesh.name = str.replace(/\s+/g, ' ').slice(0, 40) || 'Text';
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData = { eyadId: uid('o'), eyadKind: 'text', eyadText: str };
  mesh.position.y = hgt / 2;
  return mesh;
}

export function createLight(kind, opts = {}) {
  let l;
  switch (kind) {
    case 'point': l = new THREE.PointLight(0xffffff, 20, 0, 2); l.position.set(2, 3, 2); break;
    case 'spot': l = new THREE.SpotLight(0xffffff, 60, 0, Math.PI / 7, 0.35, 2); l.position.set(3, 5, 3); break;
    case 'hemisphere': l = new THREE.HemisphereLight(0xdfe8ff, 0x3a2f24, 1); l.position.set(0, 4, 0); break;
    case 'ambient': l = new THREE.AmbientLight(0xffffff, 0.4); l.position.set(-1.5, 4, 0); break;
    case 'area': l = new THREE.RectAreaLight(0xffffff, 8, 2, 2); l.position.set(0, 3, 2.5); l.lookAt(0, 0.5, 0); break;
    default: l = new THREE.DirectionalLight(0xffffff, 2.5); l.position.set(4, 6, 3); kind = 'directional';
  }
  l.name = opts.name || (LIGHTS.find((x) => x.id === kind)?.label || 'Light');
  l.userData = { eyadId: opts.id || uid('l'), eyadKind: 'light', eyadLight: kind };
  if (l.target) {
    // aim along the light's own -Z, so rotating the light aims it
    l.add(l.target);
    l.target.position.set(0, 0, -1);
    l.lookAt(0, 0, 0);
  }
  if (l.shadow) {
    l.castShadow = kind === 'directional' || kind === 'spot';
    l.shadow.mapSize.set(2048, 2048);
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.02;
    if (kind === 'directional') { const c = l.shadow.camera; c.left = -6; c.right = 6; c.top = 6; c.bottom = -6; c.near = 0.1; c.far = 60; }
  }
  return l;
}

export const isLight = (o) => !!(o && o.isLight);
export const isCam = (o) => !!(o && o.userData && o.userData.eyadKind === 'camera');
export const isEmpty = (o) => !!(o && o.userData && o.userData.eyadKind === 'empty');
/** Objects that never hold geometry of their own (kept out of the content GLB / saved as JSON). */
export const isAux = (o) => isLight(o) || isCam(o);
export const idOf = (o) => o?.userData?.eyadId || null;
/** Editor objects under a group: top-level ones plus anything parented to them. */
export function editorObjects(group, out = []) {
  for (const c of group.children) if (c.userData && c.userData.eyadId) { out.push(c); editorObjects(c, out); }
  return out;
}
export const editorChildren = (o) => o.children.filter((c) => c.userData && c.userData.eyadId);
export function kindLabel(o) {
  if (!o) return '';
  if (o.isLight) return LIGHTS.find((x) => x.id === o.userData.eyadLight)?.label || 'Light';
  if (isCam(o)) return 'Camera';
  if (isEmpty(o)) return 'Empty';
  if (o.userData.eyadKind === 'text') return 'Text';
  if (o.userData.eyadKind === 'mesh') return 'Mesh';
  if (o.userData.eyadKind === 'primitive') return PRIMITIVES.find((p) => p.id === o.userData.eyadPrim)?.label || 'Shape';
  return 'Model' + (o.userData.eyadSrc ? ' · ' + String(o.userData.eyadSrc).toUpperCase() : '');
}
export function iconFor(o) {
  if (!o) return 'cube';
  if (o.isLight) return LIGHTS.find((x) => x.id === o.userData.eyadLight)?.icon || 'bulb';
  if (isCam(o)) return 'camera';
  if (isEmpty(o)) return 'empty';
  if (o.userData.eyadKind === 'text') return 'text';
  if (o.userData.eyadKind === 'primitive') return PRIMITIVES.find((p) => p.id === o.userData.eyadPrim)?.icon || 'cube';
  return 'model';
}

/** All unique materials under an object (meshes only). */
export function materialsOf(obj) {
  const out = [];
  obj?.traverse?.((n) => {
    if (!n.isMesh) return;
    const ms = Array.isArray(n.material) ? n.material : [n.material];
    for (const m of ms) if (m && !out.includes(m)) out.push(m);
  });
  return out;
}

/** Convert legacy (Phong / Lambert / Basic) materials to PBR so the editor & environment treat everything alike. */
export function toStandard(m) {
  if (!m || m.isMeshStandardMaterial) return m;
  const s = new THREE.MeshStandardMaterial({
    name: m.name || '',
    color: m.color ? m.color.clone() : new THREE.Color(0xcccccc),
    map: m.map || null,
    normalMap: m.normalMap || null,
    emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0),
    emissiveMap: m.emissiveMap || null,
    alphaMap: m.alphaMap || null,
    opacity: m.opacity ?? 1,
    transparent: !!m.transparent,
    side: m.side,
    vertexColors: !!m.vertexColors,
    flatShading: !!m.flatShading,
    metalness: 0,
    roughness: m.shininess !== undefined ? Math.max(0.05, Math.min(1, 1 - Math.sqrt(m.shininess / 100))) : 0.6,
  });
  return s;
}

export function prepareImported(root, { convert = true } = {}) {
  root.traverse((n) => {
    if (n.isMesh) {
      n.castShadow = true;
      n.receiveShadow = true;
      if (convert) {
        if (Array.isArray(n.material)) n.material = n.material.map(toStandard);
        else n.material = toStandard(n.material || new THREE.MeshStandardMaterial({ color: 0xcccccc }));
      }
      if (!n.material) n.material = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    }
    // imported cameras / lights inside models are not editable here; hide lights to avoid surprises
    if (n.isLight) n.visible = false;
  });
}

/** Deep copy with independent materials (geometry is shared, which is safe: it is never edited). */
export function duplicateObject(o) {
  let c;
  let skinned = false;
  o.traverse((n) => { if (n.isSkinnedMesh) skinned = true; });
  c = skinned ? skeletonClone(o) : o.clone(true);
  const map = new Map();
  c.traverse((n) => {
    if (n.isMesh) {
      const cloneM = (m) => { if (!map.has(m)) map.set(m, m.clone()); return map.get(m); };
      n.material = Array.isArray(n.material) ? n.material.map(cloneM) : cloneM(n.material);
    }
  });
  c.userData = JSON.parse(JSON.stringify(o.userData || {}));
  // every editor object in the copy (the root and anything parented to it) needs its own id
  c.traverse((n) => {
    if (n.userData && n.userData.eyadId) n.userData.eyadId = uid(n.isLight ? 'l' : isCam(n) ? 'c' : 'o');
    if (n.isLight && n.target) {
      // clone() does not carry the child target reference
      const t = n.children.find((k) => k !== n.target && k.isObject3D && !k.isLight && k.type === 'Object3D' && !k.userData.eyadId);
      if (t) n.target = t; else { n.add(n.target); n.target.position.set(0, 0, -1); }
    }
  });
  c.name = o.name + ' copy';
  return c;
}

export function disposeObject(o) {
  o.traverse((n) => {
    if (n.geometry) n.geometry.dispose?.();
    const ms = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
    for (const m of ms) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']) m[k]?.dispose?.();
      m.dispose?.();
    }
  });
}

export function triangleCount(root) {
  let t = 0;
  root.traverse((n) => {
    if (!n.isMesh || !n.geometry) return;
    const g = n.geometry;
    t += g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3;
  });
  return Math.round(t);
}

export const tmpBox = new THREE.Box3();
export function boundsOf(obj) {
  const b = new THREE.Box3();
  obj.updateWorldMatrix(true, true);
  obj.traverse((n) => {
    if (!n.visible) return;
    if (n.isMesh && n.geometry) { tmpBox.setFromObject(n, true); if (!tmpBox.isEmpty()) b.union(tmpBox); }
  });
  if (b.isEmpty()) { const p = new THREE.Vector3(); obj.getWorldPosition(p); b.setFromCenterAndSize(p, new THREE.Vector3(1, 1, 1)); }
  return b;
}

let areaReady = null;
/** RectAreaLight needs its lookup textures registered once before it lights anything. */
export function ensureAreaLights() {
  if (!areaReady) areaReady = import('../../vendor/three/addons/lights/RectAreaLightUniformsLib.js').then((m) => { m.RectAreaLightUniformsLib.init(); return true; });
  return areaReady;
}
