// EYAD IMAGE — Film Lab (136 film / camera looks with full controls), Color
// Lookup (.cube LUTs + built-in grades) and procedural Render textures.
// All processing runs on this device (WebGL with a CPU fallback).
import { h, clear } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { dialog, toast, progressDialog } from '../core/ui.js';
import { pickFiles } from '../core/files.js';
import { LOOKS, LOOK_PARAMS, LOOK_GROUPS, FRAMES, getLook, defaultParams, applyLook, lookThumbnail, todayStamp, registerLook } from '../core/film.js';
import { BUILTIN_LUTS, getBuiltinLut, readCubeFile, applyLut, lutToLook } from '../core/lut.js';
import { makeCanvas, createDoc } from './doc.js';
import { pixelCmd } from './history.js';
import { addGeneratedLayer } from './generate.js';

const PREVIEW_MAX = 900;
const imported = []; // { key, lut } — .cube files imported this session
let lastLook = 'portrait-400', lastParams = null;

function need(app) { if (!app.doc) { toast('Open or create an image first.'); return false; } return true; }

function downscale(src, max = PREVIEW_MAX) {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const c = makeCanvas(Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)));
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Replace a layer's pixels with `out` as one undo step (same size only). */
function commitCanvas(app, node, out, label) {
  const W = node.canvas.width, H = node.canvas.height;
  const g = node.canvas.getContext('2d', { willReadFrequently: true });
  const before = g.getImageData(0, 0, W, H);
  g.clearRect(0, 0, W, H);
  g.drawImage(out, 0, 0, W, H);
  const after = g.getImageData(0, 0, W, H);
  app.commit(pixelCmd(label, node, { x: 0, y: 0, w: W, h: H }, before, after));
}

const slider = (spec, value, onInput) => {
  const out = h('output', { class: 'studio-mono', text: Math.round(value) + (spec.unit || '') });
  const r = h('input', { class: 'studio-range', type: 'range', min: spec.min, max: spec.max, step: 1, value, 'aria-label': spec.label });
  r.addEventListener('input', () => { out.textContent = r.value + (spec.unit || ''); onInput(Number(r.value)); });
  return { el: h('label', { class: 'fl-slider' }, h('span', { text: spec.label }), out, r), set: (v) => { r.value = v; out.textContent = Math.round(v) + (spec.unit || ''); } };
};

// ================================================================= Film Lab (studio)

const FAV_KEY = 'eyad-studio:film:favs', MINE_KEY = 'eyad-studio:film:mine';
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') ?? d; } catch (e) { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
let mineLoaded = false;
function loadMine() {
  if (mineLoaded) return; mineLoaded = true;
  for (const m of readJSON(MINE_KEY, [])) { try { registerLook({ id: m.id, name: m.name, group: 'mine', desc: 'Saved look', params: m.params }); } catch (e) { /* skip */ } }
}

/** Full-screen Film Lab: big preview with a draggable before/after split, look strip, favourites, saved looks. */
export async function filmLabDialog(app) {
  if (!need(app)) return;
  const node = await app.ensureRasterTarget('Film Lab');
  if (!node) return;
  loadMine();
  const isMobile = matchMedia('(max-width: 760px)').matches;
  const src = downscale(node.canvas, isMobile ? 1000 : 1600);
  const thumbSrc = downscale(node.canvas, 180);
  let lookId = getLook(lastLook).id;
  let P = lastParams && lastParams.__look === lookId ? { ...lastParams } : defaultParams(lookId);
  let favs = new Set(readJSON(FAV_KEY, []));
  let rendered = null, token = 0, timer = 0, split = 0.5, compare = true;

  // --- stage with before/after split
  const view = h('canvas', { class: 'fls-view' });
  const stage = h('div', { class: 'fls-stage' }, view);
  const vg = view.getContext('2d');
  const paint = () => {
    const r = stage.getBoundingClientRect(); if (r.width < 2) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    view.width = Math.max(1, r.width * dpr); view.height = Math.max(1, r.height * dpr);
    const img = rendered || src;
    const k = Math.min(view.width * 0.94 / img.width, view.height * 0.94 / img.height);
    const w = img.width * k, hh = img.height * k, x = (view.width - w) / 2, y = (view.height - hh) / 2;
    vg.setTransform(1, 0, 0, 1, 0, 0); vg.clearRect(0, 0, view.width, view.height);
    vg.imageSmoothingQuality = 'high';
    vg.drawImage(img, x, y, w, hh);
    if (compare && rendered && rendered.width === src.width && rendered.height === src.height) {
      const sx = x + w * split;
      vg.save(); vg.beginPath(); vg.rect(x, y, sx - x, hh); vg.clip(); vg.drawImage(src, x, y, w, hh); vg.restore();
      vg.fillStyle = '#f3ede1'; vg.fillRect(sx - 1 * dpr, y, 2 * dpr, hh);
      vg.fillStyle = '#d02b2a'; vg.fillRect(sx - 10 * dpr, y + hh / 2 - 10 * dpr, 20 * dpr, 20 * dpr);
      vg.font = `700 ${10 * dpr}px ui-monospace, monospace`; vg.fillStyle = '#f3ede1';
      vg.fillText('BEFORE', x + 10 * dpr, y + 18 * dpr); vg.fillText('AFTER', x + w - 52 * dpr, y + 18 * dpr);
    }
  };
  let dragging = false;
  const setSplit = (e) => { const r = view.getBoundingClientRect(); const img = rendered || src; const k = Math.min(r.width * 0.94 / img.width, r.height * 0.94 / img.height); const w = img.width * k, x = r.left + (r.width - w) / 2; split = Math.max(0, Math.min(1, (e.clientX - x) / w)); paint(); };
  view.addEventListener('pointerdown', (e) => { dragging = true; view.setPointerCapture(e.pointerId); setSplit(e); });
  view.addEventListener('pointermove', (e) => { if (dragging) setSplit(e); });
  view.addEventListener('pointerup', () => { dragging = false; });
  const update = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const my = ++token;
      try {
        const out = await applyLook(src, lookId, { ...P, frame: compare ? 'none' : P.frame, dateStamp: compare ? false : P.dateStamp });
        if (my !== token) return;
        rendered = out; paint();
        status.textContent = getLook(lookId).name + (P.frame !== 'none' && compare ? ' · frame shows when compare is off' : '');
      } catch (e) { status.textContent = 'Preview failed: ' + e.message; }
    }, 50);
  };

  // --- look strip
  const groupsBar = h('div', { class: 'fl-groups', role: 'tablist' });
  const grid = h('div', { class: 'fls-strip' });
  const search = h('input', { class: 'studio-input fl-search', type: 'search', placeholder: `Search ${LOOKS.length} looks…`, 'aria-label': 'Search looks' });
  let group = favs.size ? 'favs' : (getLook(lookId).group || LOOK_GROUPS[0].id);
  const thumbs = new Map();
  const inGroup = (l) => (group === 'favs' ? favs.has(l.id) : group === 'all' ? true : l.group === group);
  const renderGrid = () => {
    const q = search.value.trim().toLowerCase();
    const list = LOOKS.filter((l) => (q ? (l.name + ' ' + (l.desc || '') + ' ' + l.group).toLowerCase().includes(q) : inGroup(l)));
    clear(grid);
    for (const l of list) {
      const img = h('canvas', { class: 'fl-thumb', width: 112, height: 112 });
      const star = h('span', { class: 'fls-star' + (favs.has(l.id) ? ' is-on' : ''), role: 'button', title: favs.has(l.id) ? 'Remove from favourites' : 'Add to favourites', text: '★', onclick: (e) => { e.stopPropagation(); if (favs.has(l.id)) favs.delete(l.id); else favs.add(l.id); writeJSON(FAV_KEY, [...favs]); star.classList.toggle('is-on', favs.has(l.id)); if (group === 'favs') renderGrid(); } });
      const b = h('button', { class: 'fl-look' + (l.id === lookId ? ' is-active' : ''), type: 'button', title: l.desc || l.name, dataset: { id: l.id }, onclick: () => pick(l.id) }, img, star, h('span', { text: l.name }));
      grid.appendChild(b);
      const draw = (c) => { img.width = c.width; img.height = c.height; img.getContext('2d').drawImage(c, 0, 0); };
      if (thumbs.has(l.id)) draw(thumbs.get(l.id));
      else lookThumbnail(thumbSrc, l.id, 112).then((c) => { thumbs.set(l.id, c); draw(c); }).catch(() => {});
    }
    if (!list.length) grid.appendChild(h('p', { class: 'studio-dim studio-small fls-empty', text: group === 'favs' ? 'Tap ★ on any look to keep it here.' : group === 'mine' ? 'Adjust a look and press “Save look” to keep it here.' : 'No looks match.' }));
  };
  const groups = [['favs', '★ Favourites'], ['mine', 'My looks'], ['all', 'All'], ...LOOK_GROUPS.filter((g) => LOOKS.some((l) => l.group === g.id)).map((g) => [g.id, g.name])];
  for (const [id, name] of groups) {
    groupsBar.appendChild(h('button', { class: 'fl-group' + (id === group ? ' is-active' : ''), type: 'button', dataset: { g: id }, text: name, onclick: (e) => {
      group = id; search.value = '';
      groupsBar.querySelectorAll('.fl-group').forEach((x) => x.classList.toggle('is-active', x === e.currentTarget));
      renderGrid();
    } }));
  }
  search.addEventListener('input', renderGrid);

  // --- controls
  const sliders = new Map();
  const controls = h('div', { class: 'fl-controls' });
  const sections = { basic: 'Basic', colour: 'Colour', texture: 'Texture', optics: 'Optics', effects: 'Light leaks' };
  for (const [gid, gname] of Object.entries(sections)) {
    const box = h('div', { class: 'fl-sec' }, h('div', { class: 'fl-sec-title', text: gname }));
    for (const spec of LOOK_PARAMS.filter((p) => p.group === gid)) {
      const sl = slider(spec, P[spec.key], (v) => { P[spec.key] = v; update(); });
      sliders.set(spec.key, sl); box.appendChild(sl.el);
    }
    controls.appendChild(box);
  }
  const frameSel = h('select', { class: 'studio-input', 'aria-label': 'Frame' }, FRAMES.map((f) => h('option', { value: f.id, text: f.name })));
  frameSel.addEventListener('change', () => { P.frame = frameSel.value; update(); });
  const stamp = h('input', { type: 'checkbox', 'aria-label': 'Date stamp' });
  const stampText = h('input', { class: 'studio-input', type: 'text', maxLength: 16, value: todayStamp(), 'aria-label': 'Date stamp text' });
  stamp.addEventListener('change', () => { P.dateStamp = stamp.checked; P.dateText = stampText.value; update(); });
  stampText.addEventListener('input', () => { P.dateText = stampText.value; if (P.dateStamp) update(); });
  controls.appendChild(h('div', { class: 'fl-sec' }, h('div', { class: 'fl-sec-title', text: 'Frame & date stamp' }),
    h('label', { class: 'fl-row' }, h('span', { text: 'Frame' }), frameSel),
    h('label', { class: 'fl-row' }, stamp, h('span', { text: 'Date stamp' }), stampText),
    h('p', { class: 'studio-small studio-faint', text: 'Frames and the stamp change the image size, so they are applied as a new document. Turn Compare off to preview them.' })));

  const syncControls = () => { for (const spec of LOOK_PARAMS) sliders.get(spec.key)?.set(P[spec.key]); frameSel.value = P.frame || 'none'; stamp.checked = !!P.dateStamp; };
  function pick(id) {
    lookId = id; lastLook = id;
    const keep = { frame: P.frame, dateStamp: P.dateStamp, dateText: P.dateText };
    P = { ...defaultParams(id), ...keep };
    grid.querySelectorAll('.fl-look').forEach((b) => b.classList.toggle('is-active', b.dataset.id === id));
    syncControls(); update();
  }
  const randomize = () => {
    const pool = LOOKS.filter((l) => l.group !== 'luts');
    pick(pool[Math.floor(Math.random() * pool.length)].id);
    for (const spec of LOOK_PARAMS) if (['grain', 'halation', 'bloom', 'leak', 'vignette', 'fade'].includes(spec.key)) { P[spec.key] = Math.round(Math.random() * spec.max * 0.6); }
    syncControls(); update();
  };
  const saveLook = async () => {
    const nm = await (await import('../core/ui.js')).promptDialog('Save look', 'Name', getLook(lookId).name + ' (mine)', { maxLength: 40 });
    if (!nm) return;
    const id = 'mine-' + Date.now().toString(36);
    const params = { ...P }; delete params.lut;
    const base = getLook(lookId);
    if (base.params && base.params.lut && typeof base.params.lut === 'string') params.lut = base.params.lut;
    registerLook({ id, name: nm, group: 'mine', desc: 'Saved look', params });
    const mine = readJSON(MINE_KEY, []); mine.push({ id, name: nm, params }); writeJSON(MINE_KEY, mine);
    group = 'mine'; groupsBar.querySelectorAll('.fl-group').forEach((x) => x.classList.toggle('is-active', x.dataset.g === 'mine'));
    renderGrid(); pick(id);
    toast(`Saved “${nm}” — find it under My looks (also in EYAD KAMERA’s look list after reload).`, { type: 'ok' });
  };
  const importBtn = h('button', { class: 'studio-btn is-small', type: 'button', onclick: async () => {
    const f = (await pickFiles({ accept: '.cube', multiple: false }))[0]; if (!f) return;
    try {
      const lut = await readCubeFile(f);
      const id = registerLook(lutToLook(lut));
      imported.push({ key: id, lut });
      group = 'luts'; renderGrid(); pick(id);
      toast(`LUT “${lut.title}” added to Imported LUTs.`, { type: 'ok' });
    } catch (e) { toast(e.message || 'Could not read that LUT.', { type: 'error' }); }
  } }, icon('upload', 13), h('span', { text: '.cube' }));
  const cmpBtn = h('button', { class: 'studio-btn is-small is-primary', type: 'button', onclick: () => { compare = !compare; cmpBtn.classList.toggle('is-primary', compare); update(); } }, icon('swap', 13), h('span', { text: 'Compare' }));
  const status = h('div', { class: 'fl-status studio-small studio-dim', role: 'status' });

  return new Promise((resolve) => {
    const overlay = h('div', { class: 'fls-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Film Lab' },
      h('header', { class: 'fls-top' },
        h('div', { class: 'fls-brand' }, h('b', { text: 'Film Lab' }), h('span', { class: 'fls-count', text: `${LOOKS.length} looks` }), h('em', { text: node.name })),
        h('div', { class: 'fls-actions' }, cmpBtn,
          h('button', { class: 'studio-btn is-small', type: 'button', onclick: randomize }, icon('sparkle', 13), h('span', { text: 'Surprise me' })),
          h('button', { class: 'studio-btn is-small', type: 'button', onclick: saveLook }, icon('star', 13), h('span', { text: 'Save look' })),
          importBtn,
          h('button', { class: 'studio-btn is-small is-ghost', type: 'button', text: 'Reset', onclick: () => pick(lookId) }),
          h('button', { class: 'studio-btn is-small', type: 'button', text: 'Cancel', onclick: () => close(null) }),
          h('button', { class: 'studio-btn is-small', type: 'button', text: 'New layer', onclick: () => close('layer') }),
          h('button', { class: 'studio-btn is-small is-primary', type: 'button', text: 'Apply', onclick: () => close('apply') }))),
      h('div', { class: 'fls-main' },
        h('div', { class: 'fls-center' }, stage, h('div', { class: 'fls-browser' }, h('div', { class: 'fl-top' }, search), groupsBar, grid)),
        h('aside', { class: 'fls-side' }, controls, status)));
    const onKey = (e) => {
      e.stopPropagation(); // the editor behind must not react (nudge, tool keys…)
      if (e.target.tagName === 'INPUT' && (e.target.type === 'text' || e.target.type === 'search')) return;
      if (e.target.tagName === 'INPUT' && e.target.type === 'range' && e.key.startsWith('Arrow')) return;
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
      if (e.key === 'Enter') { e.preventDefault(); close('apply'); }
      if (e.key === '\\' || e.key === 'y' || e.key === 'Y') { e.preventDefault(); cmpBtn.click(); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const btns = [...grid.querySelectorAll('.fl-look')]; const i = btns.findIndex((b) => b.dataset.id === lookId);
        const nb = btns[Math.max(0, Math.min(btns.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))]; if (nb) { e.preventDefault(); pick(nb.dataset.id); nb.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    app.root.appendChild(overlay);
    const ro = new ResizeObserver(paint); ro.observe(stage);
    requestAnimationFrame(() => { overlay.classList.add('is-in'); renderGrid(); syncControls(); update(); });
    async function close(v) {
      window.removeEventListener('keydown', onKey, true); ro.disconnect(); clearTimeout(timer); token++;
      overlay.remove();
      if (!v) { resolve(false); return; }
      lastParams = { ...P, __look: lookId };
      const prog = progressDialog('Developing', { cancellable: false });
      try {
        const out = await applyLook(node.canvas, lookId, P, { onProgress: (f) => prog.set(f, 'Rendering at full resolution…') });
        const label = 'Film Lab: ' + getLook(lookId).name;
        if (out.width !== node.canvas.width || out.height !== node.canvas.height) {
          const doc = createDoc({ name: (app.doc.name || 'Image') + ' — ' + getLook(lookId).name, width: out.width, height: out.height, background: 'transparent' });
          doc.layers[0].canvas = out; doc.layers[0].name = getLook(lookId).name;
          app.addDocument(doc);
          toast('Opened as a new document (the frame changes the size).', { type: 'ok' });
        } else if (v === 'layer') {
          addGeneratedLayer(app, out, { x: node.x || 0, y: node.y || 0, name: getLook(lookId).name, label });
        } else commitCanvas(app, node, out, label);
      } catch (e) { toast('Film Lab failed: ' + e.message, { type: 'error' }); }
      finally { prog.close(); resolve(true); }
    }
  });
}

// ================================================================= Color Lookup

export async function colorLookupDialog(app, file = null) {
  if (!need(app)) return;
  const node = await app.ensureRasterTarget('Color Lookup');
  if (!node) return;
  const src = downscale(node.canvas);
  const preview = makeCanvas(src.width, src.height);
  let lut = null, amount = 100, token = 0;
  const sel = h('select', { class: 'studio-input', 'aria-label': 'LUT' });
  const fill = () => {
    clear(sel);
    sel.appendChild(h('optgroup', { label: 'Built-in grades' }, BUILTIN_LUTS.map((b) => h('option', { value: 'b:' + b.id, text: b.name }))));
    if (imported.length) sel.appendChild(h('optgroup', { label: 'Imported .cube' }, imported.map((x, i) => h('option', { value: 'i:' + i, text: x.lut.title }))));
  };
  const choose = () => {
    const v = sel.value;
    lut = v.startsWith('b:') ? getBuiltinLut(v.slice(2)) : imported[Number(v.slice(2))]?.lut || null;
    run();
  };
  const run = async () => {
    const my = ++token;
    if (!lut) return;
    try {
      const out = await applyLut(src, lut, amount / 100);
      if (my !== token) return;
      preview.getContext('2d').clearRect(0, 0, preview.width, preview.height);
      preview.getContext('2d').drawImage(out, 0, 0);
      app.setLive({ nodeId: node.id, draw: (c) => c.drawImage(preview, 0, 0, node.canvas.width, node.canvas.height) });
    } catch (e) { toast(e.message, { type: 'error' }); }
  };
  const addFile = async (f) => {
    try {
      const l = await readCubeFile(f);
      imported.push({ key: 'imp' + imported.length, lut: l });
      fill(); sel.value = 'i:' + (imported.length - 1); choose();
      toast(`Loaded “${l.title}” (${l.kind.toUpperCase()}${l.size ? ', ' + l.size + '³' : ''}).`, { type: 'ok' });
    } catch (e) { toast(e.message || 'Could not read that LUT.', { type: 'error' }); }
  };
  fill();
  sel.addEventListener('change', choose);
  const amt = slider({ label: 'Intensity', min: 0, max: 100 }, 100, (v) => { amount = v; run(); });
  const imp = h('button', { class: 'studio-btn is-small', type: 'button', onclick: async () => { const f = (await pickFiles({ accept: '.cube', multiple: false }))[0]; if (f) addFile(f); } }, icon('upload', 13), h('span', { text: 'Load .cube file…' }));
  const body = h('div', { class: 'studio-stack' },
    h('label', { class: 'studio-field' }, h('span', { class: 'studio-field-label', text: 'Look-up table' }), sel), amt.el, imp,
    h('p', { class: 'studio-small studio-faint', text: '.cube files (1D or 3D, up to 65³) from cameras and grading tools work here. They are read on this device and never uploaded.' }));
  if (file) await addFile(file); else choose();
  const v = await dialog({ title: 'Color Lookup', body, width: 420, className: 'studio-dialog-adjust', buttons: [{ label: 'Cancel', value: null }, { label: 'Apply', value: true, primary: true }] });
  token++; app.setLive(null);
  if (!v || !lut) return;
  const prog = progressDialog('Applying LUT', { cancellable: false }); prog.set(null, 'Full resolution…');
  try { commitCanvas(app, node, await applyLut(node.canvas, lut, amount / 100), 'Color Lookup: ' + lut.title); }
  catch (e) { toast(e.message, { type: 'error' }); }
  finally { prog.close(); }
}

// ================================================================= Render textures (procedural, local)

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/** Smooth value noise (for paper, aurora). */
function makeNoise(rand) {
  const N = 256, p = new Float32Array(N * N); for (let i = 0; i < p.length; i++) p[i] = rand();
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = s(x - xi), yf = s(y - yi);
    const a = p[((yi & 255) * N) + (xi & 255)], b = p[((yi & 255) * N) + ((xi + 1) & 255)], c = p[(((yi + 1) & 255) * N) + (xi & 255)], d = p[(((yi + 1) & 255) * N) + ((xi + 1) & 255)];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

export const GENERATORS = {
  gradient: { label: 'Gradient', fields: ['c1', 'c2', 'angle'], draw(g, W, H, o) {
    const a = o.angle * Math.PI / 180, r = Math.hypot(W, H) / 2, cx = W / 2, cy = H / 2;
    const gr = g.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    gr.addColorStop(0, o.c1); gr.addColorStop(1, o.c2); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  } },
  mesh: { label: 'Mesh gradient', fields: ['c1', 'c2', 'c3', 'seed'], draw(g, W, H, o, rand) {
    g.fillStyle = o.c1; g.fillRect(0, 0, W, H);
    for (const [c, k] of [[o.c2, 0.9], [o.c3, 0.8], [o.c2, 0.6], [o.c3, 0.5]]) {
      const x = rand() * W, y = rand() * H, r = Math.max(W, H) * (0.35 + rand() * 0.4);
      const gr = g.createRadialGradient(x, y, 0, x, y, r); const [R, G, B] = hex(c);
      gr.addColorStop(0, `rgba(${R},${G},${B},${k})`); gr.addColorStop(1, `rgba(${R},${G},${B},0)`); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
  } },
  aurora: { label: 'Aurora glow', fields: ['c1', 'c2', 'c3', 'seed'], draw(g, W, H, o, rand) {
    g.fillStyle = o.c1; g.fillRect(0, 0, W, H);
    const noise = makeNoise(rand);
    g.globalCompositeOperation = 'lighter';
    for (let band = 0; band < 3; band++) {
      const col = hex(band === 1 ? o.c3 : o.c2), y0 = H * (0.25 + band * 0.18), amp = H * 0.12;
      for (let x = 0; x < W; x += Math.max(2, W / 400)) {
        const n = noise(x / W * 3 + band * 10, band * 3.7);
        const y = y0 + (n - 0.5) * amp * 2, len = H * (0.18 + noise(x / W * 6, band) * 0.35);
        const gr = g.createLinearGradient(0, y - len, 0, y + len * 0.2);
        gr.addColorStop(0, `rgba(${col},0)`); gr.addColorStop(0.8, `rgba(${col},${0.05 + n * 0.08})`); gr.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = gr; g.fillRect(x, y - len, Math.max(2, W / 400) + 1, len * 1.2);
      }
    }
    g.globalCompositeOperation = 'source-over';
  } },
  stars: { label: 'Star field', fields: ['c1', 'c2', 'density', 'seed'], draw(g, W, H, o, rand) {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, o.c1); gr.addColorStop(1, o.c2); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const n = Math.round(W * H / 4000 * (o.density / 50));
    for (let i = 0; i < n; i++) {
      const x = rand() * W, y = rand() * H, m = Math.pow(rand(), 6), r = 0.4 + m * 2.2 * Math.max(1, W / 2000);
      g.fillStyle = `rgba(255,${240 + rand() * 15 | 0},${220 + rand() * 35 | 0},${0.35 + m * 0.65})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      if (m > 0.6) { g.globalAlpha = 0.25; g.fillRect(x - r * 6, y - 0.4, r * 12, 0.8); g.fillRect(x - 0.4, y - r * 6, 0.8, r * 12); g.globalAlpha = 1; }
    }
  } },
  grain: { label: 'Film grain (overlay)', fields: ['amount', 'size', 'seed'], blend: 'overlay', draw(g, W, H, o, rand) {
    const s = Math.max(1, Math.round(o.size / 25)), w = Math.ceil(W / s), hh = Math.ceil(H / s);
    const t = makeCanvas(w, hh), tg = t.getContext('2d'), img = tg.createImageData(w, hh), d = img.data, A = o.amount / 100;
    for (let i = 0; i < d.length; i += 4) { const v = 128 + (rand() + rand() + rand() - 1.5) * 170 * A; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    tg.putImageData(img, 0, 0); g.imageSmoothingEnabled = s > 1; g.drawImage(t, 0, 0, W, H);
  } },
  paper: { label: 'Paper texture', fields: ['c1', 'amount', 'seed'], draw(g, W, H, o, rand) {
    const noise = makeNoise(rand), [R, G, B] = hex(o.c1), A = o.amount / 100;
    const s = Math.max(1, Math.round(Math.max(W, H) / 1400)), w = Math.ceil(W / s), hh = Math.ceil(H / s);
    const t = makeCanvas(w, hh), tg = t.getContext('2d'), img = tg.createImageData(w, hh), d = img.data;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const f = noise(x / 90, y / 90) * 0.5 + noise(x / 18, y / 18) * 0.3 + noise(x / 4, y / 4) * 0.2, fib = Math.abs(noise(x / 3 + 40, y / 40) - 0.5) < 0.012 ? -18 : 0;
      const v = (f - 0.5) * 60 * A + fib * A, i = (y * w + x) * 4;
      d[i] = R + v; d[i + 1] = G + v; d[i + 2] = B + v; d[i + 3] = 255;
    }
    tg.putImageData(img, 0, 0); g.drawImage(t, 0, 0, W, H);
  } },
  grid: { label: 'Technical grid', fields: ['c1', 'c2', 'size'], draw(g, W, H, o) {
    g.fillStyle = o.c1; g.fillRect(0, 0, W, H);
    const step = Math.max(6, o.size * Math.max(1, W / 1500));
    g.strokeStyle = o.c2;
    for (const [k, a, lw] of [[1, 0.18, 1], [5, 0.45, 1.5]]) {
      g.globalAlpha = a; g.lineWidth = lw; g.beginPath();
      for (let x = 0; x <= W; x += step * k) { g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, H); }
      for (let y = 0; y <= H; y += step * k) { g.moveTo(0, Math.round(y) + 0.5); g.lineTo(W, Math.round(y) + 0.5); }
      g.stroke();
    }
    g.globalAlpha = 1;
  } },
  halftone: { label: 'Halftone dots', fields: ['c1', 'c2', 'size', 'angle'], draw(g, W, H, o) {
    g.fillStyle = o.c1; g.fillRect(0, 0, W, H); g.fillStyle = o.c2;
    const step = Math.max(4, o.size * Math.max(1, W / 1500) * 0.6), a = o.angle * Math.PI / 180, R = Math.hypot(W, H);
    g.save(); g.translate(W / 2, H / 2); g.rotate(a);
    for (let y = -R; y < R; y += step) for (let x = -R; x < R; x += step) {
      const t = (x + R) / (2 * R); const r = step * 0.48 * t; if (r < 0.3) continue;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  } },
  bokeh: { label: 'Bokeh lights', fields: ['c1', 'c2', 'c3', 'seed'], draw(g, W, H, o, rand) {
    g.fillStyle = o.c1; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 70; i++) {
      const [R, G, B] = hex(rand() > 0.5 ? o.c2 : o.c3), x = rand() * W, y = rand() * H, r = Math.max(W, H) * (0.01 + Math.pow(rand(), 2) * 0.08);
      const gr = g.createRadialGradient(x, y, r * 0.2, x, y, r); gr.addColorStop(0, `rgba(${R},${G},${B},${0.08 + rand() * 0.18})`); gr.addColorStop(0.85, `rgba(${R},${G},${B},${0.05 + rand() * 0.1})`); gr.addColorStop(1, `rgba(${R},${G},${B},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  } },
};

const FIELD_SPECS = {
  c1: { label: 'Colour 1', type: 'color', def: '#0b0b0f' }, c2: { label: 'Colour 2', type: 'color', def: '#d02b2a' }, c3: { label: 'Colour 3', type: 'color', def: '#f3ede1' },
  angle: { label: 'Angle', min: -180, max: 180, def: 90, unit: '°' }, seed: { label: 'Seed', min: 1, max: 9999, def: 7 },
  density: { label: 'Density', min: 1, max: 100, def: 50 }, amount: { label: 'Amount', min: 0, max: 100, def: 45 }, size: { label: 'Size', min: 1, max: 100, def: 30 },
};

export async function renderTextureDialog(app, initial = 'mesh') {
  if (!need(app)) return;
  const W = app.doc.width, H = app.doc.height;
  const pk = Math.min(1, 520 / Math.max(W, H));
  const prev = h('canvas', { class: 'rt-preview', width: Math.max(1, Math.round(W * pk)), height: Math.max(1, Math.round(H * pk)) });
  let kind = initial;
  const o = Object.fromEntries(Object.entries(FIELD_SPECS).map(([k, s]) => [k, s.def]));
  let opacity = 100;
  const fieldsBox = h('div', { class: 'rt-fields' });
  const draw = (canvas, w, hh) => { const g = canvas.getContext('2d'); g.clearRect(0, 0, w, hh); GENERATORS[kind].draw(g, w, hh, o, mulberry(o.seed * 9973 + 1)); };
  const redraw = () => draw(prev, prev.width, prev.height);
  const buildFields = () => {
    clear(fieldsBox);
    for (const k of GENERATORS[kind].fields) {
      const s = FIELD_SPECS[k];
      if (s.type === 'color') { const i = h('input', { class: 'studio-color', type: 'color', value: o[k], 'aria-label': s.label }); i.addEventListener('input', () => { o[k] = i.value; redraw(); }); fieldsBox.appendChild(h('label', { class: 'fl-row' }, h('span', { text: s.label }), i)); }
      else fieldsBox.appendChild(slider(s, o[k], (v) => { o[k] = v; redraw(); }).el);
    }
    if (GENERATORS[kind].fields.includes('seed')) fieldsBox.appendChild(h('button', { class: 'studio-btn is-small', type: 'button', text: 'Shuffle', onclick: () => { o.seed = 1 + Math.floor(Math.random() * 9998); buildFields(); redraw(); } }));
    fieldsBox.appendChild(slider({ label: 'Layer opacity', min: 1, max: 100, unit: '%' }, opacity, (v) => { opacity = v; prev.style.opacity = v / 100; }).el);
  };
  const kinds = h('div', { class: 'rt-kinds' }, Object.entries(GENERATORS).map(([k, gdef]) => h('button', { class: 'fl-group' + (k === kind ? ' is-active' : ''), type: 'button', text: gdef.label, onclick: (e) => { kind = k; kinds.querySelectorAll('.fl-group').forEach((x) => x.classList.toggle('is-active', x === e.currentTarget)); buildFields(); redraw(); } })));
  buildFields(); redraw();
  const body = h('div', { class: 'rt-root' }, kinds, h('div', { class: 'rt-main' }, h('div', { class: 'rt-stage' }, prev), fieldsBox),
    h('p', { class: 'studio-small studio-faint', text: 'Generated on this device from maths and a seed — the same seed always gives the same result. Nothing is downloaded or uploaded.' }));
  const v = await dialog({ title: 'Render texture', body, width: 820, buttons: [{ label: 'Cancel', value: null }, { label: 'Add as layer', value: true, primary: true }] });
  if (!v) return;
  const out = makeCanvas(W, H);
  draw(out, W, H);
  const n = addGeneratedLayer(app, out, { name: GENERATORS[kind].label, label: 'Render ' + GENERATORS[kind].label });
  if (n) { n.opacity = opacity / 100; if (GENERATORS[kind].blend) n.blend = GENERATORS[kind].blend; app.invalidate(); app.refresh(); }
}
