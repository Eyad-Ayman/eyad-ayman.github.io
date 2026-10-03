// EYAD 3D — viewport: WebGL renderer, scene graph, cameras, orbit + gizmo
// controls, environment / background / ground, helpers, picking, and
// offscreen-quality still rendering.
import * as THREE from '../../vendor/three/three.module.js';
import { OrbitControls } from '../../vendor/three/addons/controls/OrbitControls.js';
import { TransformControls } from '../../vendor/three/addons/controls/TransformControls.js';
import { RoomEnvironment } from '../../vendor/three/addons/environments/RoomEnvironment.js';
import { boundsOf, editorObjects, isCam, isEmpty, camOf, camLens } from './objects.js';

export const TONE = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, none: THREE.NoToneMapping };

/** Lighting environments. All are built in the browser (no image files): a room model or a painted sky dome with light panels. */
export const ENVS = [['studio', 'Studio room'], ['softbox', 'Softbox'], ['day', 'Daylight sky'], ['sunset', 'Sunset'], ['night', 'Night'], ['none', 'None — lights only']];
const SKY = {
  // [zenith, horizon, ground], panels: [colour, intensity, azimuth°, elevation°, size]
  softbox: { c: ['#1b1b1e', '#2a2a2e', '#0c0c0d'], panels: [['#ffffff', 14, 35, 40, 7], ['#dfe8ff', 6, -120, 25, 9], ['#ffffff', 3, 180, 75, 10]] },
  day: { c: ['#2f6fd6', '#cfe4ff', '#6f6a60'], panels: [['#fff4dc', 60, 40, 50, 2.6]] },
  sunset: { c: ['#27306b', '#ff9a5a', '#2a1c1a'], panels: [['#ffb46a', 45, 60, 8, 3.2], ['#ff6a3a', 4, 60, 3, 14]] },
  night: { c: ['#03040a', '#141c36', '#020203'], panels: [['#9fb6ff', 5, -40, 55, 2.2]] },
};

export function defaultSettings() {
  return {
    env: { lighting: 'studio', intensity: 1, background: 'gradient', color: '#202022', top: '#3b3b40', bottom: '#111113', blur: 0.35, toneMapping: 'aces', exposure: 1 },
    ground: { mode: 'shadow', color: '#8c877d', opacity: 0.35, grid: true },
    shadows: true,
    snap: { on: false, move: 0.25, rotate: 15, scale: 0.1 },
    camera: { type: 'persp', fov: 40, pos: [4.2, 3.1, 5.6], target: [0, 0.6, 0], zoom: 1 },
    render: { w: 1920, h: 1080, transparent: false, ss: true, samples: 1, camera: 'active' },
    fog: { on: false, color: '#9aa3ad', density: 0.04 },
    shading: 'rendered',
    overlays: { on: true, axes: true, helpers: true },
    activeCamera: null,
    lockCamera: false,
    video: { w: 1280, h: 720, fps: 30, motion: 'timeline' },
  };
}

export class Viewport {
  constructor(app, host) {
    this.app = app;
    this.host = host;
    this.needs = true;
    this.loop = this.loop.bind(this);
    this.raf = 0;
    this.frames = 0;
    // device profile: phones / tablets / weak laptops get a lighter renderer
    const coarse = matchMedia('(pointer: coarse)').matches;
    const small = Math.min(screen.width || 9999, screen.height || 9999) < 700;
    const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
    const dpr = devicePixelRatio || 1;
    this.lite = coarse || small || weak;
    this.quality = {
      ratio: Math.min(this.lite ? (small ? 1.75 : 2) : 2, dpr), // resting pixel ratio
      moving: Math.min(this.lite ? 1.25 : 2, dpr), // while orbiting / dragging / playing
      shadow: small ? 1024 : this.lite ? 1536 : 2048,
    };
    this.renderer = new THREE.WebGLRenderer({ antialias: !(this.lite && dpr >= 2), alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.quality.ratio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 't3-canvas';
    this.canvas.setAttribute('tabindex', '0');
    this.canvas.setAttribute('aria-label', '3D viewport — drag to orbit, right-drag or two fingers to pan, scroll or pinch to zoom');
    host.appendChild(this.canvas);
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; app.onContextLost?.(); });
    this.canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.applySettings(); this.invalidate(); });

    const s = this.scene = new THREE.Scene();
    this.content = new THREE.Group(); this.content.name = 'EYAD Content';
    this.lights = new THREE.Group(); this.lights.name = 'EYAD Lights';
    this.helpers = new THREE.Group(); this.helpers.name = 'EYAD Helpers';
    this.cams = new THREE.Group(); this.cams.name = 'EYAD Cameras';
    s.add(this.content, this.lights, this.cams, this.helpers);

    // ground: a large plane that only receives shadows (or a solid floor)
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.35 }));
    this.ground.receiveShadow = true;
    this.ground.name = 'Ground';
    this.ground.renderOrder = -1;
    s.add(this.ground);
    this.grid = new THREE.GridHelper(20, 20, 0x8a8a8a, 0x4a4a4a);
    this.grid.material.transparent = true; this.grid.material.opacity = 0.35; this.grid.material.depthWrite = false;
    this.grid.position.y = 0.0005;
    this.helpers.add(this.grid);
    // world axes on the ground (X red, Z blue) — editor only
    {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-10, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(0, 0, -10), new THREE.Vector3(0, 0, 10)]);
      g.setAttribute('color', new THREE.Float32BufferAttribute([0.9, 0.3, 0.28, 0.9, 0.3, 0.28, 0.3, 0.55, 0.95, 0.3, 0.55, 0.95], 3));
      this.axes = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
      this.axes.position.y = 0.001;
      this.helpers.add(this.axes);
    }
    this.icons = new THREE.Group(); this.icons.name = 'EYAD Icons';
    this.helpers.add(this.icons);
    this.objHelpers = new Map();
    this.wireMat = new THREE.MeshBasicMaterial({ color: 0xc9c9c9, wireframe: true, toneMapped: false });
    this.solidMat = new THREE.MeshStandardMaterial({ color: 0xb4b4b4, roughness: 0.55, metalness: 0 });
    this.rcamP = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    this.rcamO = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.viewCam = null;
    this.passEl = document.createElement('div'); this.passEl.className = 't3-pass'; this.passEl.hidden = true;
    this.passLabel = document.createElement('span'); this.passLabel.className = 't3-pass-label';
    this.passEl.appendChild(this.passLabel);
    host.appendChild(this.passEl);

    this.selBox = new THREE.Box3Helper(new THREE.Box3(), 0xff4a3d);
    this.selBox.visible = false;
    this.selBox.material.depthTest = false; this.selBox.material.transparent = true; this.selBox.material.opacity = 0.9;
    this.selBox.renderOrder = 999;
    this.helpers.add(this.selBox);
    this.selBoxes = []; // the rest of a multi-selection

    // cameras
    this.persp = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
    this.camera = this.persp;
    this.persp.position.set(4.2, 3.1, 5.6);

    this.orbit = new OrbitControls(this.camera, this.canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.screenSpacePanning = true;
    this.orbit.target.set(0, 0.6, 0);
    this.orbit.addEventListener('change', () => { this.invalidate(); if (this.viewCam && this.orbiting && this.camLocked()) this.writeCamFromView(); app.onCameraMoved?.(); });
    this.orbit.addEventListener('start', () => {
      this.setMoving(true);
      if (this.viewCam) { if (this.camLocked()) app.beginTransform?.(this.viewCam); else this.exitCameraView({ keep: true }); }
      this.orbiting = true;
    });
    this.orbit.addEventListener('end', () => { this.orbiting = false; this.setMoving(false); if (this.viewCam && this.camLocked()) app.commitTransform?.(this.viewCam, 'Move camera'); app.onCameraEnd?.(); });

    this.gizmo = new TransformControls(this.camera, this.canvas);
    this.gizmo.setSize(coarse ? 1.6 : 1);
    this.gizmoHelper = this.gizmo.getHelper();
    s.add(this.gizmoHelper);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
      this.setMoving(e.value);
      if (e.value) { this.gizmoUsed = true; app.onGizmoStart?.(); } else app.onGizmoEnd?.();
    });
    this.gizmo.addEventListener('objectChange', () => { this.invalidate(); app.onGizmoChange?.(); });
    this.gizmo.addEventListener('change', () => this.invalidate());

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.lightIcons = new Map();

    this.raycaster = new THREE.Raycaster();
    this.bindPicking();

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.kick();
  }

  /** Ask for a redraw. Frames are only drawn on demand — nothing runs while the scene is idle. */
  invalidate() { this.needs = true; this.kick(); }
  kick() { if (!this.raf) this.raf = requestAnimationFrame(this.loop); }
  /** Lower the pixel ratio while the view is moving on lighter devices, and sharpen again when it rests. */
  setMoving(on) {
    const q = this.quality;
    if (q.moving >= q.ratio) return;
    clearTimeout(this.sharpenT);
    const set = (r) => { if (this.busy || this.renderer.getPixelRatio() === r) return; this.renderer.setPixelRatio(r); this.renderer.setSize(this.w, this.h, false); this.invalidate(); };
    if (on) set(q.moving);
    else this.sharpenT = setTimeout(() => { if (!this.orbiting && !this.gizmo.dragging && !this.app.playing) set(q.ratio); else this.setMoving(false); }, 220);
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width)), hh = Math.max(1, Math.floor(r.height));
    if (this.busy) return; // a render/recording owns the drawing buffer
    this.w = w; this.h = hh;
    this.renderer.setSize(w, hh, false);
    this.persp.clearViewOffset?.(); this.ortho.clearViewOffset?.();
    this.updateProjection(this.camera, w / hh);
    this.invalidate();
  }

  updateProjection(cam, aspect) {
    if (cam.isPerspectiveCamera) { cam.aspect = aspect; }
    else {
      const half = this.orthoHalf || 3;
      cam.left = -half * aspect; cam.right = half * aspect; cam.top = half; cam.bottom = -half;
    }
    cam.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- camera
  setProjection(type) {
    if (this.viewCam) this.exitCameraView({ keep: true });
    if ((type === 'ortho') === this.camera.isOrthographicCamera) return;
    const from = this.camera;
    const to = type === 'ortho' ? this.ortho : this.persp;
    const dist = from.position.distanceTo(this.orbit.target);
    if (to.isOrthographicCamera) {
      // match the visible height at the target distance
      this.orthoHalf = Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2)) * dist;
      to.zoom = 1;
    } else {
      const half = (this.orthoHalf || 3) / (from.zoom || 1);
      const d = half / Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
      const dir = from.position.clone().sub(this.orbit.target).normalize();
      from.position.copy(this.orbit.target).addScaledVector(dir, d);
    }
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    this.camera = to;
    this.orbit.object = to;
    this.gizmo.camera = to;
    this.updateProjection(to, this.w / this.h);
    this.orbit.update();
    this.invalidate();
  }

  setView(name) {
    if (this.viewCam) this.exitCameraView({ keep: true });
    const t = this.orbit.target;
    const d = Math.max(0.5, this.camera.position.distanceTo(t));
    const dirs = { front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001] };
    const v = dirs[name]; if (!v) return;
    this.camera.position.set(t.x + v[0] * d, t.y + v[1] * d, t.z + v[2] * d);
    this.camera.lookAt(t);
    this.orbit.update();
    this.invalidate();
  }

  frameBox(box) { this.frame(null, box); }
  frame(obj, given = null) {
    if (this.viewCam) this.exitCameraView({ keep: true });
    const box = given || (obj ? boundsOf(obj) : this.contentBounds());
    if (!box || box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(0.05, sphere.radius);
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0.6, 0.45, 0.8).normalize();
    const fov = THREE.MathUtils.degToRad(this.persp.fov);
    const aspect = this.w / this.h;
    const fit = r / Math.sin(Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect)) / 2);
    this.orbit.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, fit * 1.08);
    if (this.camera.isOrthographicCamera) { this.orthoHalf = r * 1.15; this.camera.zoom = 1; this.updateProjection(this.camera, aspect); }
    this.persp.near = Math.max(0.005, fit / 500); this.persp.far = Math.max(100, fit * 50); this.persp.updateProjectionMatrix();
    this.orbit.update();
    this.invalidate();
  }

  contentBounds() {
    const b = new THREE.Box3();
    for (const o of this.content.children) if (o.visible && !isEmpty(o)) b.union(boundsOf(o));
    return b.isEmpty() ? null : b;
  }
  allObjects() { return [...editorObjects(this.content), ...editorObjects(this.lights), ...editorObjects(this.cams)]; }
  allLights() { return this.allObjects().filter((o) => o.isLight); }
  shownInScene(o) { for (let p = o; p && p !== this.scene; p = p.parent) if (!p.visible) return false; return true;
  }

  // ---------------------------------------------------------------- scene cameras
  camLocked() { return !!this.app.settings.lockCamera; }
  inScene(o) { for (let p = o; p; p = p.parent) if (p === this.scene) return true; return false; }
  /** Configure a THREE camera from a camera object for a given output aspect (k > 1 widens it for the viewport frame). */
  configCam(obj, aspect, k = 1) {
    const c = camOf(obj), lens = camLens(c, aspect);
    const cam = lens.ortho ? this.rcamO : this.rcamP;
    obj.updateWorldMatrix(true, false);
    obj.matrixWorld.decompose(cam.position, cam.quaternion, _s);
    if (lens.ortho) { const hh = lens.half * k; cam.left = -hh * aspect; cam.right = hh * aspect; cam.top = hh; cam.bottom = -hh; cam.zoom = 1; }
    else { cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(lens.tan * k)); cam.aspect = aspect; }
    cam.near = c.near; cam.far = Math.max(c.near * 1.01, c.far);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    return cam;
  }
  enterCameraView(obj) {
    if (!obj || !this.inScene(obj)) return;
    if (!this.viewCam) this.savedView = this.app.viewState();
    this.app.tween = null;
    this.viewCam = obj;
    this.orbit.enableDamping = false;
    this.syncCamView(true);
    this.invalidate();
  }
  /** keep: stay where the camera was (orbiting out of the camera); otherwise go back to the view before. */
  exitCameraView({ keep = false } = {}) {
    if (!this.viewCam) return;
    this.viewCam = null;
    this.passEl.hidden = true;
    this.orbit.enableDamping = true;
    const sv = this.savedView; this.savedView = null;
    this.persp.near = 0.05; this.persp.far = 2000; this.ortho.near = -1000; this.ortho.far = 1000;
    if (sv && !keep) this.app.applyView(sv);
    else {
      if (sv) this.persp.fov = sv.fov;
      this.updateProjection(this.camera, this.w / this.h);
      this.orbit.update();
    }
    this.invalidate();
    this.app.onCamViewChanged?.();
  }
  /** Rect of the render frame inside the viewport while looking through a camera. */
  frameRect() {
    const r = this.app.settings.render, ar = Math.max(0.05, r.w / r.h);
    const fw = Math.min(this.w, this.h * ar) * 0.86, fh = fw / ar;
    return { x: (this.w - fw) / 2, y: (this.h - fh) / 2, w: fw, h: fh, ar };
  }
  syncCamView(force = false) {
    const o = this.viewCam; if (!o) return;
    if (!this.inScene(o)) { this.exitCameraView(); return; }
    const c = camOf(o), f = this.frameRect(), lens = camLens(c, f.ar), k = this.h / f.h;
    const want = lens.ortho ? this.ortho : this.persp;
    if (this.camera !== want) { this.camera = want; this.orbit.object = want; this.gizmo.camera = want; }
    const cam = this.camera;
    if (force || !(this.orbiting && this.camLocked())) {
      o.updateWorldMatrix(true, false);
      o.matrixWorld.decompose(cam.position, cam.quaternion, _s);
      const b = this.contentBounds();
      const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
      let d = b ? b.getCenter(_v2).sub(cam.position).dot(fwd) : 5;
      if (!(d > 0.2)) d = 5;
      this.orbit.target.copy(cam.position).addScaledVector(fwd, d);
    }
    if (lens.ortho) { this.orthoHalf = lens.half * k; cam.zoom = 1; cam.near = c.near; cam.far = c.far; }
    else { cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(lens.tan * k)); cam.near = c.near; cam.far = Math.max(c.near * 1.01, c.far); }
    this.updateProjection(cam, this.w / this.h);
    const st = this.passEl.style;
    st.left = f.x + 'px'; st.top = f.y + 'px'; st.width = f.w + 'px'; st.height = f.h + 'px';
    this.passEl.hidden = false;
    const label = o.name + (this.camLocked() ? ' · locked to view' : '');
    if (this.passLabel.textContent !== label) this.passLabel.textContent = label;
  }
  /** Locked camera: the orbit moved the view, so move the camera object with it. */
  writeCamFromView() {
    const o = this.viewCam; if (!o) return;
    const cam = this.camera;
    cam.updateMatrixWorld(true);
    if (cam.isOrthographicCamera && cam.zoom !== 1) { o.userData.cam = { ...camOf(o), orthoScale: camOf(o).orthoScale / cam.zoom }; cam.zoom = 1; }
    this.setWorldPose(o, cam.position, cam.quaternion);
    this.app.onGizmoChange?.();
  }
  /** Set an object's world position / rotation (its own scale is kept), whatever it is parented to. */
  setWorldPose(o, pos, quat) {
    const parent = o.parent;
    parent.updateWorldMatrix(true, false);
    _m.compose(pos, quat, _one);
    _m.premultiply(_m2.copy(parent.matrixWorld).invert());
    const sc = o.scale.clone();
    _m.decompose(o.position, o.quaternion, _s);
    o.scale.copy(sc);
    o.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- environment
  applySettings() {
    const st = this.app.settings;
    const env = st.env;
    const r = this.renderer;
    r.toneMapping = TONE[env.toneMapping] ?? THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = env.exposure;
    r.shadowMap.enabled = !!st.shadows;
    // lighting environment
    this.envTex = env.lighting && env.lighting !== 'none' ? this.envFor(env.lighting) : null;
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = env.intensity;
    // background
    this.scene.backgroundBlurriness = 0;
    this.scene.backgroundIntensity = 1;
    if (env.background === 'solid') this.scene.background = new THREE.Color(env.color);
    else if (env.background === 'gradient') this.scene.background = this.gradientTexture(env.top, env.bottom);
    else if (env.background === 'environment') {
      if (!this.envTex) this.envTex = this.envFor('studio'); this.scene.background = this.envTex; this.scene.backgroundBlurriness = env.blur; this.scene.backgroundIntensity = env.intensity;
    }
    else this.scene.background = null;
    this.host.classList.toggle('is-transparent', !this.scene.background);
    // ground
    const g = st.ground;
    if (g.mode === 'solid') {
      if (!this.ground.material.isMeshStandardMaterial) { this.ground.material.dispose(); this.ground.material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }); }
      this.ground.material.color.set(g.color);
    } else if (!this.ground.material.isShadowMaterial) { this.ground.material.dispose(); this.ground.material = new THREE.ShadowMaterial(); }
    if (this.ground.material.isShadowMaterial) { this.ground.material.opacity = g.opacity; this.ground.material.transparent = true; }
    this.ground.visible = g.mode !== 'none';
    const ov = st.overlays || { on: true, axes: true, helpers: true };
    this.grid.visible = !!g.grid && ov.on;
    this.axes.visible = !!ov.axes && ov.on;
    this.icons.visible = !!ov.helpers && ov.on;
    // fog
    const fog = st.fog;
    if (fog && fog.on) { if (!this.scene.fog) this.scene.fog = new THREE.FogExp2(fog.color, fog.density); this.scene.fog.color.set(fog.color); this.scene.fog.density = fog.density; }
    else this.scene.fog = null;
    this.fitShadows();
    this.invalidate();
  }

  gradientTexture(top, bottom) {
    const key = top + bottom;
    if (this.gradKey === key && this.gradTex) return this.gradTex;
    const c = document.createElement('canvas'); c.width = 4; c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, top); gr.addColorStop(1, bottom);
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    this.gradTex?.dispose();
    this.gradTex = new THREE.CanvasTexture(c);
    this.gradTex.colorSpace = THREE.SRGBColorSpace;
    this.gradKey = key;
    return this.gradTex;
  }

  /** Size directional shadow cameras to the content so shadows stay sharp. */
  fitShadows() {
    const b = this.contentBounds();
    const sphere = b ? b.getBoundingSphere(new THREE.Sphere()) : new THREE.Sphere(new THREE.Vector3(), 3);
    const r = Math.max(2, sphere.radius * 1.4);
    const ms = this.quality.shadow;
    for (const l of this.allLights()) {
      if (l.shadow && l.shadow.mapSize.x !== ms) { l.shadow.mapSize.set(ms, ms); l.shadow.map?.dispose(); l.shadow.map = null; }
      if (!l.isDirectionalLight || !l.shadow) continue;
      const c = l.shadow.camera;
      c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 0.05; c.far = Math.max(50, l.getWorldPosition(_v).distanceTo(sphere.center) + r * 3);
      c.updateProjectionMatrix();
    }
    this.ground.position.y = 0;
  }

  // ---------------------------------------------------------------- light icons (editor-only)
  syncLightIcons() {
    const seen = new Set();
    for (const l of this.allLights()) {
      seen.add(l);
      let ic = this.lightIcons.get(l);
      if (!ic) {
        ic = new THREE.Group();
        ic.matrixAutoUpdate = false;
        const mat = new THREE.MeshBasicMaterial({ color: 0xffd76a, wireframe: true, depthTest: false, transparent: true, opacity: 0.95, toneMapped: false });
        const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), mat);
        body.userData.pickLight = l;
        body.renderOrder = 998;
        ic.add(body);
        if (l.isRectAreaLight) {
          const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 0), new THREE.Vector3(-0.5, 0.5, 0), new THREE.Vector3(-0.5, -0.5, 0)]);
          const rect = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd76a, depthTest: false, transparent: true, toneMapped: false }));
          rect.renderOrder = 998; rect.userData.areaRect = true;
          ic.add(rect);
        }
        if (l.isDirectionalLight || l.isSpotLight || l.isRectAreaLight) {
          const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -0.9)]);
          const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd76a, depthTest: false, transparent: true, toneMapped: false }));
          line.renderOrder = 998;
          ic.add(line);
        }
        this.icons.add(ic);
        this.lightIcons.set(l, ic);
      }
      l.updateWorldMatrix(true, false);
      l.matrixWorld.decompose(_v, _q, _s);
      ic.matrix.compose(_v, _q, _one);
      // keep the icon a constant size on screen
      const d = this.camera.isPerspectiveCamera ? this.camera.position.distanceTo(_v) : (this.orthoHalf || 3) / this.camera.zoom * 3;
      ic.children[0].scale.setScalar(Math.max(0.3, d * 0.1));
      ic.children[0].material.color.set(l.color || 0xffffff).lerp(_yellow, 0.5);
      if (l.isRectAreaLight) { const rc = ic.children.find((c) => c.userData.areaRect); if (rc) rc.scale.set(l.width, l.height, 1); }
      ic.visible = this.shownInScene(l);
    }
    for (const [l, ic] of this.lightIcons) if (!seen.has(l)) { ic.removeFromParent(); ic.traverse((n) => { n.geometry?.dispose(); n.material?.dispose(); }); this.lightIcons.delete(l); }
  }

  // ---------------------------------------------------------------- camera / empty helpers (editor-only)
  syncObjHelpers() {
    const seen = new Set();
    const activeId = this.app.settings.activeCamera;
    const r = this.app.settings.render, ar = Math.max(0.05, r.w / r.h);
    for (const o of this.allObjects()) {
      const cam = isCam(o);
      if (!cam && !isEmpty(o)) continue;
      seen.add(o);
      let hp = this.objHelpers.get(o);
      if (!hp) {
        hp = new THREE.Group(); hp.matrixAutoUpdate = false;
        const mat = new THREE.LineBasicMaterial({ color: 0xe8e8e8, transparent: true, opacity: 0.95, toneMapped: false });
        const lines = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
        const pick = new THREE.Mesh(cam ? new THREE.BoxGeometry(1, 1, 1) : new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
        pick.userData.pickObj = o;
        hp.add(lines, pick);
        if (!cam) {
          const pts = []; for (const a of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) pts.push(new THREE.Vector3(-a[0], -a[1], -a[2]).multiplyScalar(0.5), new THREE.Vector3(a[0], a[1], a[2]).multiplyScalar(0.5));
          lines.geometry.setFromPoints(pts);
        }
        this.icons.add(hp);
        this.objHelpers.set(o, hp);
      }
      o.updateWorldMatrix(true, false);
      o.matrixWorld.decompose(_v, _q, _s);
      hp.matrix.compose(_v, _q, _one);
      const [lines, pick] = hp.children;
      if (cam) {
        const c = camOf(o), lens = camLens(c, ar);
        const key = [c.type, c.focal, c.sensor, c.fit, c.orthoScale, ar].join('|');
        if (hp.userData.key !== key) {
          hp.userData.key = key;
          const dz = lens.ortho ? 0.8 : 0.9;
          const hh = lens.ortho ? lens.half : lens.tan * dz, hw = hh * ar;
          const nh = lens.ortho ? hh : 0, nw = lens.ortho ? hw : 0;
          const P = (x, y, z) => new THREE.Vector3(x, y, z);
          const n = [P(-nw, -nh, 0), P(nw, -nh, 0), P(nw, nh, 0), P(-nw, nh, 0)], fr = [P(-hw, -hh, -dz), P(hw, -hh, -dz), P(hw, hh, -dz), P(-hw, hh, -dz)];
          const pts = [];
          for (let i = 0; i < 4; i++) { pts.push(n[i], fr[i], fr[i], fr[(i + 1) % 4]); if (lens.ortho) pts.push(n[i], n[(i + 1) % 4]); }
          pts.push(P(-hw * 0.45, hh * 1.08, -dz), P(0, hh * 1.4, -dz), P(0, hh * 1.4, -dz), P(hw * 0.45, hh * 1.08, -dz), P(hw * 0.45, hh * 1.08, -dz), P(-hw * 0.45, hh * 1.08, -dz));
          lines.geometry.dispose(); lines.geometry = new THREE.BufferGeometry().setFromPoints(pts);
          pick.scale.set(Math.max(0.3, hw * 2), Math.max(0.3, hh * 2), dz); pick.position.set(0, 0, -dz / 2);
        }
        lines.material.color.set(this.app.isSelected(o) ? 0xff7a45 : o.userData.eyadId === activeId ? 0xffd76a : 0xd8d8d8);
      } else lines.material.color.set(this.app.isSelected(o) ? 0xff7a45 : 0xd8d8d8);
      // a camera sitting right at the viewpoint (just added from the view) would draw its frustum across the screen
      hp.visible = this.shownInScene(o) && this.viewCam !== o && !(cam && this.camera.position.distanceTo(_v) < 0.35);
    }
    for (const [o, hp] of this.objHelpers) if (!seen.has(o)) { hp.removeFromParent(); hp.traverse((n) => { n.geometry?.dispose(); n.material?.dispose(); }); this.objHelpers.delete(o); }
  }

  // ---------------------------------------------------------------- selection helpers
  attach(obj) {
    if (obj && !obj.visible) obj = null;
    if (obj) this.gizmo.attach(obj); else this.gizmo.detach();
    this.invalidate();
  }
  updateSelBox() {
    const o = this.app.selected;
    const boxable = (x) => x && !x.isLight && !isCam(x) && !isEmpty(x) && this.inScene(x) && this.shownInScene(x);
    if (!boxable(o)) this.selBox.visible = false;
    else { this.selBox.box.copy(boundsOf(o)); this.selBox.visible = true; }
    const rest = (this.app.multi || []).filter((x) => x !== o && boxable(x));
    while (this.selBoxes.length < rest.length) {
      const b = new THREE.Box3Helper(new THREE.Box3(), 0xffb38a);
      b.material.depthTest = false; b.material.transparent = true; b.material.opacity = 0.75; b.renderOrder = 998;
      this.helpers.add(b); this.selBoxes.push(b);
    }
    this.selBoxes.forEach((b, i) => { b.visible = i < rest.length; if (b.visible) b.box.copy(boundsOf(rest[i])); });
  }

  // ---------------------------------------------------------------- picking
  bindPicking() {
    let down = null, lp = 0;
    const cv = this.canvas, app = this.app;
    const clearLP = () => { clearTimeout(lp); lp = 0; };
    cv.addEventListener('pointerdown', (e) => {
      this.gizmoUsed = false;
      if (this.pointerCount === undefined) this.pointerCount = 0;
      this.pointerCount++;
      clearLP();
      down = this.pointerCount === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button, type: e.pointerType } : null;
      if (e.pointerType !== 'touch') cv.focus({ preventScroll: true });
      if (down && this.boxArmed && e.button === 0) { this.startBox(e); down = null; return; }
      // touch: hold still to open the object / add menu
      if (down && e.pointerType === 'touch') {
        const d = down;
        lp = setTimeout(() => {
          lp = 0;
          if (down !== d || this.gizmo.dragging || this.gizmoUsed || app.modal?.busy) return;
          down = null;
          app.openContextAt(d.x, d.y);
        }, 520);
      }
    });
    cv.addEventListener('pointermove', (e) => { if (lp && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 9) clearLP(); }, { passive: true });
    const end = () => { this.pointerCount = Math.max(0, (this.pointerCount || 1) - 1); clearLP(); };
    cv.addEventListener('pointercancel', () => { end(); down = null; });
    cv.addEventListener('pointerup', (e) => {
      end();
      const d = down; down = null;
      if (!d || this.gizmoUsed) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
      if (d.button === 2) { app.openContextAt(e.clientX, e.clientY); return; }
      if (d.button !== 0) return;
      const hit = this.pick(e.clientX, e.clientY);
      if (app.onViewportPick?.(hit) === true) return;
      app.select(hit, { fromViewport: true, add: e.shiftKey || e.ctrlKey || e.metaKey || !!app.addMode });
    });
    cv.addEventListener('dblclick', (e) => { const hit = this.pick(e.clientX, e.clientY); if (hit) this.frame(hit.isLight ? null : hit); });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Box select: the next drag on the canvas draws a rectangle instead of orbiting. */
  armBox(on = true) {
    this.boxArmed = !!on;
    this.orbit.enabled = !on && !this.gizmo.dragging;
    this.gizmo.enabled = !on;
    this.host.classList.toggle('is-boxing', !!on);
    this.app.onBoxArmed?.(!!on);
  }
  startBox(e) {
    const cv = this.canvas, r = this.host.getBoundingClientRect();
    const el = document.createElement('div'); el.className = 't3-box';
    this.host.appendChild(el);
    const x0 = e.clientX, y0 = e.clientY, id = e.pointerId, add = e.shiftKey || !!this.app.addMode;
    try { cv.setPointerCapture(id); } catch (err) { /* ignore */ }
    let rect = null;
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      const x1 = Math.min(x0, ev.clientX), y1 = Math.min(y0, ev.clientY), w = Math.abs(ev.clientX - x0), hh = Math.abs(ev.clientY - y0);
      rect = { x: x1, y: y1, w, h: hh };
      el.style.cssText = `left:${x1 - r.left}px;top:${y1 - r.top}px;width:${w}px;height:${hh}px`;
    };
    const up = (ev) => {
      if (ev.pointerId !== id) return;
      cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up);
      el.remove();
      this.armBox(false);
      if (ev.type === 'pointerup' && rect && rect.w > 4 && rect.h > 4) this.app.selectMany(this.objectsInRect(rect), { add });
    };
    cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  }
  /** Editor objects whose centre projects inside a client-space rectangle. */
  objectsInRect(rect) {
    const r = this.canvas.getBoundingClientRect(), out = [];
    this.camera.updateMatrixWorld(true);
    for (const o of this.allObjects()) {
      if (o.userData.eyadLocked || !this.shownInScene(o)) continue;
      if (o.isLight || isCam(o) || isEmpty(o)) o.getWorldPosition(_v); else { const b = boundsOf(o); if (b.isEmpty()) o.getWorldPosition(_v); else b.getCenter(_v); }
      _v.project(this.camera);
      if (_v.z < -1 || _v.z > 1) continue;
      const x = r.left + (_v.x * 0.5 + 0.5) * r.width, y = r.top + (-_v.y * 0.5 + 0.5) * r.height;
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) out.push(o);
    }
    return out;
  }

  pick(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const free = (o) => o && !o.userData.eyadLocked;
    // light / camera / empty icons first (they are drawn on top)
    if (this.icons.visible) {
      const groups = [...this.lightIcons.values(), ...this.objHelpers.values()].filter((g) => g.visible);
      for (const g of groups) g.updateMatrixWorld(true);
      const picks = [];
      for (const g of groups) for (const c of g.children) if (c.userData.pickLight || c.userData.pickObj) picks.push(c);
      for (const li of this.raycaster.intersectObjects(picks, false)) { const o = li.object.userData.pickLight || li.object.userData.pickObj; if (free(o)) return o; }
    }
    const hits = this.raycaster.intersectObjects(this.content.children, true);
    for (const h of hits) {
      let o = h.object, visible = true;
      for (let p = o; p && p !== this.content; p = p.parent) if (!p.visible) { visible = false; break; }
      if (!visible) continue;
      while (o && o !== this.content && !(o.userData && o.userData.eyadId)) o = o.parent;
      if (o && o !== this.content && free(o)) return o;
    }
    return null;
  }

  // ---------------------------------------------------------------- loop
  loop() {
    this.raf = 0;
    if (this.busy || this.lost) return;
    if (this.hold) return;
    // in a camera view the orbit only runs while it is being dragged (it would level a rolled camera otherwise)
    const damp = this.orbit.enabled && !(this.viewCam && !this.orbiting) ? this.orbit.update() : false;
    const tick = this.app.tick?.();
    if (!this.needs && !damp && !tick) return;
    this.needs = false;
    this.syncCamView();
    this.syncLightIcons();
    this.syncObjHelpers();
    this.updateSelBox();
    this.renderView();
    this.frames++;
    this.app.onRendered?.();
    // keep going only while something is still moving (damping, playback, a camera tween)
    if (damp || tick || this.needs) this.kick();
  }

  studioEnv() { return this.envFor('studio'); }
  /** A prefiltered lighting environment, built once per kind and cached. */
  envFor(kind) {
    this.envs = this.envs || {};
    if (this.envs[kind]) return this.envs[kind];
    const dispose = (root) => root.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.dispose?.(); });
    let scene;
    const def = SKY[kind];
    if (!def) scene = new RoomEnvironment();
    else {
      scene = new THREE.Scene();
      const g = new THREE.SphereGeometry(50, 32, 24);
      const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
      const [zen, hor, gnd] = def.c.map((c) => new THREE.Color(c));
      const tmp = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 50;
        if (y >= 0) tmp.copy(hor).lerp(zen, Math.pow(y, 0.55)); else tmp.copy(hor).lerp(gnd, Math.min(1, -y * 4));
        col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, toneMapped: false })));
      for (const [c, k, az, el, size] of def.panels) {
        const m = new THREE.Mesh(new THREE.CircleGeometry(size, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide, toneMapped: false }));
        const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
        m.position.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(40);
        m.lookAt(0, 0, 0);
        scene.add(m);
      }
    }
    const tex = this.pmrem.fromScene(scene, def ? 0 : 0.04).texture;
    dispose(scene);
    this.envs[kind] = tex;
    return tex;
  }
  /** Draw the editor view in the chosen shading mode (renders for output always use the full look). */
  renderView() {
    const r = this.renderer, s = this.scene, cam = this.camera;
    const mode = this.app.settings.shading || 'rendered';
    if (mode === 'rendered') { r.render(s, cam); return; }
    const lights = this.allLights().filter((l) => l.visible);
    for (const l of lights) l.visible = false;
    const env = s.environment, envI = s.environmentIntensity, fog = s.fog;
    s.environment = this.studioEnv(); s.environmentIntensity = 1; s.fog = null;
    try {
      if (mode === 'material') r.render(s, cam);
      else {
        const hv = this.helpers.visible, gv = this.gizmoHelper.visible, gr = this.ground.visible;
        this.helpers.visible = false; this.gizmoHelper.visible = false; this.ground.visible = false;
        s.overrideMaterial = mode === 'wire' ? this.wireMat : this.solidMat;
        r.render(s, cam);
        s.overrideMaterial = null;
        const bg = s.background;
        s.background = null; this.content.visible = false; this.helpers.visible = hv; this.gizmoHelper.visible = gv;
        r.autoClear = false;
        try { r.render(s, cam); } finally { r.autoClear = true; s.background = bg; this.content.visible = true; this.ground.visible = gr; }
      }
    } finally {
      s.overrideMaterial = null;
      s.environment = env; s.environmentIntensity = envI; s.fog = fog;
      for (const l of lights) l.visible = true;
    }
  }

  // ---------------------------------------------------------------- output rendering
  /**
   * Draw one clean frame (no grid, gizmo or icons) at W×H into a 2D context.
   * The WebGL drawing buffer is resized for the duration of a batch; call
   * beginOutput()/endOutput() around a sequence of frames.
   */
  /** Which camera object an output uses: 'view' = what the viewport shows, 'active' = the scene's active camera, or a camera id. */
  outputCamObj(camera = 'active') {
    if (camera === 'view') return this.viewCam || null;
    const all = this.allObjects().filter(isCam);
    if (camera && camera !== 'active') { const c = all.find((o) => o.userData.eyadId === camera); if (c) return c; }
    return all.find((o) => o.userData.eyadId === this.app.settings.activeCamera) || null;
  }
  beginOutput(W, H, { transparent = false, scale = 1, camera = 'active' } = {}) {
    this.busy = true;
    const camObj = this.outputCamObj(camera);
    this.out = { W, H, scale, transparent, camObj, prevBg: this.scene.background, prevRatio: this.renderer.getPixelRatio(), clearAlpha: this.renderer.getClearAlpha() };
    this.helpers.visible = false;
    this.gizmoHelper.visible = false;
    if (transparent) { this.scene.background = null; this.renderer.setClearColor(0x000000, 0); }
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(Math.round(W * scale), Math.round(H * scale), false);
    if (!camObj) { if (this.viewCam) this.exitCameraView({ keep: true }); this.updateProjection(this.camera, W / H); }
  }
  /** jitter: sub-pixel offset [x, y] in output pixels; alpha: blend weight for sample accumulation. */
  drawOutput(ctx, { jitter = null, alpha = 1 } = {}) {
    const o = this.out;
    const cam = o.camObj ? this.configCam(o.camObj, o.W / o.H) : this.camera;
    const bw = this.canvas.width, bh = this.canvas.height;
    if (jitter) { cam.setViewOffset(bw, bh, jitter[0] * o.scale, jitter[1] * o.scale, bw, bh); }
    this.renderer.render(this.scene, cam);
    if (jitter) cam.clearViewOffset();
    if (alpha >= 1) ctx.clearRect(0, 0, o.W, o.H);
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.canvas, 0, 0, bw, bh, 0, 0, o.W, o.H);
    ctx.globalAlpha = 1;
  }
  endOutput() {
    const o = this.out; if (!o) return;
    this.scene.background = o.prevBg;
    this.renderer.setClearColor(0x000000, o.clearAlpha);
    this.helpers.visible = true;
    this.gizmoHelper.visible = true;
    this.renderer.setPixelRatio(o.prevRatio);
    this.out = null;
    this.busy = false;
    this.resize();
    this.applySettings();
  }
  maxOutputSize() {
    const gl = this.renderer.getContext();
    return Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0], 8192);
  }

  /** Render a PNG blob. samples > 1 accumulates jittered frames for smoother edges. */
  async renderPNG(W, H, { transparent = false, supersample = true, samples = 1, camera = 'active', onSample = null } = {}) {
    const max = this.maxOutputSize();
    W = Math.max(16, Math.min(Math.round(W), 4096, max)); H = Math.max(16, Math.min(Math.round(H), 4096, max));
    const scale = supersample && W * 2 <= max && H * 2 <= max && W * H <= 2560 * 2560 ? 2 : 1;
    samples = Math.max(1, Math.min(64, Math.round(samples) || 1));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    this.beginOutput(W, H, { transparent, scale, camera });
    try {
      if (samples === 1) this.drawOutput(ctx);
      else {
        for (let i = 0; i < samples; i++) {
          // Halton(2,3) sub-pixel offsets
          const hal = (n, b) => { let f = 1, r = 0; while (n > 0) { f /= b; r += f * (n % b); n = Math.floor(n / b); } return r; };
          this.drawOutput(ctx, { jitter: [hal(i + 1, 2) - 0.5, hal(i + 1, 3) - 0.5], alpha: 1 / (i + 1) });
          if (onSample && i % 4 === 3) await onSample(i + 1, samples);
        }
      }
    } finally { this.endOutput(); }
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('The browser could not encode the PNG.'))), 'image/png'));
  }
}
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _s = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _yellow = new THREE.Color(0xffd76a);
