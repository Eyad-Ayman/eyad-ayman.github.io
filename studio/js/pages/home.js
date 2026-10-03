// EYAD Studio — home (/studio/). The main screen: a board of floating glass
// cards — a hero with search and open, the five studios, recent work, new
// document sizes and this device. Apps open with a zoom from their icon.
import { h, formatDate, formatBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ROUTES } from '../core/shell.js';
import { listProjects, listRecovery, storageInfo, cleanupOrphanMedia, takeHandoff } from '../core/db.js';
import { ACCEPT } from '../core/files.js';
import { chooseFiles } from '../core/open.js';
import { appIcon, APPS } from '../core/appicons.js';
import { startTour, installGuide, offlineStatus, isStandalone } from '../core/experience.js';
import { page, routeFiles, bindPageDrop, projectUrl, thumbImg } from './common.js';
import { getSettings, setSetting } from '../core/settings.js';

document.body.classList.add('xp-home');

const hour = new Date().getHours();
const greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
const openAny = async (title, accept, media) => { const f = await chooseFiles({ title, accept, multiple: true, media }); if (f.length) routeFiles(f); };
const OPEN_ALL = () => openAny('Open', ACCEPT.imageAll + ',' + ACCEPT.media + ',.prproj,.pdf,.ai,.fig,.glb,.gltf,.obj,.stl,.fbx', 'any');

/** Native-style launch: the icon zooms towards the viewer, then we navigate. */
function launchFrom(el, href) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { location.href = href; return; }
  const r = el.getBoundingClientRect();
  const z = h('div', { class: 'hm-zoom' });
  z.style.setProperty('--x', (r.left + r.width / 2) + 'px'); z.style.setProperty('--y', (r.top + r.height / 2) + 'px');
  document.body.append(z);
  requestAnimationFrame(() => z.classList.add('is-on'));
  setTimeout(() => { location.href = href; }, 260);
  setTimeout(() => z.remove(), 2500); // back/forward cache
}

// ---------------------------------------------------------------- poster home
const PORTFOLIO_IMG = (p) => new URL('assets/images/' + p, ROUTES.portfolio).href;
const hideOnError = (img) => { img.addEventListener('error', () => { img.hidden = true; }, { once: true }); return img; };
const go = (link, from) => link.addEventListener('click', (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); launchFrom(from(), link.href); });

const STUDIOS = [
  ['image', 'Photo · PSD'], ['vector', 'Logos · type'], ['video', 'Cut · colour'], ['3d', 'Model · render'], ['camera', 'Film · Y2K'],
];
const appsGrid = h('nav', { class: 'po-idx hm-apps', 'aria-label': 'Studios' }, STUDIOS.map(([id, sub], i) => {
  const a = APPS[id];
  const link = h('a', { class: 'po-app', href: ROUTES[a.route], dataset: { q: (a.name + ' ' + sub + ' ' + (a.desc || '')).toLowerCase() }, title: a.desc || a.name },
    h('b', { text: `(${i + 1}) ${a.short}` }), h('span', { class: 'po-mono', text: sub + ' →' }));
  go(link, () => link);
  return link;
}));

const installBtn = h('button', { class: 'po-pill', type: 'button', onclick: () => installGuide(), text: isStandalone() ? 'Installed' : 'Install' });
installBtn.hidden = isStandalone();
const nav = h('header', { class: 'po-nav' },
  h('a', { class: 'po-logo', href: ROUTES.home, 'aria-label': 'EYAD Studio' }, 'EYAD®STUDIO'),
  h('nav', { class: 'po-links po-mono', 'aria-label': 'Sections' },
    h('a', { href: ROUTES.templates, text: 'Templates' }), h('a', { href: ROUTES.projects, text: 'Projects' }),
    h('a', { href: ROUTES.settings, text: 'Settings' }), h('a', { href: ROUTES.help, text: 'Help' }),
    h('a', { href: ROUTES.portfolio, text: 'Portfolio ↗' })),
  h('div', { class: 'po-nav-r' }, installBtn, h('button', { class: 'po-pill is-fill', type: 'button', onclick: OPEN_ALL, text: 'Open a file' })));

const stage = h('section', { class: 'po-stage', 'aria-label': 'EYAD Studio' },
  h('div', { class: 'po-big', 'aria-hidden': 'true' }, 'EYAD', h('sup', { text: '®' })),
  hideOnError(h('img', { class: 'po-me', src: PORTFOLIO_IMG('hero/portrait.webp'), alt: 'Eyad Ayman', decoding: 'async', draggable: false })),
  h('div', { class: 'po-num', 'aria-hidden': 'true', text: '05' }),
  h('p', { class: 'po-cap po-k1 po-mono' }, 'Only on', h('br'), 'your device'),
  h('p', { class: 'po-cap po-k2 po-mono' }, 'Cairo', h('br'), 'Egypt — ' + new Date().getFullYear()),
  h('h1', { class: 'po-over' }, h('i', { text: 'The studio' }), h('i', { text: 'for every' }), h('i', {}, 'thing', h('span', { text: '®' }))),
  h('p', { class: 'po-cap po-k3 po-mono', text: 'Photo, design, video, 3D and a film camera. Made by Eyad Ayman. Nothing is uploaded.' }),
  h('p', { class: 'po-cap po-k4 po-mono' }, greet, h('br'), 'World is yours'));

// ---- colour modes
const MODES = [['signal', 'Signal'], ['night', 'Night'], ['redroom', 'Red room'], ['ink', 'Ink'], ['cobalt', 'Cobalt'], ['sun', 'Sun'], ['forest', 'Forest'], ['lime', 'Lime'], ['blush', 'Blush'], ['royal', 'Royal'], ['mono', 'Mono'], ['clay', 'Clay']];
const setMode = (id) => { document.documentElement.dataset.poster = id; setSetting('poster', id); for (const b of modes.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === id)); };
const modes = h('div', { class: 'po-modes', role: 'group', 'aria-label': 'Colour mode' },
  h('span', { class: 'po-mono', text: 'Colour mode' }),
  MODES.map(([id, name]) => h('button', { class: 'po-mode', type: 'button', title: name, 'aria-label': name, dataset: { mode: id, poster: id }, onclick: () => setMode(id) })));

const hero = h('div', { class: 'po-hero' }, nav, stage, appsGrid);

// ---- below the fold: search, continue, start new, this device, work
const search = h('input', { class: 'po-search-input', type: 'search', placeholder: 'Search apps, sizes, projects', 'aria-label': 'Search', autocomplete: 'off' });
const sec = (n, title, cls, ...kids) => h('section', { class: 'po-sec ' + cls }, h('h2', { class: 'po-h' }, h('span', { class: 'po-mono', text: `(0${n})` }), title), ...kids);

const SIZES = [
  ['image', 'Instagram post', 1080, 1080], ['image', 'Portrait 4:5', 1080, 1350], ['image', 'Story / Reel', 1080, 1920], ['image', 'YouTube thumbnail', 1280, 720],
  ['image', 'A4 poster @300', 2480, 3508], ['vector', 'Logo', 1000, 1000], ['vector', 'Business card', 1050, 600], ['vector', 'Slide 16:9', 1920, 1080],
  ['video', 'Reel 9:16', 1080, 1920], ['video', 'Full HD video', 1920, 1080], ['3d', '3D scene', 1920, 1080], ['camera', 'Take a photo', 1080, 1440],
];
const newUrl = (kind, name, w, hh) => (kind === '3d' || kind === 'camera') ? ROUTES[kind] : `${ROUTES[kind]}?new=1&w=${w}&h=${hh}&name=${encodeURIComponent(name)}`;
const createGrid = h('div', { class: 'po-sizes xp-quick-grid' }, SIZES.map(([k, name, w, hh]) =>
  h('a', { class: 'po-size', href: newUrl(k, name, w, hh), dataset: { q: (name + ' ' + k).toLowerCase() } },
    h('b', { text: name }), h('span', { class: 'po-mono', text: `${APPS[k].short}${k === '3d' || k === 'camera' ? '' : ` · ${w}×${hh}`}` }))));
const recentBox = h('div', { class: 'po-recent' }, h('p', { class: 'po-mono', text: 'Loading…' }));
const W = (label) => { const v = h('b', { text: '—' }); const s = h('span', { class: 'po-mono' }); return { el: h('div', { class: 'po-stat' }, h('span', { class: 'po-mono', text: label }), v, s), v, s }; };
const wStore = W('Storage'), wOff = W('Offline'), wProj = W('Projects');
const recoverBox = h('div', { class: 'xp-recover', hidden: true });

const WORK = ['09-travis-scott-ft-ferrari-poster', '11-ahmed-santa-music-poster', '170245581-redbull-poster', '12-ford-mustang-classic-poster', '163747233-maadi-town-mafia-gta-cover-style', '02-mercedes-g63', '165709049-marwan-moussa-drogba-song', '170329483-nissan-gtr-r35-ad-poster'];
const work = h('a', { class: 'po-work', href: ROUTES.portfolio, title: 'See the work in the portfolio' },
  WORK.map((n) => hideOnError(h('img', { src: PORTFOLIO_IMG('behance/' + n + '.webp'), alt: '', loading: 'lazy', decoding: 'async' }))));

const below = h('div', { class: 'po-below' },
  h('div', { class: 'po-tools' }, h('label', { class: 'po-search' }, icon('search', 16), search), modes),
  sec(1, 'Continue', 'po-continue xp-recent', h('a', { class: 'po-more po-mono', href: ROUTES.projects, text: 'All projects →' }), recentBox),
  sec(2, 'Start new', 'po-new', h('a', { class: 'po-more po-mono', href: ROUTES.templates, text: 'Templates →' }), createGrid),
  sec(3, 'This device', 'po-device', h('div', { class: 'po-stats' }, wStore.el, wOff.el, wProj.el), recoverBox,
    h('div', { class: 'po-actions' },
      h('button', { class: 'po-pill', type: 'button', onclick: () => openAny('Open PSD', ACCEPT.psd, 'image'), text: 'Open PSD' }),
      h('button', { class: 'po-pill', type: 'button', onclick: () => openAny('Open PDF, .ai or .fig', '.pdf,.ai,.eps,.fig,.svg', 'image'), text: 'PDF · AI · SVG' }),
      h('button', { class: 'po-pill', type: 'button', onclick: () => startTour('home', { force: true }), text: 'Take the tour' }))),
  sec(4, 'Selected work', 'po-worksec', h('a', { class: 'po-more po-mono', href: ROUTES.portfolio, text: 'Portfolio ↗' }), work),
  h('p', { class: 'po-foot po-mono' }, 'EYAD Studio 5 · by Eyad Ayman · your files stay on this device'));

const shell = h('div', { class: 'po' }, hero, below);

addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, textarea, select, .studio-dialog')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const n = +e.key; if (n >= 1 && n <= STUDIOS.length) { appsGrid.children[n - 1].click(); return; }
  if (e.key === '/') { e.preventDefault(); search.scrollIntoView({ block: 'center' }); search.focus(); }
});
let recentCards = [];
const searchable = () => [...appsGrid.children, ...createGrid.children, ...recentCards];
search.addEventListener('input', () => { const q = search.value.trim().toLowerCase(); for (const el of searchable()) el.classList.toggle('is-dim', !!q && !el.dataset.q.includes(q)); });
search.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { search.value = ''; search.dispatchEvent(new Event('input')); search.blur(); return; }
  if (e.key !== 'Enter' || !search.value.trim()) return;
  const a = searchable().find((x) => !x.classList.contains('is-dim')); if (a) a.click();
});

page('home', shell);
bindPageDrop();
setMode(getSettings().poster || 'signal');

(async () => {
  const q = new URLSearchParams(location.search);
  if (q.get('handoff')) {
    history.replaceState(null, '', location.pathname);
    const files = await takeHandoff(q.get('handoff')).catch(() => null);
    if (files && files.length) { routeFiles(files); return; }
  }
  cleanupOrphanMedia();
  let projects = [];
  try { projects = await listProjects(); } catch (e) { projects = null; }
  const recent = projects ? projects.sort((a, b) => (b.opened || b.updated) - (a.opened || a.updated)).slice(0, 10) : [];
  if (recent.length) {
    recentCards = recent.slice(0, 6).map((p) => { const k = APPS[p.kind] ? p.kind : 'image'; return h('a', { class: 'po-proj', href: projectUrl(p), dataset: { q: (p.name + ' ' + k).toLowerCase() }, title: p.name },
      h('span', { class: 'po-proj-media' }, thumbImg(p)), h('b', { text: p.name }), h('span', { class: 'po-mono', text: `${APPS[k].short}${p.source === 'psd' ? ' · PSD' : ''} · ${formatDate(p.updated)}` })); });
    recentBox.replaceChildren(...recentCards);
  } else {
    recentBox.replaceChildren(h('p', { class: 'po-empty', text: projects ? 'No projects yet — everything you save lands here.' : 'This browser blocks local storage (private mode?). You can still download your work as .eyad files.' }));
  }
  try {
    const rec = await listRecovery();
    if (rec.length) {
      recoverBox.hidden = false;
      recoverBox.replaceChildren(icon('warn', 15), h('span', { text: `Unsaved work found: ${rec.map((r) => r.name).slice(0, 3).join(', ')}` }),
        ...([...new Set(rec.map((r) => r.kind))].filter((k) => ROUTES[k]).map((k) => h('a', { class: 'studio-btn is-small', href: ROUTES[k], text: 'Restore in ' + (APPS[k] || APPS.image).short }))));
    }
  } catch (e) { /* ignore */ }
  const s = await storageInfo().catch(() => null);
  const off = await offlineStatus().catch(() => null);
  wStore.v.textContent = s ? formatBytes(s.usage) : '—'; wStore.s.textContent = s && s.quota ? 'of ' + formatBytes(s.quota) + ' available' : '';
  wOff.v.textContent = !off || !off.supported ? 'Not supported' : off.done ? 'Ready' : `${off.have}/${off.total}`; wOff.s.textContent = off && off.done ? 'Every tool works without internet' : 'Downloads in the background after install';
  wProj.v.textContent = projects ? String(projects.length) : '—'; wProj.s.textContent = 'Saved on this device';
  setTimeout(() => { if (!document.querySelector('.studio-scrim')) startTour('home'); }, 1800);
})();
