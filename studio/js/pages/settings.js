// EYAD STUDIO — Settings (/studio/settings/).
import { h, formatBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, confirmDialog } from '../core/ui.js';
import { getSettings, setSetting, resetSettings, DEFAULTS } from '../core/settings.js';
import { storageInfo, requestPersist, wipeAll, db, cleanupOrphanMedia } from '../core/db.js';
import { shortcutsTable } from '../core/docs.js';
import { page } from './common.js';
import { offlineStatus, downloadOfflinePack, installGuide, bugReportDialog, startTour, isStandalone } from '../core/experience.js';
import { progressDialog } from '../core/ui.js';

function colorField(key) {
  const s = getSettings();
  const swatches = ['#d02b2a', '#ff6a3d', '#e9a23b', '#2fbf71', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#111111'];
  const input = h('input', { type: 'color', class: 'studio-color', value: s[key], 'aria-label': 'Custom accent colour' });
  const set = (v) => { setSetting(key, v); input.value = v; row.querySelectorAll('.hub-swatch').forEach((b) => b.classList.toggle('is-on', b.dataset.c === v)); };
  input.addEventListener('input', () => set(input.value));
  const row = h('span', { class: 'hub-swatches' }, swatches.map((c) => h('button', { class: 'hub-swatch' + (c === s[key] ? ' is-on' : ''), type: 'button', dataset: { c }, style: { background: c }, 'aria-label': 'Accent ' + c, onclick: () => set(c) })), input);
  return row;
}

// ---------------------------------------------------------------- offline & AI models
const offLine = h('p', { class: 'studio-dim', text: 'Checking…' });
async function refreshOffline() {
  const st = await offlineStatus().catch(() => null);
  if (!st || !st.supported) { offLine.textContent = 'This browser cannot store the offline pack.'; return; }
  offLine.textContent = st.done ? `Ready — every tool works offline (${st.total} parts saved).` : `${st.have} of ${st.total} parts saved. Download the rest to use AI, PDF import and 3D without internet.`;
}
async function getOfflinePack() {
  const p = progressDialog('Downloading the offline pack', { cancellable: false });
  try {
    const r = await downloadOfflinePack((d, n, label) => p.set(n ? d / n : null, label));
    toast(r.failed ? `${r.files} parts saved; ${r.failed} could not be downloaded right now.` : `Offline pack ready${r.models ? ` (+${r.models} AI models)` : ''}.`, { type: r.failed ? 'warn' : 'ok', timeout: 5000 });
  } catch (e) { toast(e.message, { type: 'error' }); }
  finally { p.close(); refreshOffline(); }
}
/** Downloads every AI model in this browser and packs studio/models/ as a zip for uploading to GitHub. */
async function buildModelsZip() {
  const ok = await confirmDialog('Build the models folder for GitHub', 'Your browser downloads every on-device AI model (about 55 MB in total, from the model hosts) and packs them into “studio-models.zip”. Unzip it into the studio/ folder of your repository and upload — then the Studio serves every model itself, forever, even if those hosts change. Files over 24 MB are split into parts automatically.', { ok: 'Download & build' });
  if (!ok) return;
  const p = progressDialog('Building models folder', { cancellable: false });
  try {
    const ai = await import('../core/ai.js');
    const files = await ai.modelFilesForRepo((label) => p.set(null, label));
    const entries = {};
    for (const [name, bytes] of files) entries['models/' + name] = [bytes, { level: 0 }];
    try {
      p.set(null, 'Object removal model (28 MB)…');
      const inp = await import('../core/inpaint.js');
      const spec = inp.INPAINT_MODELS && Object.values(inp.INPAINT_MODELS)[0];
      if (spec && spec.urls && spec.file) {
        let buf = null;
        for (const u of spec.urls) { try { const r = await fetch(u); if (r.ok) { buf = new Uint8Array(await r.arrayBuffer()); break; } } catch (e) { /* next */ } }
        if (buf) {
          const PART = 24 * 1000 * 1000, parts = [];
          for (let i = 0, n = 1; i < buf.length; i += PART, n++) { const name = `${spec.file}.part${n}`; entries['models/' + name] = [buf.subarray(i, i + PART), { level: 0 }]; parts.push(name); }
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
          entries[`models/${spec.file}.parts.json`] = [new TextEncoder().encode(JSON.stringify({ parts, bytes: buf.length, sha256: hash })), { level: 0 }];
        }
      }
    } catch (e) { /* optional */ }
    if (!Object.keys(entries).length) throw new Error('No models could be downloaded — check your internet connection.');
    const { zipSync } = await import('../../vendor/fflate/fflate.js');
    const blob = new Blob([zipSync(entries)], { type: 'application/zip' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'studio-models.zip' }); document.body.appendChild(a); a.click(); a.remove();
    toast(`studio-models.zip ready (${formatBytes(blob.size)}). Unzip it inside your repo's studio/ folder and upload.`, { type: 'ok', timeout: 9000 });
  } catch (e) { toast(e.message || 'Could not build the models zip.', { type: 'error' }); }
  finally { p.close(); }
}

function field(key, label, control, hint) {
  return h('div', { class: 'hub-setting' }, h('div', { class: 'hub-setting-text' }, h('label', { class: 'hub-setting-label', htmlFor: 'set-' + key, text: label }), hint ? h('p', { class: 'studio-dim studio-small', text: hint }) : null), control);
}
function select(key, options) {
  const s = getSettings();
  const el = h('select', { class: 'studio-input hub-setting-input', id: 'set-' + key }, options.map(([v, l]) => h('option', { value: String(v), text: l, selected: String(s[key]) === String(v) })));
  el.addEventListener('change', () => { const v = typeof DEFAULTS[key] === 'number' ? Number(el.value) : el.value; setSetting(key, v); toast('Saved', { type: 'ok', timeout: 900 }); });
  return el;
}
function toggle(key) {
  const s = getSettings();
  const el = h('input', { type: 'checkbox', id: 'set-' + key, class: 'hub-switch', checked: !!s[key] });
  el.addEventListener('change', () => { setSetting(key, el.checked); toast('Saved', { type: 'ok', timeout: 900 }); });
  return el;
}
function number(key, min, max, suffix) {
  const s = getSettings();
  const el = h('input', { class: 'studio-input is-num hub-setting-num', id: 'set-' + key, type: 'number', min, max, value: s[key] });
  el.addEventListener('change', () => { const v = Math.max(min, Math.min(max, Math.round(Number(el.value) || DEFAULTS[key]))); el.value = v; setSetting(key, v); toast('Saved', { type: 'ok', timeout: 900 }); });
  return h('span', { class: 'studio-row' }, el, suffix ? h('span', { class: 'studio-dim studio-small', text: suffix }) : null);
}
const card = (title, ic, ...rows) => h('section', { class: 'hub-settings-card studio-card' }, h('h2', { class: 'hub-settings-title' }, icon(ic, 18), h('span', { text: title })), ...rows);

const storageLine = h('p', { class: 'studio-dim' });
page('settings',
  h('section', { class: 'hub-pagehead' }, h('div', {}, h('h1', { class: 'studio-page-title' }, 'Settings'), h('p', { class: 'studio-page-lede', text: 'Preferences are stored in this browser only.' }))),
  h('div', { class: 'hub-settings' },
    card('Interface', 'sliders',
      field('theme', 'Theme', select('theme', [['portfolio', 'Match portfolio (recommended)'], ['light', 'Light — pearl glass'], ['dark', 'Dark — smoke glass'], ['system', 'Match system']]), 'Follows the portfolio’s Dark toggle by default.'),
      field('workspaceTheme', 'Editor workspace', select('workspaceTheme', [['dark', 'Smoke glass (recommended)'], ['light', 'Pearl glass'], ['match', 'Same as Studio theme']]), 'Image, Vector and Video use a dark workspace by default, like desktop creative apps.'),
      field('density', 'Density', select('density', [['comfortable', 'Comfortable'], ['compact', 'Compact (workstation)']])),
      field('uiScale', 'UI scale', select('uiScale', [[80, '80%'], [90, '90%'], [100, '100%'], [110, '110%'], [125, '125%'], [150, '150%']]), 'Larger text and rows for 4K screens or tablets.'),
      field('performance', 'Performance', select('performance', [['auto', 'Automatic (Performance on phones, Balanced on computers)'], ['quality', 'High quality'], ['balanced', 'Balanced'], ['performance', 'Performance']]), 'Lower settings preview at reduced resolution for smoother playback and painting. Exports always use full quality.'),
      field('reduceMotion', 'Reduce motion', toggle('reduceMotion'), 'Turns off interface animations.')),
    card('Look', 'star',
      field('poster', 'Colour mode', (() => { const el = select('poster', [['signal', 'Signal — red on paper (default)'], ['night', 'Night — red on black'], ['redroom', 'Red room'], ['ink', 'Ink'], ['cobalt', 'Cobalt'], ['sun', 'Sun'], ['forest', 'Forest'], ['lime', 'Lime'], ['blush', 'Blush'], ['royal', 'Royal'], ['mono', 'Mono'], ['clay', 'Clay']]); el.addEventListener('change', () => { document.documentElement.dataset.poster = el.value; window.__eyadBar && window.__eyadBar(); }); return el; })(), 'For the home screen and the Studio pages (Templates, Tools, Projects, Settings, Help).'),
      field('wallpaper', 'Editor background', select('wallpaper', [['work', 'Studio lights (default)'], ['plain', 'Plain']])),
      field('accent', 'Accent colour', colorField('accent'), 'Selections, sliders and highlights inside the editors.'),
      field('translucency', 'Live frosted glass in the editors', toggle('translucency'), 'Real-time blur behind bars and panels on computers. Phones never use it. Turn off on slow devices.'),
      field('splash', 'Launch screen', select('splash', [['installed', 'When the installed app starts (recommended)'], ['always', 'Every time an app opens'], ['never', 'Never']]), 'The EYAD loading screen with artwork, like desktop creative apps.')),
    card('Layout', 'dock',
      field('panelSide', 'Panels & tools', select('panelSide', [['right', 'Standard — tools left, panels right'], ['left', 'Mirrored — panels left, tools right']]), 'Applies to IMAGE, VECTOR and VIDEO. Window ▸ panels can also be hidden one by one, or all with Tab.'),
      field('forceDesktop', 'Desktop interface on phones', toggle('forceDesktop'), 'Shows the full computer layout on a phone (zoomed out — pinch to zoom). Reload the app after changing.'),
      h('div', { class: 'hub-actions' },
        h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => { try { Object.keys(localStorage).filter((k) => k.startsWith('eyad:tour:')).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ } startTour('home', { force: true }); } }, icon('compass', 14), h('span', { text: 'Replay the tours' })))),
    card('Offline & AI models', 'cloud',
      h('p', { class: 'studio-dim', text: 'Every AI model ships with the Studio (people, hair & skin, objects, click-to-select, faces and object removal) — nothing is fetched from anyone else. The offline pack stores them, the AI runtime, PDF / .ai import and the 3D engine on this device so every tool works without internet. The installed app does this by itself on the first launch.' }),
      offLine,
      h('div', { class: 'hub-actions' },
        h('button', { class: 'studio-btn is-small is-primary', type: 'button', onclick: getOfflinePack }, icon('download', 14), h('span', { text: 'Download offline pack' })),
        h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => installGuide(), disabled: isStandalone() }, icon('install', 14), h('span', { text: isStandalone() ? 'Installed' : 'Install as an app' })))),
    card('Pen, stylus & touch', 'pressure',
      field('penMode', 'Pen mode', select('penMode', [['auto', 'Automatic — once a stylus is used, fingers pan'], ['finger-draw', 'Fingers draw'], ['finger-pan', 'Fingers only pan & zoom']]), 'Apple Pencil, Android stylus, Windows pen and Wacom tablets all use pressure.'),
      field('pressureSize', 'Pressure → size', toggle('pressureSize')),
      field('pressureOpacity', 'Pressure → opacity', toggle('pressureOpacity')),
      field('pressureFlow', 'Pressure → flow', toggle('pressureFlow')),
      field('pressureMin', 'Lightest touch', number('pressureMin', 0, 100, '% of full'), 'How small/faint a stroke gets at the lightest pressure.'),
      field('touchUndoGestures', 'Two-finger tap = Undo, three-finger tap = Redo', toggle('touchUndoGestures')),
      field('pressureCurve', 'Pressure curve', select('pressureCurve', [[20, 'Very soft (light touch = big)'], [35, 'Soft'], [50, 'Normal'], [65, 'Firm'], [80, 'Very firm (press hard)']]), 'Graphics tablets (Wacom, XP-Pen, Huion), Apple Pencil and Surface pens. Plug the tablet in — no driver setup needed in the browser.'),
      field('penEraserTip', 'Pen eraser end = Eraser', toggle('penEraserTip'), 'Flip the pen (or hold its eraser button) to erase, like on desktop apps.'),
      field('tiltAngle', 'Brush angle follows pen tilt', toggle('tiltAngle'))),
    card('Saving & recovery', 'save',
      field('autosave', 'Autosave', toggle('autosave'), 'Keeps a recovery copy of unsaved work so it can be restored after a crash or closed tab.'),
      field('autosaveProjects', 'Auto-save saved projects', toggle('autosaveProjects'), 'Projects already saved to Projects are updated automatically.'),
      field('autosaveSeconds', 'Autosave interval', number('autosaveSeconds', 5, 600, 'seconds')),
      field('warnOnLeave', 'Warn before leaving with unsaved changes', toggle('warnOnLeave'))),
    card('EYAD IMAGE', 'image',
      field('imageWidth', 'Default width', number('imageWidth', 1, 12000, 'px')),
      field('imageHeight', 'Default height', number('imageHeight', 1, 12000, 'px')),
      field('imageBackground', 'Default background', select('imageBackground', [['white', 'White'], ['black', 'Black'], ['transparent', 'Transparent']])),
      field('historyLimit', 'History states', number('historyLimit', 10, 400), 'More states use more memory. Applies to newly opened documents.'),
      field('brushSmoothing', 'Brush smoothing', select('brushSmoothing', [[0, 'Off'], [0.2, 'Low'], [0.35, 'Medium'], [0.6, 'High']])),
      field('checker', 'Transparency grid', select('checker', [['light', 'Light'], ['mid', 'Medium'], ['dark', 'Dark']])),
      field('gridSize', 'Grid size', number('gridSize', 4, 1000, 'px'))),
    card('EYAD VIDEO', 'video',
      field('videoWidth', 'Default sequence width', number('videoWidth', 16, 8192, 'px')),
      field('videoHeight', 'Default sequence height', number('videoHeight', 16, 8192, 'px')),
      field('videoFps', 'Default frame rate', select('videoFps', [[24, '24'], [25, '25'], [30, '30'], [50, '50'], [60, '60']])),
      field('stillDuration', 'Still image duration', number('stillDuration', 1, 120, 'seconds')),
      field('transitionDuration', 'Default transition', number('transitionDuration', 0.1, 10, 'seconds')),
      field('storeMedia', 'Keep imported media in browser storage', toggle('storeMedia'), 'Needed to reopen video projects without relinking. Media never leaves this device.')),
    card('Storage & privacy', 'lock',
      h('p', { class: 'studio-dim', text: 'EYAD STUDIO has no server: files you open, projects and media are stored only in this browser (IndexedDB). Nothing is uploaded.' }),
      storageLine,
      h('div', { class: 'hub-actions' },
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Make storage persistent', onclick: async () => { const ok = await requestPersist(); toast(ok ? 'Storage is persistent' : 'The browser declined the request.', { type: ok ? 'ok' : 'warn' }); refreshStorage(); } }),
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Clean up unused media', onclick: async () => { const n = await cleanupOrphanMedia(); toast(n ? `Removed ${n} file(s)` : 'Nothing to clean up'); refreshStorage(); } }),
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Discard recovery copies', onclick: async () => { await db.clear('recovery'); toast('Recovery copies discarded'); refreshStorage(); } }),
        h('button', { class: 'studio-btn is-small is-danger', type: 'button', text: 'Delete all Studio data…', onclick: async () => { if (await confirmDialog('Delete all Studio data', 'This permanently deletes every project, stored media file and recovery copy in this browser. Your portfolio is not affected.', { ok: 'Delete everything', danger: true })) { await wipeAll(); toast('All Studio data deleted'); refreshStorage(); } } }))),
    card('Fonts', 'text',
      h('p', { class: 'studio-dim', text: 'Add your own fonts (.ttf, .otf, .woff, .woff2) or any Google Fonts family. They are stored in this browser, work offline, and show up in IMAGE, VECTOR and VIDEO.' }),
      h('div', { class: 'hub-actions' }, h('button', { class: 'studio-btn is-small is-primary', type: 'button', onclick: () => import('../core/fonts.js').then((m) => m.fontManagerDialog()) }, icon('text', 14), h('span', { text: 'Manage fonts…' })))),
    card('Help & feedback', 'bug',
      h('p', { class: 'studio-dim', text: 'Found something broken? The report includes device info and recent error logs (you can see and edit everything before sending). It opens in your mail app, addressed to Eyad.' }),
      h('div', { class: 'hub-actions' },
        h('button', { class: 'studio-btn is-small', type: 'button', onclick: () => bugReportDialog('settings') }, icon('bug', 14), h('span', { text: 'Report a bug…' })))),
    card('Reset', 'rotate',
      h('p', { class: 'studio-dim', text: 'Restore all preferences to their defaults (projects are kept).' }),
      h('button', { class: 'studio-btn is-small', type: 'button', text: 'Reset preferences', onclick: async () => { if (await confirmDialog('Reset preferences', 'Restore default settings?', { ok: 'Reset' })) { resetSettings(); location.reload(); } } })),
    card('Keyboard shortcuts', 'command', shortcutsTable())));

async function refreshStorage() {
  const s = await storageInfo().catch(() => null);
  storageLine.textContent = s ? `Using ${formatBytes(s.usage)}${s.quota ? ` of about ${formatBytes(s.quota)}` : ''} · ${s.persisted ? 'persistent storage' : 'best-effort storage (may be cleared by the browser when space is low)'}` : 'Storage estimate not available.';
}
refreshStorage();
refreshOffline();
if (location.hash === '#offline') setTimeout(() => offLine.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
