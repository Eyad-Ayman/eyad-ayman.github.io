// EYAD KAMERA — first-run guide. A short coach flow that points at the real
// controls (swipe, arrow keys or the buttons; Skip / Esc / tap outside never
// trap you), plus a one-time card the first time 3D ×4 is chosen.
// Remembered in localStorage: eyad:tour:camera and eyad:tour:camera:quad.
// Under automated testing nothing starts by itself — add ?tour=1 to force it.
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';

const KEY = 'eyad:tour:camera';
const KEY_QUAD = 'eyad:tour:camera:quad';
const forced = () => { try { return new URLSearchParams(location.search).get('tour') === '1'; } catch (e) { return false; } };
const seen = (k) => { try { return !!localStorage.getItem(k); } catch (e) { return true; } };
const mark = (k) => { try { localStorage.setItem(k, '1'); } catch (e) { /* storage blocked */ } };
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function steps(api) {
  const touch = coarse();
  return [
    { sel: '.cam-viewbox, .cam-stage', title: 'Welcome to Kamera', text: `This is your viewfinder — what you see is what you get, look and lens included. ${touch ? 'Tap' : 'Click'} the picture to focus and set exposure there${touch ? ', pinch to zoom' : ''}. Nothing you shoot leaves this device.` },
    { sel: '.cam-ctl', title: 'Modes and the shutter', text: `Burst · 3D ×4 · Photo · Portrait · Video — ${touch ? 'tap a mode or swipe this bar' : 'click a mode'}. The big button shoots. Your shots from this session open from the round button on one side; the other one flips the camera.` },
    { sel: '.cam-looks', title: 'Looks', text: 'One strip, five families: Film stocks, Flash, AI (finds the person on this device), Y2K cameras and Lenses. Pick a family, then swipe the strip. A film look, one effect and one lens can be combined.', before: () => api.setCat('film') },
    { sel: '.cam-looks', title: 'Lenses', text: 'Fisheye, action wide, tilt-shift, crystal ball, anamorphic, star filter and more — real optics maths, live. A strength slider appears on the picture, and the lens is applied at full size when you shoot or record.', before: () => api.setCat('lens'), after: () => api.setCat('film') },
    { sel: '.cam-mode[data-mode="quad"]', title: '3D ×4', text: 'Four viewpoints become a moving 3D photo. Press the shutter and slide the camera a little sideways while the four lenses fire — or hold still and let AI depth lift the subject off the background.' },
    { sel: '.cam-bar', title: 'Camera controls', text: 'Frame shape, flash, self-timer and grid live up here. The sliders button opens Adjust — exposure, colour, grain, frames, date stamp, LUTs and any manual controls your camera allows. The three dots hold quality, histogram and this guide.' },
    { sel: '.cam-gallery', title: 'After the shot', text: 'Every capture opens for review: save it, share it, send it to EYAD IMAGE or VIDEO to edit — or tap AI prompt and describe a look in words. That is it. Go shoot.' },
  ];
}

let active = null;

/** Start the guide. `force` ignores "already seen" and the automated-testing guard. */
export function startTour({ force = false, api = { setCat() {}, closePanel() {} } } = {}) {
  if (active) return;
  force = force || forced();
  if (!force) {
    if (navigator.webdriver) return;       // never auto-start under automated testing
    if (seen(KEY)) return;
    if (document.querySelector('.studio-scrim, .studio-sheet, .cam-review:not([hidden]), .kt-root')) return;
  }
  mark(KEY);
  api.closePanel && api.closePanel();
  const list = steps(api);
  let i = -1;
  const hole = h('div', { class: 'kt-hole', 'aria-hidden': 'true' });
  const title = h('h2', { class: 'kt-title' }), text = h('p', { class: 'kt-text' });
  const dots = h('div', { class: 'kt-dots', 'aria-hidden': 'true' }, list.map(() => h('i')));
  const back = h('button', { class: 'studio-btn is-ghost kt-btn', type: 'button', text: 'Back', onclick: () => go(i - 1) });
  const next = h('button', { class: 'studio-btn is-primary kt-btn', type: 'button', onclick: () => go(i + 1) });
  const skip = h('button', { class: 'studio-btn is-ghost kt-btn kt-skip', type: 'button', text: 'Skip', onclick: () => end() });
  const card = h('div', { class: 'kt-card', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'How to use Kamera' },
    h('div', { class: 'kt-head' }, h('span', { class: 'kt-step' }), skip), title, text,
    h('div', { class: 'kt-foot' }, dots, h('span', { class: 'kt-gap' }), back, next));
  const root = h('div', { class: 'kt-root' }, hole, card);
  document.body.appendChild(root);
  root.addEventListener('click', (e) => { if (e.target === root || e.target === hole) go(i + 1); });

  const target = () => {
    for (const s of list[i].sel.split(',')) { const el = document.querySelector(s.trim()); if (el) { const r = el.getBoundingClientRect(); if (r.width > 4 && r.height > 4) return r; } }
    return null;
  };
  let raf = 0;
  const place = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (i < 0) return;
      const W = innerWidth, H = innerHeight, r = target(), pad = 6, m = 12;
      const cw = Math.min(360, W - m * 2);
      card.style.width = cw + 'px';
      const ch = card.offsetHeight || 190;
      if (!r) { hole.style.opacity = '0'; card.style.left = (W - cw) / 2 + 'px'; card.style.top = Math.max(m, (H - ch) / 2) + 'px'; return; }
      hole.style.opacity = '1';
      const hx = Math.max(4, r.left - pad), hy = Math.max(4, r.top - pad), hw = Math.min(W - 4, r.right + pad) - hx, hh = Math.min(H - 4, r.bottom + pad) - hy;
      Object.assign(hole.style, { left: hx + 'px', top: hy + 'px', width: hw + 'px', height: hh + 'px' });
      // put the card where there is the most room: below, above, left, right — else over the target's far end
      const room = { below: H - (hy + hh), above: hy, left: hx, right: W - (hx + hw) };
      let x = Math.max(m, Math.min(W - cw - m, hx + hw / 2 - cw / 2)), y;
      if (room.below >= ch + m * 2) y = hy + hh + m;
      else if (room.above >= ch + m * 2) y = hy - ch - m;
      else if (room.left >= cw + m * 2) { x = hx - cw - m; y = Math.max(m, Math.min(H - ch - m, hy + hh / 2 - ch / 2)); }
      else if (room.right >= cw + m * 2) { x = hx + hw + m; y = Math.max(m, Math.min(H - ch - m, hy + hh / 2 - ch / 2)); }
      else y = hy + hh / 2 > H / 2 ? Math.max(m, hy + m) : Math.max(m, Math.min(H - ch - m, hy + hh - ch - m));
      card.style.left = x + 'px'; card.style.top = Math.max(m, Math.min(H - ch - m, y)) + 'px';
    });
  };
  function go(n) {
    if (n < 0) return;
    if (i >= 0 && list[i].after) { try { list[i].after(); } catch (e) { /* ignore */ } }
    if (n >= list.length) { end(); return; }
    i = n;
    if (list[i].before) { try { list[i].before(); } catch (e) { /* ignore */ } }
    title.textContent = list[i].title; text.textContent = list[i].text;
    card.querySelector('.kt-step').textContent = `${i + 1} of ${list.length}`;
    [...dots.children].forEach((d, k) => d.classList.toggle('is-on', k === i));
    back.hidden = i === 0;
    next.textContent = i === list.length - 1 ? 'Done' : 'Next';
    place(); setTimeout(place, 260);
    next.focus({ preventScroll: true });
  }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); go(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(i - 1); }
  };
  // swipe the card
  let sx = null;
  card.addEventListener('pointerdown', (e) => { sx = e.target.closest('button') ? null : e.clientX; }, { passive: true });
  card.addEventListener('pointerup', (e) => { if (sx === null) return; const d = e.clientX - sx; sx = null; if (Math.abs(d) > 40) go(i + (d < 0 ? 1 : -1)); }, { passive: true });
  card.addEventListener('pointercancel', () => { sx = null; }, { passive: true });
  function end() {
    if (!active) return;
    active = null;
    if (i >= 0 && list[i] && list[i].after) { try { list[i].after(); } catch (e) { /* ignore */ } }
    removeEventListener('keydown', onKey, true); removeEventListener('resize', place);
    root.classList.add('is-out'); setTimeout(() => root.remove(), 200);
  }
  addEventListener('keydown', onKey, true);
  addEventListener('resize', place);
  active = { end };
  go(0);
}

function lensDiagram() {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 240 84'); s.setAttribute('class', 'kt-diagram'); s.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); s.appendChild(el); return el; };
  add('rect', { x: 34, y: 14, width: 172, height: 44, rx: 14, fill: 'none', stroke: 'currentColor', 'stroke-opacity': '.35', 'stroke-width': 1.5 });
  for (let i = 0; i < 4; i++) {
    add('circle', { cx: 60 + i * 40, cy: 36, r: 13, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 });
    add('circle', { cx: 60 + i * 40, cy: 36, r: 5, fill: i === 0 ? '#ffd60a' : 'currentColor', 'fill-opacity': i === 0 ? 1 : 0.45 });
  }
  add('path', { d: 'M70 74h96M158 68l8 6-8 6', fill: 'none', stroke: '#ffd60a', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  return s;
}

/** One-time card the first time 3D ×4 is selected. */
export function quadGuide({ force = false } = {}) {
  force = force || forced();
  if (!force && (navigator.webdriver || seen(KEY_QUAD))) return;
  if (document.querySelector('.kt-root')) return;
  mark(KEY_QUAD);
  const row = (ic, head, body) => h('li', {}, icon(ic, 18), h('div', {}, h('b', { text: head }), h('span', { text: body })));
  const close = () => { removeEventListener('keydown', onKey, true); root.classList.add('is-out'); setTimeout(() => root.remove(), 200); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(); } };
  const ok = h('button', { class: 'studio-btn is-primary kt-btn', type: 'button', text: 'Got it', onclick: close });
  const card = h('div', { class: 'kt-card kt-quad', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'How 3D ×4 works' },
    lensDiagram(),
    h('h2', { class: 'kt-title', text: '3D ×4 — a four-lens 3D photo' }),
    h('p', { class: 'kt-text', text: 'Four slightly different viewpoints are played back and forth, so the picture seems to turn in space. You can save it as a video, a GIF, four photos or a film strip.' }),
    h('ul', { class: 'kt-list' },
      row('move', 'Sweep', 'Press the shutter and slide the camera slowly sideways, about a hand-width, while the four lenses fire. These are four real photos — the most natural 3D.'),
      row('sparkle', 'AI depth', 'Hold still. A model on this device estimates how far things are and builds the other three viewpoints from one photo. Best with a clear subject; it is an estimate, so fine hair or glass can smear.'),
      row('wand', 'Auto', 'Kamera measures how much you moved and picks for you. Change it any time with the button next to the four lens dots, or after the shot.')),
    h('p', { class: 'kt-text kt-small', text: 'Tip: keep the subject 1–3 m away with something behind it. After the shot, tap the picture to choose which point stays still.' }),
    h('div', { class: 'kt-foot' }, h('span', { class: 'kt-gap' }), ok));
  const root = h('div', { class: 'kt-root is-center' }, card);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  document.body.appendChild(root);
  addEventListener('keydown', onKey, true);
  ok.focus({ preventScroll: true });
}
