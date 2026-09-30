// EYAD 3D — viewport: WebGL renderer, scene graph, cameras, orbit + gizmo
// controls, environment / background / ground, helpers, picking, and
// offscreen-quality still rendering.
import * as THREE from '../../vendor/three/three.module.js';
import { OrbitControls } from '../../vendor/three/addons/controls/OrbitControls.js';
import { TransformControls } from '../../vendor/three/addons/controls/TransformControls.js';
import { RoomEnvironment } from '../../vendor/three/addons/environments/RoomEnvironment.js';
import { boundsOf } from './objects.js';

export const TONE = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, none: THREE.NoToneMapping };

export function defaultSettings() {
  return {
    env: { lighting: 'studio', intensity: 1, background: 'gradient', color: '#202022', top: '#3b3b40', bottom: '#111113', blur: 0.35, toneMapping: 'aces', exposure: 1 },
    ground: { mode: 'shadow', color: '#8c877d', opacity: 0.35, grid: true },
    shadows: true,
    snap: { on: false, move: 0.25, rotate: 15, scale: 0.1 },
    camera: { type: 'persp', fov: 40, pos: [4.2, 3.1, 5.6], target: [0, 0.6, 0], zoom: 1 },
    render: { w: 1920, h: 1080, transparent: false, ss: true },
    video: { w: 1280, h: 720, fps: 30, motion: 'timeline' },
  };
}

export class Viewport {
  constructor(app, host) {
    this.app = app;
    this.host = host;
    this.needs = true;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
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
    s.add(this.content, this.lights, this.helpers);

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

    this.selBox = new THREE.Box3Helper(new THREE.Box3(), 0xff4a3d);
    this.selBox.visible = false;
    this.selBox.material.depthTest = false; this.selBox.material.transparent = true; this.selBox.material.opacity = 0.9;
    this.selBox.renderOrder = 999;
    this.helpers.add(this.selBox);

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
    this.orbit.addEventListener('change', () => { this.invalidate(); app.onCameraMoved?.(); });
    this.orbit.addEventListener('start', () => { this.orbiting = true; });
    this.orbit.addEventListener('end', () => { this.orbiting = false; app.onCameraEnd?.(); });

    this.gizmo = new TransformControls(this.camera, this.canvas);
    this.gizmo.setSize(matchMedia('(pointer: coarse)').matches ? 1.35 : 1);
    this.gizmoHelper = this.gizmo.getHelper();
    s.add(this.gizmoHelper);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
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
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  invalidate() { this.needs = true; }

  resize() {
    const r = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width)), hh = Math.max(1, Math.floor(r.height));
    if (this.busy) return; // a render/recording owns the drawing buffer
    this.w = w; this.h = hh;
    this.renderer.setSize(w, hh, false);
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
    const t = this.orbit.target;
    const d = Math.max(0.5, this.camera.position.distanceTo(t));
    const dirs = { front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001] };
    const v = dirs[name]; if (!v) return;
    this.camera.position.set(t.x + v[0] * d, t.y + v[1] * d, t.z + v[2] * d);
    this.camera.lookAt(t);
    this.orbit.update();
    this.invalidate();
  }

  frame(obj) {
    const box = obj ? boundsOf(obj) : this.contentBounds();
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
    for (const o of this.content.children) if (o.visible) b.union(boundsOf(o));
    return b.isEmpty() ? null : b;
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
    if (env.lighting === 'studio') {
      if (!this.envTex) { const room = new RoomEnvironment(); this.envTex = this.pmrem.fromScene(room, 0.04).texture; room.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.dispose?.(); }); }
      this.scene.environment = this.envTex;
    } else this.scene.environment = null;
    this.scene.environmentIntensity = env.intensity;
    // background
    this.scene.backgroundBlurriness = 0;
    this.scene.backgroundIntensity = 1;
    if (env.background === 'solid') this.scene.background = new THREE.Color(env.color);
    else if (env.background === 'gradient') this.scene.background = this.gradientTexture(env.top, env.bottom);
    else if (env.background === 'environment' && this.envTex) { this.scene.background = this.envTex; this.scene.backgroundBlurriness = env.blur; this.scene.backgroundIntensity = env.intensity; }
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
    this.grid.visible = !!g.grid;
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
    for (const l of this.lights.children) {
      if (!l.isDirectionalLight || !l.shadow) continue;
      const c = l.shadow.camera;
      c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 0.05; c.far = Math.max(50, l.position.distanceTo(sphere.center) + r * 3);
      c.updateProjectionMatrix();
    }
    this.ground.position.y = 0;
  }

  // ---------------------------------------------------------------- light icons (editor-only)
  syncLightIcons() {
    const seen = new Set();
    for (const l of this.lights.children) {
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
        if (l.isDirectionalLight || l.isSpotLight) {
          const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -0.9)]);
          const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd76a, depthTest: false, transparent: true, toneMapped: false }));
          line.renderOrder = 998;
          ic.add(line);
        }
        this.helpers.add(ic);
        this.lightIcons.set(l, ic);
      }
      l.updateWorldMatrix(true, false);
      ic.matrix.copy(l.matrixWorld);
      // keep the icon a constant size on screen
      const d = this.camera.isPerspectiveCamera ? this.camera.position.distanceTo(l.position) : (this.orthoHalf || 3) / this.camera.zoom * 3;
      ic.children[0].scale.setScalar(Math.max(0.3, d * 0.1));
      ic.children[0].material.color.set(l.color || 0xffffff).lerp(new THREE.Color(0xffd76a), 0.5);
      ic.visible = l.visible;
    }
    for (const [l, ic] of this.lightIcons) if (!seen.has(l)) { ic.removeFromParent(); ic.traverse((n) => { n.geometry?.dispose(); n.material?.dispose(); }); this.lightIcons.delete(l); }
  }

  // ---------------------------------------------------------------- selection helpers
  attach(obj) {
    if (obj && !obj.visible) obj = null;
    if (obj) this.gizmo.attach(obj); else this.gizmo.detach();
    this.invalidate();
  }
  updateSelBox() {
    const o = this.app.selected;
    if (!o || o.isLight || !o.visible || !o.parent) { this.selBox.visible = false; return; }
    this.selBox.box.copy(boundsOf(o));
    this.selBox.visible = true;
  }

  // ---------------------------------------------------------------- picking
  bindPicking() {
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      this.gizmoUsed = false;
      if (this.pointerCount === undefined) this.pointerCount = 0;
      this.pointerCount++;
      down = this.pointerCount === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button } : null;
      this.canvas.focus({ preventScroll: true });
    });
    const end = () => { this.pointerCount = Math.max(0, (this.pointerCount || 1) - 1); };
    this.canvas.addEventListener('pointercancel', () => { end(); down = null; });
    this.canvas.addEventListener('pointerup', (e) => {
      end();
      const d = down; down = null;
      if (!d || d.button !== 0 || this.gizmoUsed) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
      const hit = this.pick(e.clientX, e.clientY);
      this.app.select(hit, { fromViewport: true });
    });
    this.canvas.addEventListener('dblclick', (e) => { const hit = this.pick(e.clientX, e.clientY); if (hit) this.frame(hit.isLight ? null : hit); });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  pick(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // light icons first (they are drawn on top)
    const groups = [...this.lightIcons.values()].filter((g) => g.visible);
    for (const g of groups) g.updateMatrixWorld(true);
    const icons = groups.map((g) => g.children[0]);
    const li = this.raycaster.intersectObjects(icons, false)[0];
    if (li) return li.object.userData.pickLight;
    const hits = this.raycaster.intersectObjects(this.content.children, true);
    for (const h of hits) {
      let o = h.object, visible = true;
      for (let p = o; p && p !== this.content; p = p.parent) if (!p.visible) { visible = false; break; }
      if (!visible) continue;
      while (o.parent && o.parent !== this.content) o = o.parent;
      if (o.parent === this.content) return o;
    }
    return null;
  }

  // ---------------------------------------------------------------- loop
  loop() {
    requestAnimationFrame(this.loop);
    if (this.busy || this.lost) return;
    const damp = this.orbit.enabled ? this.orbit.update() : false;
    const tick = this.app.tick?.();
    if (!this.needs && !damp && !tick) return;
    this.needs = false;
    this.syncLightIcons();
    this.updateSelBox();
    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------- output rendering
  /**
   * Draw one clean frame (no grid, gizmo or icons) at W×H into a 2D context.
   * The WebGL drawing buffer is resized for the duration of a batch; call
   * beginOutput()/endOutput() around a sequence of frames.
   */
  beginOutput(W, H, { transparent = false, scale = 1 } = {}) {
    this.busy = true;
    this.out = { W, H, scale, transparent, prevBg: this.scene.background, prevRatio: this.renderer.getPixelRatio(), aspect: this.camera.isPerspectiveCamera ? this.camera.aspect : null, clearAlpha: this.renderer.getClearAlpha() };
    this.helpers.visible = false;
    this.gizmoHelper.visible = false;
    if (transparent) { this.scene.background = null; this.renderer.setClearColor(0x000000, 0); }
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(Math.round(W * scale), Math.round(H * scale), false);
    this.updateProjection(this.camera, W / H);
  }
  drawOutput(ctx) {
    const o = this.out;
    this.renderer.render(this.scene, this.camera);
    ctx.clearRect(0, 0, o.W, o.H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.canvas, 0, 0, this.canvas.width, this.canvas.height, 0, 0, o.W, o.H);
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

  /** Render a PNG blob. */
  async renderPNG(W, H, { transparent = false, supersample = true } = {}) {
    const max = this.maxOutputSize();
    W = Math.max(16, Math.min(Math.round(W), 4096, max)); H = Math.max(16, Math.min(Math.round(H), 4096, max));
    const scale = supersample && W * 2 <= max && H * 2 <= max && W * H <= 2560 * 2560 ? 2 : 1;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    this.beginOutput(W, H, { transparent, scale });
    try { this.drawOutput(ctx); } finally { this.endOutput(); }
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('The browser could not encode the PNG.'))), 'image/png'));
  }
}
