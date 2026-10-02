// EYAD 3D — keyframe animation: object transform tracks, a camera track
// (spherical around the orbit target, so camera moves travel on arcs), a
// one-click turntable, and playback of glTF clips through AnimationMixer.
//
// anim = { duration, loop, tracks: { [objectId]: [{ t, p:[3], q:[4], s:[3], ease }] },
//          camera: [{ t, target:[3], r, theta, phi, fov, zoom, ease }] }
import * as THREE from '../../vendor/three/three.module.js';
import { num, bool, oneOf } from '../core/eyad.js';

export const EASES = [['ease', 'Ease in-out'], ['linear', 'Linear'], ['in', 'Ease in'], ['out', 'Ease out'], ['step', 'Hold']];
const EASE_IDS = EASES.map((e) => e[0]);

export function newAnim() { return { duration: 5, loop: true, tracks: {}, camera: [] }; }

export function ease(kind, u) {
  switch (kind) {
    case 'linear': return u;
    case 'in': return u * u * u;
    case 'out': return 1 - Math.pow(1 - u, 3);
    case 'step': return u < 1 ? 0 : 1;
    default: return u * u * (3 - 2 * u);
  }
}

const EPS = 1e-4;
export function keyIndexAt(keys, t, tol = EPS) { return keys.findIndex((k) => Math.abs(k.t - t) <= tol); }

function upsert(keys, key, tol) {
  const i = keyIndexAt(keys, key.t, tol);
  if (i >= 0) keys[i] = { ...keys[i], ...key, t: keys[i].t };
  else { keys.push(key); keys.sort((a, b) => a.t - b.t); }
}

// -------------------------------------------------------------- objects

export function objectKey(obj, t, ease = 'ease') {
  const k = { t, p: obj.position.toArray(), q: obj.quaternion.toArray(), s: obj.scale.toArray(), ease };
  // camera objects also key their lens
  if (obj.userData && obj.userData.eyadKind === 'camera' && obj.userData.cam) { k.f = Number(obj.userData.cam.focal) || 50; k.os = Number(obj.userData.cam.orthoScale) || 6; }
  return k;
}
export function setObjectKey(anim, obj, t, tol, easeKind) {
  const id = obj.userData.eyadId;
  const keys = anim.tracks[id] || (anim.tracks[id] = []);
  const prev = keys[keyIndexAt(keys, t, tol)];
  upsert(keys, objectKey(obj, t, prev?.ease || easeKind || 'ease'), tol);
}

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
export function sampleObject(keys, t, obj) {
  if (!keys || !keys.length) return false;
  let a = keys[0], b = keys[keys.length - 1], u = 0;
  if (t <= a.t) b = a;
  else if (t >= b.t) a = b;
  else {
    for (let i = 0; i < keys.length - 1; i++) if (t >= keys[i].t && t <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break; }
    u = ease(b.ease, (t - a.t) / Math.max(1e-9, b.t - a.t));
  }
  obj.position.set(a.p[0] + (b.p[0] - a.p[0]) * u, a.p[1] + (b.p[1] - a.p[1]) * u, a.p[2] + (b.p[2] - a.p[2]) * u);
  obj.scale.set(a.s[0] + (b.s[0] - a.s[0]) * u, a.s[1] + (b.s[1] - a.s[1]) * u, a.s[2] + (b.s[2] - a.s[2]) * u);
  _qa.fromArray(a.q); _qb.fromArray(b.q);
  obj.quaternion.slerpQuaternions(_qa, _qb, u);
  if (a.f != null && b.f != null && obj.userData && obj.userData.cam) { obj.userData.cam.focal = a.f + (b.f - a.f) * u; if (a.os != null && b.os != null) obj.userData.cam.orthoScale = a.os + (b.os - a.os) * u; }
  return true;
}

/** Full 360° spin around world Y over [t0, t1] (linear, constant speed). */
export function turntableKeys(obj, t0, t1, turns = 1) {
  const base = obj.quaternion.clone();
  const keys = [];
  const steps = Math.max(3, Math.ceil(3 * Math.abs(turns)));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2 * turns;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a).multiply(base);
    keys.push({ t: t0 + (t1 - t0) * (i / steps), p: obj.position.toArray(), q: q.toArray(), s: obj.scale.toArray(), ease: 'linear' });
  }
  return keys;
}

// -------------------------------------------------------------- camera

const _v = new THREE.Vector3(), _sph = new THREE.Spherical();
export function cameraKey(cam, target, t, easeKind = 'ease') {
  _v.copy(cam.position).sub(target);
  _sph.setFromVector3(_v);
  return { t, target: target.toArray(), r: _sph.radius, theta: _sph.theta, phi: _sph.phi, fov: cam.isPerspectiveCamera ? cam.fov : null, zoom: cam.zoom, ease: easeKind };
}
export function setCameraKey(anim, cam, target, t, tol) {
  const keys = anim.camera;
  const prevAt = keys[keyIndexAt(keys, t, tol)];
  const k = cameraKey(cam, target, t, prevAt?.ease || 'ease');
  // unwrap the azimuth next to the neighbouring key so the camera takes the short way round
  const before = keys.filter((x) => x.t < t - tol).pop() || keys.find((x) => x.t > t + tol);
  if (before) { while (k.theta - before.theta > Math.PI) k.theta -= Math.PI * 2; while (k.theta - before.theta < -Math.PI) k.theta += Math.PI * 2; }
  upsert(keys, k, tol);
}
export function cameraTurntable(cam, target, t0, t1, turns = 1) {
  const k0 = cameraKey(cam, target, t0, 'linear');
  const keys = [];
  const steps = Math.max(3, Math.ceil(3 * Math.abs(turns)));
  for (let i = 0; i <= steps; i++) keys.push({ ...k0, t: t0 + (t1 - t0) * (i / steps), theta: k0.theta + (i / steps) * Math.PI * 2 * turns, target: [...k0.target] });
  return keys;
}
/** Returns { pos, target, fov, zoom } or null. */
export function sampleCamera(keys, t) {
  if (!keys || !keys.length) return null;
  let a = keys[0], b = keys[keys.length - 1], u = 0;
  if (t <= a.t) b = a;
  else if (t >= b.t) a = b;
  else {
    for (let i = 0; i < keys.length - 1; i++) if (t >= keys[i].t && t <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break; }
    u = ease(b.ease, (t - a.t) / Math.max(1e-9, b.t - a.t));
  }
  const L = (x, y) => x + (y - x) * u;
  const target = new THREE.Vector3(L(a.target[0], b.target[0]), L(a.target[1], b.target[1]), L(a.target[2], b.target[2]));
  _sph.set(L(a.r, b.r), L(a.phi, b.phi), L(a.theta, b.theta));
  const pos = new THREE.Vector3().setFromSpherical(_sph).add(target);
  const fov = a.fov != null && b.fov != null ? L(a.fov, b.fov) : null;
  return { pos, target, fov, zoom: L(a.zoom || 1, b.zoom || 1) };
}

// -------------------------------------------------------------- validation (project files are untrusted)

const arr = (v, n, d) => (Array.isArray(v) && v.length === n ? v.map((x, i) => num(x, d[i], -1e7, 1e7)) : d.slice());
export function validateAnim(a) {
  const out = newAnim();
  if (!a || typeof a !== 'object') return out;
  out.duration = num(a.duration, 5, 0.1, 600);
  out.loop = bool(a.loop, true);
  if (a.tracks && typeof a.tracks === 'object') {
    for (const [id, keys] of Object.entries(a.tracks).slice(0, 5000)) {
      if (!/^[a-z0-9]{1,40}$/i.test(id) || !Array.isArray(keys)) continue;
      out.tracks[id] = keys.slice(0, 10000).map((k) => {
        const o = { t: num(k?.t, 0, 0, 600), p: arr(k?.p, 3, [0, 0, 0]), q: arr(k?.q, 4, [0, 0, 0, 1]), s: arr(k?.s, 3, [1, 1, 1]), ease: oneOf(k?.ease, EASE_IDS, 'ease') };
        if (k?.f != null) { o.f = num(k.f, 50, 1, 5000); o.os = num(k.os, 6, 0.001, 1e6); }
        return o;
      }).sort((x, y) => x.t - y.t);
    }
  }
  if (Array.isArray(a.camera)) {
    out.camera = a.camera.slice(0, 10000).map((k) => ({
      t: num(k?.t, 0, 0, 600), target: arr(k?.target, 3, [0, 0, 0]), r: num(k?.r, 5, 0.001, 1e6), theta: num(k?.theta, 0, -1e4, 1e4), phi: num(k?.phi, 1, 0, Math.PI),
      fov: k?.fov == null ? null : num(k.fov, 40, 1, 170), zoom: num(k?.zoom, 1, 0.001, 1000), ease: oneOf(k?.ease, EASE_IDS, 'ease'),
    })).sort((x, y) => x.t - y.t);
  }
  return out;
}

/** Keys that carry an object once around a pivot on a horizontal circle, always looking at the pivot. */
export function orbitKeys(obj, pivot, t0, t1, turns = 1, steps = 36) {
  const parent = obj.parent;
  parent.updateWorldMatrix(true, false);
  const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const wp = obj.getWorldPosition(new THREE.Vector3());
  const off = wp.clone().sub(pivot);
  const r = Math.max(0.01, Math.hypot(off.x, off.z)), a0 = Math.atan2(off.x, off.z);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const keys = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (i / steps) * Math.PI * 2 * turns;
    p.set(pivot.x + Math.sin(a) * r, wp.y, pivot.z + Math.cos(a) * r);
    m.lookAt(p, pivot, up); q.setFromRotationMatrix(m);
    m.compose(p, q, new THREE.Vector3(1, 1, 1)).premultiply(inv);
    const lp = new THREE.Vector3(), lq = new THREE.Quaternion();
    m.decompose(lp, lq, sc);
    const k = { t: t0 + (t1 - t0) * (i / steps), p: lp.toArray(), q: lq.toArray(), s: obj.scale.toArray(), ease: 'linear' };
    if (obj.userData && obj.userData.cam) { k.f = Number(obj.userData.cam.focal) || 50; k.os = Number(obj.userData.cam.orthoScale) || 6; }
    keys.push(k);
  }
  return keys;
}
