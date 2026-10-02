// EYAD Studio — app icons, in the same glass language as the interface:
// round glass discs with a soft colour body, a frosted rim, a top gloss and a
// two-layer glyph (a translucent back layer and a solid front layer that
// lifts on hover, so every icon has real depth). Pure SVG — sharp at any size,
// and rasterised for the install manifest.

const NS = 'http://www.w3.org/2000/svg';

export const APPS = {
  home: { name: 'EYAD Studio', short: 'Home', route: 'home', code: 'EYD', c: ['#f4f5f9', '#8e95a8'] },
  image: { code: 'IMG', name: 'EYAD IMAGE', short: 'Image', route: 'image', desc: 'Layers, PSD, Raw Develop, Film Lab, AI', c: ['#ff8a7a', '#e2366b'] },
  vector: { code: 'VEC', name: 'EYAD VECTOR', short: 'Vector', route: 'vector', desc: 'Pen, shapes, type, PDF · AI · SVG', c: ['#ffc56b', '#f0762e'] },
  video: { code: 'VID', name: 'EYAD VIDEO', short: 'Video', route: 'video', desc: 'Timeline, keyframes, titles, colour', c: ['#b49bff', '#5a3fd6'] },
  '3d': { code: '3D', name: 'EYAD 3D', short: '3D', route: '3d', desc: 'Models, scenes, lights, render', c: ['#6ff0da', '#1690a8'] },
  camera: { code: 'CAM', name: 'EYAD KAMERA', short: 'Kamera', route: 'camera', desc: 'Film looks, AI filters, flash, pro controls', c: ['#5b5d66', '#1b1c21'] },
  templates: { code: 'TPL', name: 'Templates', short: 'Templates', route: 'templates', desc: 'Trends, posts, stories, posters', c: ['#d9ff7a', '#3fb86a'] },
  projects: { code: 'PRJ', name: 'Projects', short: 'Projects', route: 'projects', desc: 'Everything saved on this device', c: ['#8fd0ff', '#2e6ff0'] },
  settings: { code: 'SET', name: 'Settings', short: 'Settings', route: 'settings', desc: 'Look, layout, pen, offline', c: ['#c9ccd4', '#6b707c'] },
  help: { code: 'HLP', name: 'Help', short: 'Help', route: 'help', desc: 'Guides & supported files', c: ['#9ff5c8', '#1f9e6e'] },
};

// Glyphs: [back layer, front layer] — drawn in a 100×100 box, white.
const W = 'fill="#fff"', S = (w) => `fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const GLYPH = {
  home: [`<rect x="29" y="29" width="42" height="42" rx="12" ${W}/>`,
    `<path d="M41 38h19M41 50h15M41 62h19M41 38v24" ${S(6)}/>`],
  image: [`<rect x="27" y="31" width="46" height="38" rx="9" ${W}/>`,
    `<circle cx="60" cy="43" r="5" ${W}/><path d="M30 66l14-15 10 10 6-6 11 11z" ${W}/>`],
  vector: [`<path d="M28 66C33 44 49 34 72 34" ${S(4)}/><rect x="24" y="62" width="9" height="9" rx="2" ${W}/><rect x="68" y="30" width="9" height="9" rx="2" ${W}/>`,
    `<path d="M50 40l11 23-11 10-11-10z" ${W}/><circle cx="50" cy="59" r="3" fill="#f0762e"/>`],
  video: [`<rect x="25" y="31" width="50" height="38" rx="10" ${W}/>`,
    `<path d="M45 41l15 9-15 9z" ${W}/>`],
  '3d': [`<path d="M50 24l24 13v26L50 76 26 63V37z" ${W}/>`,
    `<path d="M26 37l24 13 24-13M50 50v26" ${S(4.5)}/>`],
  camera: [`<rect x="24" y="33" width="52" height="38" rx="10" ${W}/><rect x="38" y="26" width="18" height="9" rx="3" ${W}/>`,
    `<circle cx="50" cy="52" r="11" fill="none" stroke="#fff" stroke-width="5"/><circle cx="66" cy="41" r="2.6" ${W}/>`],
  templates: [`<rect x="27" y="27" width="21" height="27" rx="6" ${W}/><rect x="52" y="46" width="21" height="27" rx="6" ${W}/>`,
    `<rect x="52" y="27" width="21" height="15" rx="5" ${W}/><rect x="27" y="58" width="21" height="15" rx="5" ${W}/>`],
  projects: [`<path d="M25 36a6 6 0 0 1 6-6h12l5 5h21a6 6 0 0 1 6 6v25a6 6 0 0 1-6 6H31a6 6 0 0 1-6-6z" ${W}/>`,
    `<path d="M25 45h50" ${S(4)}/>`],
  settings: [`<path d="M50 24l6 5 8-1 3 7 7 4-1 8 5 6-5 6 1 8-7 4-3 7-8-1-6 5-6-5-8 1-3-7-7-4 1-8-5-6 5-6-1-8 7-4 3-7 8 1z" ${W}/>`,
    `<circle cx="50" cy="53" r="9" fill="none" stroke="#fff" stroke-width="5"/>`],
  help: [`<circle cx="50" cy="50" r="25" ${W}/>`,
    `<path d="M42 44a8 8 0 1 1 12 7c-3 2-4 3-4 6" ${S(5)}/><circle cx="50" cy="65" r="3" ${W}/>`],
};

/** Kept for compatibility — there is one icon set. */
export function setIconLook() {}

let seq = 0;
/** SVG markup for an app icon (100×100 viewBox). */
export function appIconSVG(id, { size = 64 } = {}) {
  const a = APPS[id] || APPS.home;
  const u = 'ic' + (++seq).toString(36) + Math.random().toString(36).slice(2, 5);
  const [back, front] = GLYPH[id] || GLYPH.home;
  const dark = id === 'camera';
  return `<svg xmlns="${NS}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true" class="eyad-icon">
<defs>
<linearGradient id="${u}b" x1=".15" y1="0" x2=".85" y2="1"><stop offset="0" stop-color="${a.c[0]}"/><stop offset="1" stop-color="${a.c[1]}"/></linearGradient>
<radialGradient id="${u}g" cx=".5" cy="0" r=".75"><stop offset="0" stop-color="#fff" stop-opacity="${dark ? '.34' : '.55'}"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>
<radialGradient id="${u}s" cx=".5" cy="1" r=".7"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<filter id="${u}d" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="2.2" stdDeviation="2" flood-color="#000" flood-opacity="${dark ? '.5' : '.28'}"/></filter>
</defs>
<circle cx="50" cy="50" r="47" fill="url(#${u}b)"/>
<circle cx="50" cy="50" r="47" fill="url(#${u}s)"/>
<circle cx="50" cy="50" r="47" fill="url(#${u}g)"/>
<g class="eyad-icon-back" opacity=".38">${back}</g>
<g class="eyad-icon-front" filter="url(#${u}d)">${front}</g>
<circle cx="50" cy="50" r="46.3" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.4"/>
<path d="M18 30a38 38 0 0 1 64 0" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.2" stroke-linecap="round"/>
</svg>`;
}

/** DOM element for an app icon. */
export function appIcon(id, size = 64) {
  const t = document.createElement('template');
  t.innerHTML = appIconSVG(id, { size }).trim();
  const el = t.content.firstElementChild;
  el.classList.add('xp-appicon');
  return el;
}
