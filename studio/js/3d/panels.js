// EYAD 3D — right-hand panels (bottom sheets on phones): outliner, object
// transform, material, light, scene (environment / ground / shadows),
// camera (projection, lens, bookmarks) and animation.
import * as THREE from '../../vendor/three/three.module.js';
import { h, clear, clamp } from '../core/dom.js';
import { openSheet, contextMenu } from '../core/ui.js';
import { icon } from './icons.js';
import { PRIMITIVES, LIGHTS, materialsOf, iconFor, kindLabel, isLight } from './objects.js';
import { EASES } from './anim.js';

const R2D = 180 / Math.PI, D2R = Math.PI / 180;
const TITLES = { outliner: 'Scene objects', object: 'Object', material: 'Material', light: 'Light', scene: 'Environment', camera: 'Camera', anim: 'Animation' };

function section(title, key, body, { actions = [] } = {}) {
  const btn = h('button', { class: 'img-panel-toggle', type: 'button', 'aria-expanded': 'true' }, icon('chevronDown', 14), h('span', { text: title }));
  const el = h('section', { class: 'img-panel t3-panel is-' + key, dataset: { panel: key } }, h('div', { class: 'img-panel-head' }, btn, h('div', { class: 'img-panel-actions' }, actions)), h('div', { class: 'img-panel-body' }, body));
  btn.addEventListener('click', () => { const c = el.classList.toggle('is-collapsed'); btn.setAttribute('aria-expanded', String(!c)); });
  return el;
}

/** Number field with a drag-to-scrub label. cb: { begin(), input(v), end() } */
function numField(label, value, cb, { step = 0.1, min = -1e6, max = 1e6, digits = 3, cls = '', title = '' } = {}) {
  const fmt = (v) => String(Math.round(v * Math.pow(10, digits)) / Math.pow(10, digits));
  const input = h('input', { class: 'studio-input is-num', type: 'number', step: String(step), value: fmt(value), 'aria-label': title || label, inputMode: 'decimal' });
  input.addEventListener('change', () => {
    const v = clamp(Number(input.value), min, max);
    if (!Number.isFinite(v)) { input.value = fmt(value); return; }
    cb.begin?.(); cb.input(v); cb.end?.();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); e.stopPropagation(); });
  const lab = h('span', { class: 't3-num-label', text: label, title: 'Drag to adjust' });
  lab.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    lab.setPointerCapture(e.pointerId);
    const x0 = e.clientX, v0 = Number(input.value) || 0;
    let moved = false;
    cb.begin?.();
    const move = (ev) => {
      const dx = ev.clientX - x0; if (Math.abs(dx) > 2) moved = true;
      const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const v = clamp(v0 + dx * step * k * 0.5, min, max);
      input.value = fmt(v); cb.input(v);
    };
    const up = () => { lab.removeEventListener('pointermove', move); lab.removeEventListener('pointerup', up); lab.removeEventListener('pointercancel', up); if (moved) cb.end?.(); else { cb.end?.(); input.focus(); input.select(); } };
    lab.addEventListener('pointermove', move); lab.addEventListener('pointerup', up); lab.addEventListener('pointercancel', up);
  });
  const el = h('label', { class: 't3-num ' + cls }, lab, input);
  el.set = (v) => { if (document.activeElement !== input) input.value = fmt(v); };
  return el;
}
function row(label, ...controls) { return h('div', { class: 't3-row' }, h('span', { class: 't3-row-label', text: label }), h('div', { class: 't3-row-ctl' }, controls)); }
function range(value, min, max, step, onInput, fmt = (v) => v.toFixed(2)) {
  const out = h('output', { class: 'studio-mono t3-out', text: fmt(value) });
  const r = h('input', { class: 'studio-range', type: 'range', min, max, step, value });
  r.addEventListener('input', () => { out.textContent = fmt(Number(r.value)); onInput(Number(r.value)); });
  return h('div', { class: 't3-range' }, r, out);
}
function colorInput(value, onInput) {
  const c = h('input', { class: 'studio-color', type: 'color', value });
  c.addEventListener('input', () => onInput(c.value));
  return c;
}
function check(label, value, onChange) {
  const i = h('input', { type: 'checkbox', checked: !!value });
  i.addEventListener('change', () => onChange(i.checked));
  return h('label', { class: 't3-check' }, i, h('span', { text: label }));
}
function select(value, items, onChange) {
  const s = h('select', { class: 'studio-input' }, items.map(([v, l]) => h('option', { value: String(v), text: l, selected: String(v) === String(value) })));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
function seg(value, items, onChange) {
  return h('div', { class: 'img-seg t3-seg', role: 'group' }, items.map(([v, l, ic]) => {
    const b = h('button', { class: 'studio-btn is-small' + (String(v) === String(value) ? ' is-primary' : ' is-ghost'), type: 'button', 'aria-pressed': String(String(v) === String(value)), onclick: () => onChange(v) }, ic ? icon(ic, 14) : null, l ? h('span', { text: l }) : null);
    return b;
  }));
}
const hex = (c) => '#' + c.getHexString();

export class Panels {
  constructor(app, host) { this.app = app; this.host = host; this.matIndex = 0; }

  focus(key) {
    if (this.app.mobile.matches) { this.sheet(key); return; }
    const el = this.host.querySelector(`[data-panel="${key}"]`);
    if (el) { el.classList.remove('is-collapsed'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); el.classList.add('is-flash'); setTimeout(() => el.classList.remove('is-flash'), 700); }
  }
  sheet(key) {
    if (key === 'material' && isLight(this.app.selected)) key = 'light';
    this.sheetKey = key;
    this.activeSheet = openSheet({ title: TITLES[key] || key, content: h('div', { class: 't3-sheet' }, this.make(key)), onClose: () => { this.sheetKey = null; } });
  }
  keys() {
    const s = this.app.selected;
    const k = ['outliner'];
    if (s) k.push('object');
    if (s && !isLight(s) && materialsOf(s).length) k.push('material');
    if (isLight(s)) k.push('light');
    k.push('scene', 'camera', 'anim');
    return k;
  }
  refresh() {
    if (this.app.mobile.matches) {
      clear(this.host);
      if (this.activeSheet && !this.activeSheet.closed && this.sheetKey) {
        const body = this.activeSheet.panel.querySelector('.t3-sheet');
        const sb = this.activeSheet.panel.querySelector('.studio-sheet-body');
        const st = sb ? sb.scrollTop : 0;
        if (body) body.replaceChildren(this.make(this.sheetKey));
        if (sb) sb.scrollTop = st;
      }
      return;
    }
    if (this.host.contains(document.activeElement) && document.activeElement.matches('input[type="number"], input[type="text"]')) { this.pending = true; return; }
    const scroll = this.host.scrollTop;
    const collapsed = new Set(Array.from(this.host.querySelectorAll('.img-panel.is-collapsed')).map((e) => e.dataset.panel));
    if (!this.everBuilt) { collapsed.add('camera'); collapsed.add('anim'); this.everBuilt = true; }
    clear(this.host);
    for (const k of this.keys()) {
      const el = this.make(k);
      if (collapsed.has(k)) el.classList.add('is-collapsed');
      this.host.appendChild(el);
    }
    this.host.scrollTop = scroll;
  }
  /** Fast path while dragging the gizmo / playing: only the transform numbers change. */
  syncTransform() {
    const o = this.app.selected; if (!o) return;
    const roots = [this.host, this.activeSheet && !this.activeSheet.closed ? this.activeSheet.panel : null].filter(Boolean);
    for (const r of roots) {
      const f = r.querySelectorAll('.t3-xyz [data-k]');
      for (const el of f) {
        const [k, i] = el.dataset.k.split(':');
        const v = k === 'r' ? o.rotation.toArray()[i] * R2D : k === 'p' ? o.position.toArray()[i] : o.scale.toArray()[i];
        el.set?.(v);
      }
    }
  }
  make(k) {
    const body = this['p_' + k] ? this['p_' + k]() : h('div');
    const actions = k === 'outliner' ? [this.addButton()] : [];
    return section(TITLES[k], k, body, { actions });
  }

  addButton() {
    const b = h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Add object', title: 'Add object' }, icon('plus', 15));
    b.addEventListener('click', () => { const r = b.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, this.app.addMenuItems()); });
    return b;
  }

  // ------------------------------------------------------------ outliner
  p_outliner() {
    const app = this.app;
    const list = h('div', { class: 't3-outliner', role: 'listbox', 'aria-label': 'Scene objects' });
    const all = app.allObjects();
    if (!all.length) list.appendChild(h('div', { class: 'img-panel-empty', text: 'Nothing here yet — add a shape or import a model.' }));
    for (const o of all) {
      const on = app.selected === o;
      const eye = h('button', { class: 'img-layer-eye', type: 'button', 'aria-pressed': String(o.visible), 'aria-label': o.visible ? 'Hide' : 'Show', title: o.visible ? 'Hide' : 'Show', onclick: (e) => { e.stopPropagation(); app.setVisible(o, !o.visible); } }, icon(o.visible ? 'eye' : 'eyeOff', 15));
      const name = h('span', { class: 't3-out-name', text: o.name || kindLabel(o) });
      const r = h('div', { class: 't3-out-row' + (on ? ' is-on' : '') + (o.visible ? '' : ' is-hidden'), role: 'option', 'aria-selected': String(on), tabindex: '0', dataset: { id: o.userData.eyadId } },
        eye, h('span', { class: 't3-out-icon' }, icon(iconFor(o), 15)), name,
        app.anim.tracks[o.userData.eyadId]?.length ? h('span', { class: 't3-out-badge', title: 'Has keyframes' }, icon('key', 11)) : null,
        h('button', { class: 'studio-icon-btn is-small t3-out-more', type: 'button', 'aria-label': 'More actions', onclick: (e) => { e.stopPropagation(); const rr = e.currentTarget.getBoundingClientRect(); contextMenu(rr.left, rr.bottom, app.objectMenuItems(o)); } }, icon('dots', 14)));
      r.addEventListener('click', () => app.select(o));
      r.addEventListener('dblclick', () => this.renameInline(o, name));
      r.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); this.renameInline(o, name); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const i = all.indexOf(o) + (e.key === 'ArrowDown' ? 1 : -1); if (all[i]) { app.select(all[i]); requestAnimationFrame(() => this.host.querySelector(`[data-id="${all[i].userData.eyadId}"]`)?.focus()); } }
      });
      r.addEventListener('contextmenu', (e) => { e.preventDefault(); app.select(o); contextMenu(e.clientX, e.clientY, app.objectMenuItems(o)); });
      list.appendChild(r);
    }
    const foot = h('div', { class: 't3-out-foot' },
      h('span', { class: 'studio-dim studio-small', text: `${app.viewport.content.children.length} object${app.viewport.content.children.length === 1 ? '' : 's'} · ${app.viewport.lights.children.length} light${app.viewport.lights.children.length === 1 ? '' : 's'}` }),
      h('span', { class: 'studio-spacer' }),
      this.iconBtn('duplicate', 'Duplicate', () => app.duplicateSelected(), !app.selected),
      this.iconBtn('trash', 'Delete', () => app.deleteSelected(), !app.selected));
    return h('div', { class: 't3-outliner-wrap' }, list, foot);
  }
  iconBtn(ic, label, fn, disabled = false) { return h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': label, title: label, disabled, onclick: fn }, icon(ic, 15)); }
  renameInline(o, nameEl) {
    const input = h('input', { class: 'studio-input t3-out-rename', type: 'text', value: o.name, maxLength: 120 });
    nameEl.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; if (ok && input.value.trim() && input.value.trim() !== o.name) this.app.rename(o, input.value.trim()); else this.refresh(); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  // ------------------------------------------------------------ object / transform
  p_object() {
    const app = this.app, o = app.selected;
    if (!o) return h('div', { class: 'img-panel-empty', text: 'Select an object.' });
    const nameIn = h('input', { class: 'studio-input', type: 'text', value: o.name, maxLength: 120, 'aria-label': 'Name' });
    nameIn.addEventListener('change', () => { const v = nameIn.value.trim(); if (v && v !== o.name) app.rename(o, v); });
    nameIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') nameIn.blur(); });
    const tcb = (k, i) => ({
      begin: () => app.beginTransform(o),
      input: (v) => { if (k === 'p') o.position.setComponent(i, v); else if (k === 'r') { const r = o.rotation.toArray(); r[i] = v * D2R; o.rotation.set(r[0], r[1], r[2]); } else { if (app.uniformScale) { const f = v / (o.scale.getComponent(i) || 1); if (Number.isFinite(f) && f !== 0) o.scale.multiplyScalar(f); o.scale.setComponent(i, v); } else o.scale.setComponent(i, v); } app.viewport.invalidate(); this.syncTransform(); },
      end: () => app.commitTransform(o, { p: 'Move', r: 'Rotate', s: 'Scale' }[k]),
    });
    const xyz = (k, vals, step, digits) => h('div', { class: 't3-xyz' }, ['X', 'Y', 'Z'].map((ax, i) => { const f = numField(ax, vals[i], tcb(k, i), { step, digits, cls: 'is-' + ax.toLowerCase(), title: { p: 'Position ', r: 'Rotation ', s: 'Scale ' }[k] + ax }); f.dataset.k = k + ':' + i; return f; }));
    const els = [
      h('div', { class: 't3-name-row' }, h('span', { class: 't3-kind' }, icon(iconFor(o), 15), h('span', { text: kindLabel(o) })), nameIn),
      h('div', { class: 't3-sub', text: 'Position' }), xyz('p', o.position.toArray(), 0.05, 3),
    ];
    const showRot = !(o.isLight && (o.isPointLight || o.isAmbientLight || o.isHemisphereLight));
    if (showRot) els.push(h('div', { class: 't3-sub', text: 'Rotation °' }), xyz('r', o.rotation.toArray().slice(0, 3).map((x) => x * R2D), 1, 1));
    if (!o.isLight) {
      els.push(h('div', { class: 't3-sub' }, h('span', { text: 'Scale' }), check('Uniform', app.uniformScale, (v) => { app.uniformScale = v; })), xyz('s', o.scale.toArray(), 0.05, 3));
      const meshes = []; o.traverse((n) => { if (n.isMesh) meshes.push(n); });
      const cast = meshes.some((m) => m.castShadow), recv = meshes.some((m) => m.receiveShadow);
      els.push(h('div', { class: 't3-checks' },
        check('Casts shadow', cast, (v) => app.setMeshFlag(o, 'castShadow', v)),
        check('Receives shadow', recv, (v) => app.setMeshFlag(o, 'receiveShadow', v))));
      els.push(h('div', { class: 't3-actions' },
        h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.dropToGround(o) }, icon('chevronDown', 14), h('span', { text: 'Drop to ground' })),
        h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.resetTransform(o) }, icon('undo', 14), h('span', { text: 'Reset' })),
        h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.viewport.frame(o) }, icon('frame', 14), h('span', { text: 'Frame' }))));
      const clips = app.clips.filter((c) => c.root === o);
      if (clips.length) els.push(h('div', { class: 't3-sub', text: 'Animation clips (glTF)' }), h('div', { class: 't3-checks is-col' }, clips.map((c) => check(`${c.clip.name || 'Clip'} · ${c.clip.duration.toFixed(2)} s`, c.enabled, (v) => app.setClipEnabled(c, v)))));
    } else {
      els.push(h('div', { class: 't3-actions' }, h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.aimLightAtSelection(o) }, icon('frame', 14), h('span', { text: 'Aim at scene centre' }))));
    }
    return h('div', { class: 't3-stack' }, els);
  }

  // ------------------------------------------------------------ material
  p_material() {
    const app = this.app, o = app.selected;
    const mats = materialsOf(o);
    if (!mats.length) return h('div', { class: 'img-panel-empty', text: 'This object has no material.' });
    if (this.matOwner !== o) { this.matOwner = o; this.matIndex = 0; }
    const m = mats[Math.min(this.matIndex, mats.length - 1)];
    const els = [];
    if (mats.length > 1) els.push(row('Material', select(this.matIndex, mats.map((mm, i) => [i, (mm.name || 'Material') + ' ' + (i + 1)]), (v) => { this.matIndex = Number(v); this.refresh(); })));
    const set = (label, key, value, co) => app.setMaterialProp(m, label, key, value, co);
    if (m.color) els.push(row('Colour', colorInput(hex(m.color), (v) => set('Material colour', 'color', v, 'mc')), h('span', { class: 'studio-mono t3-hex', text: hex(m.color) })));
    if (m.isMeshStandardMaterial) {
      els.push(row('Metalness', range(m.metalness, 0, 1, 0.01, (v) => set('Metalness', 'metalness', v, 'mm'))));
      els.push(row('Roughness', range(m.roughness, 0, 1, 0.01, (v) => set('Roughness', 'roughness', v, 'mr'))));
    }
    if (m.emissive) {
      els.push(row('Emission', colorInput(hex(m.emissive), (v) => set('Emission colour', 'emissive', v, 'me')), h('span', { class: 't3-grow' }, range(m.emissiveIntensity ?? 1, 0, 20, 0.05, (v) => set('Emission strength', 'emissiveIntensity', v, 'mei'), (v) => v.toFixed(1)))));
    }
    els.push(row('Opacity', range(m.opacity, 0, 1, 0.01, (v) => set('Opacity', 'opacity', v, 'mo'))));
    els.push(h('div', { class: 't3-checks' },
      check('Wireframe', m.wireframe, (v) => set('Wireframe', 'wireframe', v)),
      check('Double-sided', m.side === THREE.DoubleSide, (v) => set('Double-sided', 'side', v ? THREE.DoubleSide : THREE.FrontSide)),
      'flatShading' in m ? check('Flat shading', m.flatShading, (v) => set('Flat shading', 'flatShading', v)) : null));
    // texture
    const tex = m.map;
    let thumb = h('div', { class: 't3-tex-thumb is-empty' }, icon('texture', 18));
    if (tex && tex.image && (tex.image.width || tex.image.videoWidth)) {
      try {
        const c = document.createElement('canvas'); c.width = 48; c.height = 48;
        c.getContext('2d').drawImage(tex.image, 0, 0, 48, 48);
        thumb = h('div', { class: 't3-tex-thumb' }, c);
      } catch (e) { /* image not drawable (e.g. still decoding) */ }
    }
    els.push(h('div', { class: 't3-sub', text: 'Colour texture' }), h('div', { class: 't3-tex' }, thumb,
      h('div', { class: 't3-tex-meta' },
        h('span', { class: 'studio-small', text: tex ? (tex.name || 'Image texture') + (tex.image?.width ? ` · ${tex.image.width}×${tex.image.height}` : '') : 'None' }),
        h('div', { class: 't3-actions' },
          h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.pickTexture() }, icon('upload', 14), h('span', { text: tex ? 'Replace…' : 'Load image…' })),
          tex ? h('button', { class: 'studio-btn is-small is-ghost', type: 'button', onclick: () => app.setMaterialMap(null) }, h('span', { text: 'Remove' })) : null))));
    if (!m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial) els.push(h('p', { class: 'studio-dim studio-small', text: 'This material type has no metal / roughness controls.' }));
    return h('div', { class: 't3-stack' }, els);
  }

  // ------------------------------------------------------------ light
  p_light() {
    const app = this.app, l = app.selected;
    if (!isLight(l)) return h('div');
    const set = (label, key, value, co) => app.setLightProp(l, label, key, value, co);
    const els = [
      row('Colour', colorInput(hex(l.color), (v) => set('Light colour', 'color', v, 'lc')), h('span', { class: 'studio-mono t3-hex', text: hex(l.color) })),
      row('Intensity', range(l.intensity, 0, l.isPointLight || l.isSpotLight ? 400 : 20, l.isPointLight || l.isSpotLight ? 0.5 : 0.05, (v) => set('Intensity', 'intensity', v, 'li'), (v) => v.toFixed(v >= 100 ? 0 : 2))),
    ];
    if (l.isHemisphereLight) els.push(row('Ground', colorInput(hex(l.groundColor), (v) => set('Ground colour', 'groundColor', v, 'lg'))));
    if (l.isSpotLight) {
      els.push(row('Cone', range(l.angle * R2D, 1, 89, 0.5, (v) => set('Cone angle', 'angle', v * D2R, 'la'), (v) => v.toFixed(0) + '°')));
      els.push(row('Softness', range(l.penumbra, 0, 1, 0.01, (v) => set('Penumbra', 'penumbra', v, 'lp'))));
    }
    if (l.isPointLight || l.isSpotLight) els.push(row('Range', range(l.distance, 0, 100, 0.5, (v) => set('Range', 'distance', v, 'ld'), (v) => (v === 0 ? '∞' : v.toFixed(1)))));
    if (l.shadow) {
      els.push(h('div', { class: 't3-checks' }, check('Casts shadows', l.castShadow, (v) => set('Light shadows', 'castShadow', v))));
      if (!app.settings.shadows) els.push(h('p', { class: 'studio-dim studio-small', text: 'Shadows are turned off for the scene (Environment panel).' }));
    }
    if (l.isAmbientLight || l.isHemisphereLight) els.push(h('p', { class: 'studio-dim studio-small', text: 'Fills the whole scene evenly; position does not matter.' }));
    return h('div', { class: 't3-stack' }, els);
  }

  // ------------------------------------------------------------ scene / environment
  p_scene() {
    const app = this.app, s = app.settings;
    const set = (label, fn, co) => app.changeSettings(label, fn, co);
    const env = s.env, g = s.ground;
    const els = [
      h('div', { class: 't3-sub', text: 'Lighting' }),
      row('Environment', select(env.lighting, [['studio', 'Studio room (image-based)'], ['none', 'None — lights only']], (v) => set('Environment', () => { env.lighting = v; }))),
      env.lighting === 'studio' ? row('Strength', range(env.intensity, 0, 3, 0.01, (v) => set('Environment strength', () => { env.intensity = v; }, 'ei'))) : null,
      h('div', { class: 't3-sub', text: 'Background' }),
      h('div', { class: 't3-bgseg' }, seg(env.background, [['gradient', 'Gradient'], ['solid', 'Solid'], ['environment', 'Studio'], ['transparent', 'None']], (v) => set('Background', () => { env.background = v; }))),
    ];
    if (env.background === 'gradient') els.push(row('Top / bottom', colorInput(env.top, (v) => set('Background', () => { env.top = v; }, 'bt')), colorInput(env.bottom, (v) => set('Background', () => { env.bottom = v; }, 'bb'))));
    if (env.background === 'solid') els.push(row('Colour', colorInput(env.color, (v) => set('Background', () => { env.color = v; }, 'bc'))));
    if (env.background === 'environment') els.push(row('Blur', range(env.blur, 0, 1, 0.01, (v) => set('Background blur', () => { env.blur = v; }, 'bl'))));
    if (env.background === 'transparent') els.push(h('p', { class: 'studio-dim studio-small', text: 'Transparent in PNG renders when "Transparent background" is on; video renders use black.' }));
    els.push(
      h('div', { class: 't3-sub', text: 'Camera response' }),
      row('Tone mapping', select(env.toneMapping, [['aces', 'Filmic (ACES)'], ['agx', 'AgX'], ['neutral', 'Neutral'], ['none', 'None (linear)']], (v) => set('Tone mapping', () => { env.toneMapping = v; }))),
      row('Exposure', range(env.exposure, 0.1, 4, 0.01, (v) => set('Exposure', () => { env.exposure = v; }, 'ex'))),
      h('div', { class: 't3-sub', text: 'Ground' }),
      h('div', { class: 't3-bgseg' }, seg(g.mode, [['shadow', 'Shadow catcher'], ['solid', 'Floor'], ['none', 'None']], (v) => set('Ground', () => { g.mode = v; }))),
      g.mode === 'shadow' ? row('Shadow', range(g.opacity, 0, 1, 0.01, (v) => set('Shadow opacity', () => { g.opacity = v; }, 'go'))) : null,
      g.mode === 'solid' ? row('Floor colour', colorInput(g.color, (v) => set('Floor colour', () => { g.color = v; }, 'gc'))) : null,
      h('div', { class: 't3-checks' },
        check('Shadows', s.shadows, (v) => set('Shadows', () => { s.shadows = v; })),
        check('Grid (editor only)', g.grid, (v) => set('Grid', () => { g.grid = v; }))),
    );
    return h('div', { class: 't3-stack' }, els);
  }

  // ------------------------------------------------------------ camera
  p_camera() {
    const app = this.app, v = app.viewport;
    const persp = !v.camera.isOrthographicCamera;
    const fovToMm = (f) => v.persp.getFilmHeight() / 2 / Math.tan(f * D2R / 2);
    const els = [
      h('div', { class: 't3-bgseg' }, seg(persp ? 'persp' : 'ortho', [['persp', 'Perspective', 'persp'], ['ortho', 'Orthographic', 'ortho']], (t) => app.setProjection(t))),
    ];
    if (persp) {
      els.push(row('Field of view', range(v.persp.fov, 5, 120, 0.5, (f) => { app.setFov(f); document.querySelectorAll('.t3-focal input').forEach((x) => { if (document.activeElement !== x) x.value = Math.round(fovToMm(f)); }); }, (f) => f.toFixed(0) + '°')));
      const focal = numField('mm', Math.round(fovToMm(v.persp.fov)), { input: (mm) => { v.persp.setFocalLength(clamp(mm, 4, 800)); app.setFov(v.persp.fov); }, end: () => this.refresh() }, { step: 1, min: 4, max: 800, digits: 0, cls: 't3-focal', title: 'Focal length (35 mm film)' });
      els.push(row('Focal length', focal, h('span', { class: 'studio-dim studio-small', text: '35 mm equivalent' })));
    }
    els.push(h('div', { class: 't3-sub', text: 'Views' }), h('div', { class: 't3-views' },
      [['front', 'Front'], ['right', 'Right'], ['top', 'Top'], ['back', 'Back'], ['left', 'Left'], ['bottom', 'Bottom']].map(([k, l]) => h('button', { class: 'studio-btn is-small', type: 'button', text: l, onclick: () => v.setView(k) }))));
    els.push(h('div', { class: 't3-sub' }, h('span', { text: 'Bookmarks' }), h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.addBookmark() }, icon('plus', 13), h('span', { text: 'Save view' }))));
    if (!app.bookmarks.length) els.push(h('p', { class: 'studio-dim studio-small', text: 'Save camera positions to come back to them, or to key camera moves.' }));
    for (const b of app.bookmarks) {
      els.push(h('div', { class: 't3-bm' },
        h('button', { class: 't3-bm-go', type: 'button', title: 'Go to view', onclick: () => app.goBookmark(b) }, icon('bookmark', 14), h('span', { text: b.name }), h('em', { text: b.type === 'ortho' ? 'Ortho' : Math.round(b.fov) + '°' })),
        h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Update to current view', title: 'Update to current view', onclick: () => app.updateBookmark(b) }, icon('rotate', 13)),
        h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Delete bookmark', title: 'Delete', onclick: () => app.deleteBookmark(b) }, icon('trash', 13))));
    }
    return h('div', { class: 't3-stack' }, els);
  }

  // ------------------------------------------------------------ animation
  p_anim() {
    const app = this.app, a = app.anim, o = app.selected;
    const els = [
      row('Duration', numField('s', a.duration, { begin: () => app.animBegin(), input: (v) => { a.duration = clamp(v, 0.1, 600); app.timeline?.update(); }, end: () => app.animEnd('Duration') }, { step: 0.1, min: 0.1, max: 600, digits: 2, title: 'Duration in seconds' })),
      h('div', { class: 't3-checks' },
        check('Loop playback', a.loop, (v) => app.animChange('Loop', () => { a.loop = v; })),
        check('Auto-key', app.autoKey, (v) => app.setAutoKey(v))),
      h('div', { class: 't3-sub', text: 'Quick moves' }),
      h('div', { class: 't3-actions' },
        h('button', { class: 'studio-btn is-small', type: 'button', disabled: !o, onclick: () => app.turntable('object') }, icon('turntable', 14), h('span', { text: 'Spin selection' })),
        h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => app.turntable('camera') }, icon('orbit', 14), h('span', { text: 'Orbit camera' }))),
    ];
    const keyList = (title, keys, onEase, onDel, onGo) => {
      els.push(h('div', { class: 't3-sub', text: title }));
      if (!keys.length) { els.push(h('p', { class: 'studio-dim studio-small', text: 'No keys.' })); return; }
      els.push(h('div', { class: 't3-keys' }, keys.map((k, i) => h('div', { class: 't3-key' },
        h('button', { class: 't3-key-t', type: 'button', title: 'Go to key', onclick: () => onGo(k) }, icon('key', 11), h('span', { class: 'studio-mono', text: k.t.toFixed(2) + ' s' })),
        select(k.ease, EASES, (v) => onEase(i, v)),
        h('button', { class: 'studio-icon-btn is-small', type: 'button', 'aria-label': 'Delete key', title: 'Delete key', onclick: () => onDel(i) }, icon('close', 13))))));
    };
    if (o) {
      const id = o.userData.eyadId;
      const keys = a.tracks[id] || [];
      keyList(`Keys · ${o.name}`, keys, (i, v) => app.animChange('Key easing', () => { a.tracks[id][i].ease = v; }), (i) => app.animChange('Delete key', () => { a.tracks[id].splice(i, 1); if (!a.tracks[id].length) delete a.tracks[id]; }), (k) => app.setTime(k.t));
    }
    keyList('Camera keys', a.camera, (i, v) => app.animChange('Key easing', () => { a.camera[i].ease = v; }), (i) => app.animChange('Delete camera key', () => { a.camera.splice(i, 1); }), (k) => app.setTime(k.t));
    els.push(h('div', { class: 't3-actions' },
      h('button', { class: 'studio-btn is-small is-ghost', type: 'button', disabled: !o || !a.tracks[o?.userData.eyadId], onclick: () => app.clearKeys('object') }, h('span', { text: 'Clear object keys' })),
      h('button', { class: 'studio-btn is-small is-ghost', type: 'button', disabled: !a.camera.length, onclick: () => app.clearKeys('camera') }, h('span', { text: 'Clear camera keys' }))));
    if (app.clips.length) els.push(h('p', { class: 'studio-dim studio-small', text: `${app.clips.length} glTF clip${app.clips.length > 1 ? 's' : ''} play on the same timeline (select the model to toggle them).` }));
    return h('div', { class: 't3-stack' }, els);
  }
}
void PRIMITIVES; void LIGHTS;
