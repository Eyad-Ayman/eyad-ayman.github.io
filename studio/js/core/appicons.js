// EYAD Experience — original app icons (squircle tiles, drawn as SVG so they
// stay sharp at any size and can be rasterised for the install manifest).

const NS = 'http://www.w3.org/2000/svg';

export const APPS = {
  home: { name: 'EYAD Experience', short: 'Experience', bg: ['#2a2a2e', '#070708'], route: 'home' },
  image: { name: 'EYAD IMAGE', short: 'Image', bg: ['#ff6a55', '#b3121c'], route: 'image', desc: 'Layers, PSD, Raw Develop, Film Lab, AI' },
  vector: { name: 'EYAD VECTOR', short: 'Vector', bg: ['#ffc15e', '#e0661b'], route: 'vector', desc: 'Pen, shapes, type, PDF · AI · SVG' },
  video: { name: 'EYAD VIDEO', short: 'Video', bg: ['#a78bfa', '#4c1d95'], route: 'video', desc: 'Timeline, keyframes, titles, colour' },
  '3d': { name: 'EYAD 3D', short: '3D', bg: ['#5eead4', '#0f5f59'], route: '3d', desc: 'Models, scenes, lights, render' },
  camera: { name: 'EYAD CAMERA', short: 'Camera', bg: ['#4a4a50', '#141416'], route: 'camera', desc: '136 film & camera looks, live' },
  templates: { name: 'Templates', short: 'Templates', bg: ['#fbf6ec', '#d8ccb6'], route: 'templates', desc: 'Posts, stories, posters, CVs' },
  projects: { name: 'Projects', short: 'Projects', bg: ['#7cb8ff', '#1d4ed8'], route: 'projects', desc: 'Everything saved on this device' },
  settings: { name: 'Settings', short: 'Settings', bg: ['#9ca3af', '#3f4450'], route: 'settings', desc: 'Look, layout, pen, offline' },
  help: { name: 'Help', short: 'Help', bg: ['#34d399', '#047857'], route: 'help', desc: 'Guides & supported files' },
};

const CREAM = '#fbf5ea', INK = '#141414', RED = '#d02b2a';

const GLYPHS = {
  home: `<text x="50" y="68" text-anchor="middle" font-family="Oswald,'Studio Oswald',Impact,sans-serif" font-weight="700" font-size="54" fill="${CREAM}" letter-spacing="-1">E</text><rect x="62" y="24" width="12" height="12" rx="2" fill="${RED}"/>`,
  image: `<rect x="23" y="27" width="54" height="46" rx="7" fill="none" stroke="${CREAM}" stroke-width="5"/><circle cx="62" cy="41" r="6" fill="${CREAM}"/><path d="M26 69l17-19 12 12 7-7 13 14z" fill="${CREAM}"/>`,
  vector: `<path d="M22 66C30 38 48 30 78 34" fill="none" stroke="${CREAM}" stroke-width="4" stroke-linecap="round"/><rect x="17" y="61" width="10" height="10" rx="1.5" fill="${INK}" stroke="${CREAM}" stroke-width="3"/><rect x="73" y="29" width="10" height="10" rx="1.5" fill="${INK}" stroke="${CREAM}" stroke-width="3"/><path d="M50 44l10 22-10 12-10-12z" fill="${CREAM}"/><circle cx="50" cy="61" r="3" fill="#e0661b"/><path d="M50 52v7" stroke="#e0661b" stroke-width="2.5"/>`,
  video: `<rect x="20" y="30" width="60" height="40" rx="8" fill="none" stroke="${CREAM}" stroke-width="5"/><path d="M45 40l15 10-15 10z" fill="${CREAM}"/><path d="M20 78h60" stroke="${CREAM}" stroke-width="4" stroke-linecap="round" opacity=".55"/><path d="M34 74v8" stroke="${CREAM}" stroke-width="4" stroke-linecap="round"/>`,
  '3d': `<path d="M50 20l27 15v30L50 80 23 65V35z" fill="none" stroke="${CREAM}" stroke-width="5" stroke-linejoin="round"/><path d="M23 35l27 15 27-15M50 50v30" fill="none" stroke="${CREAM}" stroke-width="5" stroke-linejoin="round"/><path d="M50 50L77 35 50 20 23 35z" fill="${CREAM}" opacity=".3"/>`,
  camera: `<circle cx="50" cy="52" r="23" fill="#0b0b0c" stroke="${CREAM}" stroke-width="5"/><circle cx="50" cy="52" r="12" fill="#1e2a3a"/><circle cx="46" cy="48" r="4" fill="${CREAM}" opacity=".85"/><rect x="66" y="22" width="12" height="7" rx="2" fill="${RED}"/>`,
  templates: `<rect x="21" y="22" width="26" height="32" rx="4" fill="${RED}"/><rect x="53" y="22" width="26" height="18" rx="4" fill="${INK}"/><rect x="53" y="46" width="26" height="32" rx="4" fill="#e9a23b"/><rect x="21" y="60" width="26" height="18" rx="4" fill="${INK}" opacity=".85"/>`,
  projects: `<path d="M20 34a6 6 0 0 1 6-6h14l6 6h28a6 6 0 0 1 6 6v28a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6z" fill="${CREAM}"/><path d="M20 42h60" stroke="#1d4ed8" stroke-width="3" opacity=".35"/>`,
  settings: `<g fill="none" stroke="${CREAM}" stroke-width="5"><circle cx="50" cy="50" r="10"/><path d="M50 22v8M50 70v8M22 50h8M70 50h8M30 30l6 6M64 64l6 6M30 70l6-6M64 36l6-6" stroke-linecap="round"/><circle cx="50" cy="50" r="20"/></g>`,
  help: `<circle cx="50" cy="50" r="26" fill="none" stroke="${CREAM}" stroke-width="5"/><path d="M41 42a9 9 0 1 1 13 8c-3 2-4 3-4 7" fill="none" stroke="${CREAM}" stroke-width="5" stroke-linecap="round"/><circle cx="50" cy="66" r="3.5" fill="${CREAM}"/>`,
};

/** SVG markup for an app icon (100×100 viewBox). */
export function appIconSVG(id, { size = 64 } = {}) {
  const a = APPS[id] || APPS.home;
  const gid = 'g' + id.replace(/\W/g, '') + Math.random().toString(36).slice(2, 7);
  const glyph = GLYPHS[id] || GLYPHS.home;
  return `<svg xmlns="${NS}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a.bg[0]}"/><stop offset="1" stop-color="${a.bg[1]}"/></linearGradient>
<linearGradient id="${gid}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
<rect x="5" y="5" width="90" height="90" rx="21" fill="url(#${gid})"/>
<rect x="5" y="5" width="90" height="90" rx="21" fill="url(#${gid}h)"/>
<rect x="5.5" y="5.5" width="89" height="89" rx="20.5" fill="none" stroke="#000" stroke-opacity=".18"/>
${glyph}
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
