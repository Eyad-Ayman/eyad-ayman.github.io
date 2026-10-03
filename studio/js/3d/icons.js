// EYAD 3D — extra line icons for 3D (24×24, 1.6px stroke, same style as
// core/icons.js). Drawn for this project. Unknown names fall back to the
// shared Studio icon set.
import { icon as coreIcon } from '../core/icons.js';

const P = {
  multi: 'M4 4h10v10H4zM10 10h10v10H10zM15 13v4M13 15h4',
  timeline: 'M3 6h18M3 12h18M3 18h18M8 4v4M15 10v4M11 16v4',
  cube: 'M12 3 20 7.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  sphere: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12c0 2.2 4 4 9 4s9-1.8 9-4M12 3c-2.5 2.4-3.6 5.6-3.6 9s1.1 6.6 3.6 9',
  cylinder: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6',
  cone: 'M12 3 5 18M12 3l7 15M5 18c0 1.7 3.1 3 7 3s7-1.3 7-3-3.1-3-7-3-7 1.3-7 3z',
  torus: 'M12 6c5 0 9 2.7 9 6s-4 6-9 6-9-2.7-9-6 4-6 9-6zM12 10c2.2 0 4 .9 4 2s-1.8 2-4 2-4-.9-4-2 1.8-2 4-2z',
  plane: 'M3 15 9 9h12l-6 6zM3 15h12',
  capsule: 'M8 8a4 4 0 0 1 8 0v8a4 4 0 0 1-8 0zM8 8c0 1.1 1.8 2 4 2s4-.9 4-2',
  knot: 'M7 7c3-4 10-4 10 2s-10 4-10 8 7 4 10 0M7 7c-2 3 0 6 5 6s7 3 5 5',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  spot: 'M9 3h6l-1 5h-4zM10 8 5 20M14 8l5 12M5 20h14',
  hemi: 'M3 12a9 9 0 0 1 18 0zM3 12h18M7 16v2M12 16v4M17 16v2',
  ambient: 'M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM12 1.5v1.5M12 21v1.5M1.5 12H3M21 12h1.5',
  model: 'M12 3 20 7.5v9L12 21l-8-4.5v-9zM8 5.3l8 4.4M12 12l8-4.5M12 12v9M12 12 4 7.5',
  light: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  orbit: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM3 12c0-2.8 4-5 9-5s9 2.2 9 5-4 5-9 5c-1.6 0-3.1-.2-4.4-.6M6 14.5 7.6 16.4 5.5 17.5',
  turntable: 'M4 16c0 2.2 3.6 4 8 4s8-1.8 8-4M4 16c0-2.2 3.6-4 8-4s8 1.8 8 4M12 12V4M9 6l3-3 3 3M17.5 19l2.5-3M17.5 13l2.5 3',
  frame: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  persp: 'M4 8 12 4l8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  ortho: 'M4 4h16v16H4zM4 12h16M12 4v16',
  key: 'M12 4l8 8-8 8-8-8z',
  keyPlus: 'M10 5l7 7-7 7-7-7zM19 3v6M16 6h6',
  keyMinus: 'M10 5l7 7-7 7-7-7zM16 6h6',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  render: 'M4 5h16v12H4zM8 21h8M12 17v4M9 9l6 2-6 2z',
  snap: 'M5 4h4v8a3 3 0 0 0 6 0V4h4v8a7 7 0 0 1-14 0zM5 8h4M15 8h4',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.4 3.6 5.6 3.6 9s-1.1 6.6-3.6 9c-2.5-2.4-3.6-5.6-3.6-9S9.5 5.4 12 3z',
  local: 'M5 19V5M5 19h14M5 19l9-9M14 10v4M14 10h-4',
  texture: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  first: 'M18 5 9 12l9 7zM6 5v14',
  ico: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5h16L12 21zM12 3 7.5 13.5M12 3l4.5 10.5',
  area: 'M4 5h16v8H4zM7 13l-2 7M12 13v7M17 13l2 7',
  empty: 'M12 3v18M3 12h18M6.5 6.5l11 11',
  shWire: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 2.6 4 5.8 4 9s-1 6.4-4 9c-3-2.6-4-5.8-4-9s1-6.4 4-9z',
  shSolid: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 9.5a5 5 0 0 1 4-2.5',
  shMat: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18M3 12h18M12 3a9 9 0 0 1 9 9h-9z',
  shRender: 'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 1.5v2M12 20.5v2M1.5 12h2M20.5 12h2M4.6 4.6 6 6M18 18l1.4 1.4M4.6 19.4 6 18M18 6l1.4-1.4',
  overlay: 'M9 6a6 6 0 1 0 0 12A6 6 0 0 0 9 6zM15 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z',
};

const NS = 'http://www.w3.org/2000/svg';

export function icon(name, size = 18, extraClass = '') {
  if (!P[name]) return coreIcon(name, size, extraClass);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'studio-icon' + (extraClass ? ' ' + extraClass : ''));
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', P[name]);
  svg.appendChild(path);
  return svg;
}

export function iconButton3(name, label, onclick, { shortcut = '', cls = '', size = 18 } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'studio-icon-btn ' + cls;
  b.setAttribute('aria-label', label);
  b.title = shortcut ? `${label} (${shortcut})` : label;
  b.addEventListener('click', onclick);
  b.appendChild(icon(name, size));
  return b;
}
