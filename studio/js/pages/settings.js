// EYAD STUDIO — Settings (/studio/settings/).
import { h, formatBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, confirmDialog } from '../core/ui.js';
import { getSettings, setSetting, resetSettings, DEFAULTS } from '../core/settings.js';
import { storageInfo, requestPersist, wipeAll, db, cleanupOrphanMedia } from '../core/db.js';
import { shortcutsTable } from '../core/docs.js';
import { page } from './common.js';

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
  h('section', { class: 'hub-pagehead' }, h('div', {}, h('h1', { class: 'studio-page-title' }, 'SETT', h('em', { text: 'INGS' })), h('p', { class: 'studio-page-lede', text: 'Preferences are stored in this browser only.' }))),
  h('div', { class: 'hub-settings' },
    card('Interface', 'sliders',
      field('theme', 'Theme', select('theme', [['portfolio', 'Match portfolio (recommended)'], ['light', 'Light (cream)'], ['dark', 'Dark'], ['system', 'Match system']]), 'Matches the portfolio home: cream by default, dark when the portfolio’s Dark toggle is on.'),
      field('density', 'Density', select('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']])),
      field('reduceMotion', 'Reduce motion', toggle('reduceMotion'), 'Turns off interface animations.')),
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
      field('storeMedia', 'Keep imported media in browser storage', toggle('storeMedia'), 'Needed to reopen video projects without relinking. Media never leaves this device.')),
    card('Storage & privacy', 'lock',
      h('p', { class: 'studio-dim', text: 'EYAD STUDIO has no server: files you open, projects and media are stored only in this browser (IndexedDB). Nothing is uploaded.' }),
      storageLine,
      h('div', { class: 'hub-actions' },
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Make storage persistent', onclick: async () => { const ok = await requestPersist(); toast(ok ? 'Storage is persistent' : 'The browser declined the request.', { type: ok ? 'ok' : 'warn' }); refreshStorage(); } }),
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Clean up unused media', onclick: async () => { const n = await cleanupOrphanMedia(); toast(n ? `Removed ${n} file(s)` : 'Nothing to clean up'); refreshStorage(); } }),
        h('button', { class: 'studio-btn is-small', type: 'button', text: 'Discard recovery copies', onclick: async () => { await db.clear('recovery'); toast('Recovery copies discarded'); refreshStorage(); } }),
        h('button', { class: 'studio-btn is-small is-danger', type: 'button', text: 'Delete all Studio data…', onclick: async () => { if (await confirmDialog('Delete all Studio data', 'This permanently deletes every project, stored media file and recovery copy in this browser. Your portfolio is not affected.', { ok: 'Delete everything', danger: true })) { await wipeAll(); toast('All Studio data deleted'); refreshStorage(); } } }))),
    card('Reset', 'rotate',
      h('p', { class: 'studio-dim', text: 'Restore all preferences to their defaults (projects are kept).' }),
      h('button', { class: 'studio-btn is-small', type: 'button', text: 'Reset preferences', onclick: async () => { if (await confirmDialog('Reset preferences', 'Restore default settings?', { ok: 'Reset' })) { resetSettings(); location.reload(); } } })),
    card('Keyboard shortcuts', 'command', shortcutsTable())));

async function refreshStorage() {
  const s = await storageInfo().catch(() => null);
  storageLine.textContent = s ? `Using ${formatBytes(s.usage)}${s.quota ? ` of about ${formatBytes(s.quota)}` : ''} · ${s.persisted ? 'persistent storage' : 'best-effort storage (may be cleared by the browser when space is low)'}` : 'Storage estimate not available.';
}
refreshStorage();
