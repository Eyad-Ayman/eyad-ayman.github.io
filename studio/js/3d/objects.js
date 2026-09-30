// EYAD 3D — scene objects: primitives, lights, materials, identity helpers.
import * as THREE from '../../vendor/three/three.module.js';
import { clone as skeletonClone } from '../../vendor/three/addons/utils/SkeletonUtils.js';
import { uid } from '../core/dom.js';

export const PRIMITIVES = [
  { id: 'cube', label: 'Cube', icon: 'cube' },
  { id: 'sphere', label: 'Sphere', icon: 'sphere' },
  { id: 'cylinder', label: 'Cylinder', icon: 'cylinder' },
  { id: 'cone', label: 'Cone', icon: 'cone' },
  { id: 'torus', label: 'Torus', icon: 'torus' },
  { id: 'plane', label: 'Plane', icon: 'plane' },
  { id: 'capsule', label: 'Capsule', icon: 'capsule' },
  { id: 'knot', label: 'Torus Knot', icon: 'knot' },
];

export const LIGHTS = [
  { id: 'directional', label: 'Directional light', icon: 'sun' },
  { id: 'point', label: 'Point light', icon: 'bulb' },
  { id: 'spot', label: 'Spot light', icon: 'spot' },
  { id: 'hemisphere', label: 'Hemisphere light', icon: 'hemi' },
  { id: 'ambient', label: 'Ambient light', icon: 'ambient' },
];

const PALETTE = ['#d02b2a', '#e8e4dc', '#2f6fe0', '#f2b134', '#23874a', '#8a5cf6', '#1f1f1f', '#ff7a45'];
let paletteIndex = 0;

export function primitiveGeometry(kind) {
  switch (kind) {
    case 'sphere': return new THREE.SphereGeometry(0.5, 64, 32);
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 64, 1);
    case 'cone': return new THREE.ConeGeometry(0.5, 1, 64, 1);
    case 'torus': return new THREE.TorusGeometry(0.4, 0.15, 32, 96);
    case 'plane': return new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    case 'capsule': return new THREE.CapsuleGeometry(0.3, 0.5, 12, 32);
    case 'knot': return new THREE.TorusKnotGeometry(0.35, 0.12, 200, 24);
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
}

export function newStandardMaterial(color) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color || PALETTE[paletteIndex++ % PALETTE.length]), metalness: 0, roughness: 0.45 });
}

export function createPrimitive(kind) {
  const def = PRIMITIVES.find((p) => p.id === kind) || PRIMITIVES[0];
  const mesh = new THREE.Mesh(primitiveGeometry(def.id), newStandardMaterial());
  mesh.name = def.label;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { eyadId: uid('o'), eyadKind: 'primitive', eyadPrim: def.id };
  // rest on the ground
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  mesh.position.y = def.id === 'plane' ? 0.001 : -bb.min.y;
  return mesh;
}

export function createLight(kind, opts = {}) {
  let l;
  switch (kind) {
    case 'point': l = new THREE.PointLight(0xffffff, 20, 0, 2); l.position.set(2, 3, 2); break;
    case 'spot': l = new THREE.SpotLight(0xffffff, 60, 0, Math.PI / 7, 0.35, 2); l.position.set(3, 5, 3); break;
    case 'hemisphere': l = new THREE.HemisphereLight(0xdfe8ff, 0x3a2f24, 1); l.position.set(0, 4, 0); break;
    case 'ambient': l = new THREE.AmbientLight(0xffffff, 0.4); l.position.set(-1.5, 4, 0); break;
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
export const idOf = (o) => o?.userData?.eyadId || null;
export function kindLabel(o) {
  if (!o) return '';
  if (o.isLight) return LIGHTS.find((x) => x.id === o.userData.eyadLight)?.label || 'Light';
  if (o.userData.eyadKind === 'primitive') return PRIMITIVES.find((p) => p.id === o.userData.eyadPrim)?.label || 'Shape';
  return 'Model' + (o.userData.eyadSrc ? ' · ' + String(o.userData.eyadSrc).toUpperCase() : '');
}
export function iconFor(o) {
  if (!o) return 'cube';
  if (o.isLight) return LIGHTS.find((x) => x.id === o.userData.eyadLight)?.icon || 'bulb';
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
  c.userData.eyadId = uid(o.isLight ? 'l' : 'o');
  if (c.isLight && c.target) {
    // clone() does not carry the child target reference
    const t = c.children.find((k) => k !== c.target && k.isObject3D && !k.isLight && k.type === 'Object3D');
    if (t) c.target = t; else { c.add(c.target); c.target.position.set(0, 0, -1); }
  }
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
