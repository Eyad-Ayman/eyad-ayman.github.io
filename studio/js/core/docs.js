// EYAD STUDIO — shared documentation content & dialogs (help, shortcuts,
<<<<<<< HEAD
import { icon } from './icons.js';
=======
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
// supported files, compatibility reports). Also used by /studio/help/.
import { h } from './dom.js';
import { dialog } from './ui.js';
import { keyLabel } from './dom.js';

export const SUPPORTED = [
  { group: 'Image', items: [
    ['PNG', 'full', 'Open, place, export'],
    ['JPEG / JPG', 'full', 'Open, place, export'],
    ['WebP', 'full', 'Open, place, export'],
    ['GIF', 'partial', 'First frame only (animation is not imported)'],
    ['SVG', 'partial', 'Rasterised on import; scripts and external resources never run'],
<<<<<<< HEAD
    ['PSD', 'partial', 'Real parser: layers, groups, masks, opacity, blend modes. Text, smart objects, adjustments and layer styles are reported and imported as pixels/placeholders'],
=======
    ['PSD', 'partial', 'Real parser: layered documents, masks, clipping, common blend modes, editable text where the source exposes usable text data, vector paths and selected layer styles. Unsupported features keep a reference composite.'],
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
    ['PSB', 'partial', 'Large-document PSD — limited by browser memory'],
    ['AVIF / HEIC', 'browser', 'Only if your browser can decode them'],
  ] },
  { group: 'Video & audio', items: [
    ['MP4 (H.264 / AAC)', 'full', 'Plays in all modern browsers'],
    ['WebM (VP8/VP9/AV1, Opus)', 'full', 'Chrome, Edge, Firefox; Safari 16+ (VP9) and 17+'],
    ['MOV', 'browser', 'Works when the codec inside is H.264/HEVC your browser supports (e.g. Safari). ProRes is usually not supported'],
    ['MP3', 'full', ''],
    ['WAV', 'full', 'PCM'],
    ['AAC / M4A', 'browser', 'Supported by most browsers'],
    ['OGG / Opus / FLAC', 'browser', 'Depends on the browser'],
  ] },
  { group: 'Projects', items: [
    ['.eyad', 'full', 'Native EYAD STUDIO project (image or video)'],
    ['.prproj', 'partial', 'Premiere Pro projects: sequences, tracks, clips, timing, media references and markers are reconstructed where the XML structure allows. Effects, transitions and proprietary features are reported, not reproduced. Media must be relinked'],
  ] },
  { group: 'Export', items: [
    ['PNG / JPEG / WebP', 'full', 'Flattened image export with quality and scale'],
    ['PSD', 'experimental', 'Experimental PSD Export: layers, groups, names, opacity, blend modes, masks. Text and shapes are rasterised; transforms are baked'],
    ['Video (WebM / MP4)', 'browser', 'Rendered in real time with MediaRecorder; format depends on the browser'],
    ['Audio (WAV)', 'full', 'Offline mixdown of the sequence audio'],
    ['.eyad', 'full', 'Download your project to keep or move it'],
  ] },
];

export const SHORTCUTS = [
  { group: 'Everywhere', items: [['Mod+K', 'Command palette'], ['Mod+Z', 'Undo'], ['Mod+Shift+Z', 'Redo'], ['Mod+S', 'Save'], ['Mod+Shift+S', 'Save as'], ['Mod+O', 'Open'], ['Mod+N', 'New'], ['Mod+C / X / V', 'Copy / cut / paste'], ['Mod+A', 'Select all']] },
  { group: 'Image tools', items: [['V', 'Move / transform'], ['M', 'Marquee (Shift+M: rect/ellipse)'], ['L', 'Lasso'], ['C', 'Crop'], ['B', 'Brush'], ['E', 'Eraser'], ['G', 'Gradient / Paint bucket (Shift+G switches)'], ['S', 'Clone stamp (Alt-click sets source)'], ['T', 'Text'], ['U', 'Shape'], ['P', 'Pen'], ['I', 'Eyedropper'], ['H', 'Hand (or hold Space)'], ['Z', 'Zoom']] },
  { group: 'Image editing', items: [['[ / ]', 'Brush size'], ['0–9', 'Brush opacity'], ['X', 'Swap colours'], ['D', 'Default colours'], ['Mod+T', 'Free transform'], ['Mod+J', 'Layer via copy'], ['Mod+G', 'Group layers'], ['Mod+E', 'Merge down'], ['Mod+D', 'Deselect'], ['Mod+Shift+I', 'Inverse selection'], ['Mod+0', 'Fit on screen'], ['Mod+1', 'Actual size'], ['F', 'Fullscreen'], ['Tab', 'Hide panels']] },
  { group: 'Video', items: [['Space', 'Play / pause'], ['J / K / L', 'Shuttle back / stop / forward'], ['I / O', 'Mark in / out'], ['V', 'Selection tool'], ['C', 'Razor tool'], ['S', 'Split at playhead'], ['M', 'Add marker'], ['← / →', 'Step one frame'], ['Delete', 'Delete clip'], ['Shift+Delete', 'Ripple delete'], ['+ / −', 'Zoom timeline']] },
  { group: 'Video — editing (2027 pass)', items: [['Q / W', 'Ripple trim previous / next edit to playhead'], ['A', 'Track select forward (Shift+A: this track)'], ['Alt+← / →', 'Nudge clip one frame'], ['Shift+D', 'Apply default transition (Cross Dissolve)'], ['Mod+Shift+D', 'Dip to black'], ['T / Shift+T', 'New title / lower third'], ['Shift+K / Alt+K', 'Next / previous keyframe'], ['Mod+R', 'Speed / duration'], ['Mod+U', 'Add media from a link'], ['Mod+M / Mod+E', 'Export video']] },
  { group: 'Video — monitor', items: [['Shift + = / −', 'Zoom monitor in / out'], ['Shift+0', 'Fit monitor'], ['Ctrl + wheel / pinch', 'Zoom monitor'], ['Space + drag / middle drag', 'Pan monitor'], ["'", 'Safe margins'], ['Drag on monitor', 'Move the selected clip (keyframes if animated; Alt disables snapping)'], ['F', 'Fullscreen']] },
  { group: 'Vector', items: [['V / A', 'Selection / direct selection'], ['P', 'Pen'], ['N', 'Pencil'], ['B', 'Brush'], ['M / L', 'Rectangle / ellipse'], ['T', 'Type'], ['G', 'Gradient'], ['I', 'Eyedropper'], ['Shift+O', 'Artboard'], ['H / Space', 'Hand'], ['Mod+G / Mod+Shift+G', 'Group / ungroup'], ['Mod+8', 'Compound path'], ['Mod+[ / ]', 'Send backward / bring forward']] },
  { group: 'Switch apps', items: [['Mod+Alt+1 / 2 / 3', 'Image / Vector / Video']] },
];

const statusMark = { full: ['✓', 'ok'], partial: ['△', 'part'], browser: ['△', 'part'], experimental: ['△', 'part'], none: ['×', 'no'] };

export function supportedTable() {
  return h('div', { class: 'studio-report' }, SUPPORTED.map((g) => h('div', { class: 'studio-report-group' },
    h('h3', { text: g.group }),
    g.items.map(([name, st, note]) => {
      const [mk, cls] = statusMark[st] || ['·', ''];
      return h('div', { class: 'studio-report-row ' + cls }, h('span', { class: 'mk', text: mk }),
        h('div', {}, h('b', { text: name }), st === 'experimental' ? h('span', { class: 'studio-badge', text: 'Experimental', style: { marginLeft: '6px' } }) : st === 'browser' ? h('span', { class: 'studio-badge is-muted', text: 'Browser-dependent', style: { marginLeft: '6px' } }) : null, note ? h('small', { text: note }) : null));
    }))));
}

export function shortcutsTable() {
  return h('div', { class: 'studio-report' }, SHORTCUTS.map((g) => h('div', { class: 'studio-report-group' },
    h('h3', { text: g.group }),
    h('div', { class: 'studio-shortcuts' }, g.items.map(([k, label]) => h('div', { class: 'studio-shortcut' }, h('span', { text: label }), h('kbd', { class: 'studio-kbd', text: k.split(' / ').map((x) => keyLabel(x)).join(' / ') })))))));
}

export function supportedFilesDialog() { return dialog({ title: 'Supported files', body: supportedTable(), width: 620 }); }
export function shortcutsDialog() { return dialog({ title: 'Keyboard shortcuts', body: shortcutsTable(), width: 620 }); }
export function aboutDialog() {
<<<<<<< HEAD
  return dialog({ title: 'About EYAD Experience', width: 460, body: h('div', { class: 'studio-stack' },
    h('p', { text: 'EYAD Experience 3.0 is Eyad Ayman’s own creative suite: EYAD IMAGE (layered photo editing, PSD), EYAD VECTOR (vector design, SVG / PDF / .ai), EYAD VIDEO (timeline editing), EYAD 3D, EYAD CAMERA (film looks) and Templates. Original design and code — it runs in the browser or installed as an app.' }),
    h('p', { class: 'studio-dim', text: 'Everything runs locally in your browser. Files you open are never uploaded; projects are stored in this browser’s storage until you download them.' }),
    h('p', { class: 'studio-dim', text: 'Inspired by professional creative tools but not affiliated with, endorsed by, or compatible-certified by Adobe. “Photoshop” and “Premiere Pro” are trademarks of Adobe Inc.; their file formats are read on a best-effort basis.' }),
    h('p', { class: 'studio-dim studio-small', text: 'Open-source parts: ag-psd, pdf.js, three.js, Paper.js, MediaPipe, ONNX Runtime, fflate, fzstd (MIT / Apache-2.0). Fonts under the SIL Open Font Licence. Licences are in studio/vendor and studio/fonts.' })) });
=======
  return dialog({ title: 'About EYAD STUDIO', width: 460, body: h('div', { class: 'studio-stack' },
    h('p', { text: 'EYAD STUDIO is Eyad Ayman’s own browser-based creative workspace: EYAD IMAGE for layered image editing and EYAD VIDEO for timeline editing.' }),
    h('p', { class: 'studio-dim', text: 'Everything runs locally in your browser. Files you open are never uploaded; projects are stored in this browser’s storage until you download them.' }),
    h('p', { class: 'studio-dim', text: 'EYAD STUDIO uses familiar professional-editor interaction patterns, but its interface, branding, icons and implementation are original and are not a visual copy of another product. It is not affiliated with or endorsed by Adobe. PSD/PSB files are parsed on a best-effort compatibility basis.' }),
    h('p', { class: 'studio-dim studio-small', text: 'PSD parsing: ag-psd (MIT licence). Fonts: Oswald, Inter, JetBrains Mono (SIL Open Font Licence).' })) });
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
}

/** Compatibility / import report. report = { title, intro, stats:[[label,value]], rows:[{status,label,detail}], actions } */
export function reportBody(report) {
  const groups = { ok: 'Supported', part: 'Partial', no: 'Unsupported' };
<<<<<<< HEAD
  const marks = { ok: '✓', part: '!', no: '×' };
=======
  const marks = { ok: '✓', part: '△', no: '×' };
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
  return h('div', { class: 'studio-report' },
    report.intro ? h('p', { class: 'studio-dim', text: report.intro }) : null,
    report.stats ? h('div', { class: 'studio-report-stats' }, report.stats.map(([l, v]) => h('div', { class: 'studio-stat' }, h('b', { text: String(v) }), h('span', { text: l })))) : null,
    Object.entries(groups).map(([k, title]) => {
      const rows = report.rows.filter((r) => r.status === k);
      if (!rows.length) return null;
      return h('div', { class: 'studio-report-group' }, h('h3', { text: title }),
<<<<<<< HEAD
        rows.map((r) => (r.detail
          // rows with details are real disclosure widgets: click / Enter / Space toggles, the chevron rotates
          ? h('details', { class: 'studio-report-row is-more ' + k, open: rows.length <= 3 || k === 'no' },
            h('summary', { class: 'studio-report-sum' }, h('span', { class: 'mk', text: marks[k] }), h('span', { class: 'lbl', text: r.label }), icon('chevronDown', 14, 'chev')),
            h('small', { text: r.detail }))
          : h('div', { class: 'studio-report-row ' + k }, h('span', { class: 'mk', text: marks[k] }), h('div', {}, h('span', { text: r.label }))))));
=======
        rows.map((r) => {
          const detail = r.detail ? h('small', { class: 'studio-report-detail', text: r.detail, hidden: true }) : null;
          const arrow = r.detail ? h('button', { class: 'studio-report-toggle', type: 'button', 'aria-expanded': 'false', 'aria-label': 'Show details', onclick: (e) => {
            e.stopPropagation();
            const open = !detail.hidden;
            detail.hidden = open;
            arrow.setAttribute('aria-expanded', String(!open));
            arrow.setAttribute('aria-label', open ? 'Show details' : 'Hide details');
          } }, h('span', { class: 'studio-report-chevron' }, '›')) : h('span', { class: 'studio-report-chevron is-empty', 'aria-hidden': 'true' }, '›');
          return h('div', { class: 'studio-report-row ' + k }, h('span', { class: 'mk', text: marks[k] }), h('div', { class: 'studio-report-main' }, h('span', { text: r.label }), detail), arrow);
        }));
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
    }));
}

export function showReport(report, buttons) {
  return dialog({ title: report.title, body: reportBody(report), width: 560, buttons: buttons || [{ label: 'Continue', value: true, primary: true }] });
}

export function psdCompatDialog() {
  return showReport({
    title: 'PSD compatibility',
    intro: 'EYAD IMAGE reads PSD files with a real parser. After each import you get a report for that specific file.',
    rows: [
      { status: 'ok', label: 'Canvas size, RGB, transparency' },
      { status: 'ok', label: 'Raster layers, names, ordering, visibility, opacity' },
      { status: 'ok', label: 'Groups (nested) and common blend modes' },
      { status: 'ok', label: 'Layer masks (pixel masks), clipping masks' },
      { status: 'ok', label: 'Guides and resolution metadata' },
<<<<<<< HEAD
      { status: 'part', label: 'Text layers', detail: 'Imported as pixels; text content is kept and can be converted to an approximate editable text layer.' },
      { status: 'part', label: 'Smart objects', detail: 'Imported as rendered pixels.' },
      { status: 'part', label: 'Adjustment layers', detail: 'Kept as named placeholders — not applied.' },
      { status: 'part', label: 'Layer styles (shadows, strokes, glows…)', detail: 'Listed in the report, not rendered.' },
=======
      { status: 'part', label: 'Text layers', detail: 'Imported as editable EYAD text when the PSD exposes usable text data; the original composite is retained as a hidden reference when fidelity may differ.' },
      { status: 'part', label: 'Smart objects', detail: 'Imported as rendered pixels.' },
      { status: 'part', label: 'Adjustment layers', detail: 'Kept as named placeholders — not applied.' },
      { status: 'part', label: 'Layer styles (shadows, strokes, glows…)', detail: 'Common shadow, glow, fill and stroke styles are reconstructed; uncommon parameters remain attached to the layer for future editing and are compared against the PSD composite.' },
>>>>>>> 7f07ded4bc629fd2a61d72f4fcdbf337594d4cc7
      { status: 'part', label: '16/32-bit, CMYK, Grayscale', detail: 'Converted to 8-bit RGB.' },
      { status: 'no', label: 'Vector masks, layer comps, 3D, video layers' },
      { status: 'part', label: 'PSD export', detail: 'Experimental: pixel layers, groups, names, opacity, blend modes and masks. Text/shapes are rasterised.' },
    ],
  }, [{ label: 'OK', value: true, primary: true }]);
}
