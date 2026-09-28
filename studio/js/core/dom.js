// EYAD STUDIO — tiny DOM helpers.
// All text goes through textContent; nothing from user files is ever
// assigned to innerHTML, so imported names/paths can't inject markup.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function on(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  return () => target.removeEventListener(type, fn, opts);
}

/** True when a keyboard event is aimed at a text field (so shortcuts should stay out of the way). */
export function isTyping(e) {
  const t = e.target;
  if (!t || !(t instanceof Element)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (t.getAttribute('type') || 'text').toLowerCase();
    return !['checkbox', 'radio', 'range', 'button', 'color', 'file'].includes(type);
  }
  return false;
}

export const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
export const modKey = (e) => (isMac ? e.metaKey : e.ctrlKey);

/** Human shortcut label: 'Mod+Shift+Z' -> '⌘⇧Z' on Mac, 'Ctrl+Shift+Z' elsewhere. */
export function keyLabel(combo) {
  if (!combo) return '';
  const parts = combo.split('+');
  if (isMac) {
    const map = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃' };
    return parts.map((p) => map[p] || p).join('');
  }
  return parts.map((p) => (p === 'Mod' ? 'Ctrl' : p)).join('+');
}

export function debounce(fn, ms) {
  let t = 0;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export function uid(prefix = '') {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return prefix + r[0].toString(36) + r[1].toString(36);
}

export function formatBytes(n) {
  if (!isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
}

export function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = Date.now();
  const diff = (now - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + ' h ago';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

/** Timecode HH:MM:SS:FF */
export function timecode(sec, fps = 30) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const totalFrames = Math.round(sec * fps);
  const f = totalFrames % fps;
  const s = Math.floor(totalFrames / fps);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(f)}`;
}

export function nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }
export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
