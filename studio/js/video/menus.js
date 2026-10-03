import { experienceHelp } from '../core/experience.js';
import { toggleTheme, resolvedTheme } from '../core/settings.js';
// EYAD VIDEO — menus (menubar, mobile menu sheet, command palette).
import * as ops from './ops.js';
import * as io from './io.js';
import { ROUTES, goPortfolio } from '../core/shell.js';
import { EFFECTS, TRANSITIONS, LOOK_PRESETS, MASK_MODES } from './effects.js';
import { GEN_TEMPLATES, TEXT_STYLES } from './gen.js';
import { PRESETS } from './anim.js';
import { linkMediaDialog, linkLocalFiles, canLinkLocal } from './link.js';
import { importCaptions, exportCaptions, detectScenes } from './captions.js';
import { listProjects } from '../core/db.js';
// export.js is loaded on first use (keeps the first open light)
const lazyExport = (fn) => (app) => import('./export.js').then((m) => m[fn](app));
const exportVideoDialog = lazyExport('exportVideoDialog'), exportWav = lazyExport('exportWav'), exportFrame = lazyExport('exportFrame');
import { supportedFilesDialog, shortcutsDialog, aboutDialog } from '../core/docs.js';
import { seqDuration } from './model.js';

function groupEffects() {
  const g = {};
  for (const [k, d] of Object.entries(EFFECTS)) (g[d.group] = g[d.group] || []).push([k, d]);
  return g;
}

export function buildMenus(app) {
  const has = () => !!app.project;
  const sel = () => has() && app.selection.size > 0;
  let recent = [];
  const refresh = () => listProjects().then((l) => { recent = l.filter((p) => p.kind === 'video').slice(0, 8); }).catch(() => {});
  refresh(); setInterval(refresh, 15000);
  return [
    { label: 'File', items: [
      { label: 'New Project…', shortcut: 'Mod+N', action: () => io.newProject(app), icon: 'plus' },
      { label: 'Open Project… (.eyad / .prproj)', shortcut: 'Mod+O', action: () => io.openDialog(app), icon: 'folder' },
      { label: 'Open Recent', submenu: () => (recent.length ? recent.map((p) => ({ label: p.name, action: () => io.openProject(app, p.id) })) : [{ label: 'No recent video projects', enabled: false }]).concat([{ separator: true }, { label: 'Browse Projects…', action: () => { location.href = ROUTES.projects; } }]) },
      { label: 'Import Media…', shortcut: 'Mod+I', action: () => app.importDialog(), icon: 'upload' },
      { label: 'Add Media from Link (Drive, Dropbox, URL)…', shortcut: 'Mod+U', action: () => linkMediaDialog(app), icon: 'cloud' },
      { label: 'Link Large Files from Disk (no copy)…', action: () => linkLocalFiles(app), enabled: canLinkLocal, icon: 'hdd' },
      { label: 'Import Captions (SRT / VTT)…', action: () => importCaptions(app), icon: 'captions' },
      { label: 'Import Premiere Project (.prproj)…', action: () => io.openDialog(app, 'prproj') },
      { separator: true },
      { label: 'Save', shortcut: 'Mod+S', action: () => io.save(app), enabled: has, icon: 'save' },
      { label: 'Save As…', shortcut: 'Mod+Shift+S', action: () => io.saveAs(app), enabled: has },
      { label: 'Download .eyad Project…', action: () => io.downloadEyad(app), enabled: has, icon: 'download' },
      { separator: true },
      { label: 'Export', submenu: [
        { label: 'Video (real-time render)…', shortcut: 'Mod+M', action: () => exportVideoDialog(app), enabled: has },
        { label: 'Audio Mixdown (WAV)', action: () => exportWav(app), enabled: has },
        { label: 'Current Frame (PNG)', action: () => exportFrame(app), enabled: has },
        { label: 'XML for Other Editors (FCP 7 XML)…', action: () => import('./collect.js').then((m) => m.exportXML(app)), enabled: has },
        { label: 'Captions (SRT)', action: () => exportCaptions(app, 'srt'), enabled: has },
        { label: 'Captions (WebVTT)', action: () => exportCaptions(app, 'vtt'), enabled: has },
      ] },
      { separator: true },
      { label: 'Collect Files (project + media, .zip)…', action: () => import('./collect.js').then((m) => m.collectFiles(app)), enabled: has, icon: 'folder' },
      { label: 'Relink Media…', action: () => app.relinkDialog(), enabled: () => has() && app.project.media.some((m) => m.offline) },
      { label: 'Project Import Report', action: () => io.showImportReport(app), enabled: () => has() && !!app.importReport },
      { label: 'Rename Project…', action: () => io.renameProject(app), enabled: has },
      { label: 'Close Project', action: () => io.closeProject(app), enabled: has },
      { label: 'Back to Portfolio', action: () => goPortfolio() },
    ] },
    { label: 'Edit', items: [
      { label: 'Fonts… (add from device / Google Fonts)', action: () => import('../core/fonts.js').then((m) => m.fontManagerDialog()), icon: 'text' },
      { separator: true },
      { label: () => (app.history.canUndo ? 'Undo ' + app.history.stack[app.history.index].label : 'Undo'), shortcut: 'Mod+Z', action: () => app.undo(), enabled: () => app.history.canUndo, icon: 'undo' },
      { label: () => (app.history.canRedo ? 'Redo ' + app.history.stack[app.history.index + 1].label : 'Redo'), shortcut: 'Mod+Shift+Z', action: () => app.redo(), enabled: () => app.history.canRedo, icon: 'redo' },
      { separator: true },
      { label: 'Cut', shortcut: 'Mod+X', action: () => app.copyClips(true), enabled: sel },
      { label: 'Copy', shortcut: 'Mod+C', action: () => app.copyClips(), enabled: sel },
      { label: 'Paste at Playhead', shortcut: 'Mod+V', action: () => app.pasteClips(), enabled: () => has() && !!app.clipboard },
      { label: 'Duplicate', shortcut: 'Mod+D', action: () => ops.duplicateSelected(app), enabled: sel },
      { label: 'Delete', shortcut: 'Delete', action: () => ops.deleteSelected(app), enabled: sel },
      { label: 'Ripple Delete', shortcut: 'Shift+Delete', action: () => ops.deleteSelected(app, { ripple: true }), enabled: sel },
      { separator: true },
      { label: 'Select All', shortcut: 'Mod+A', action: () => app.select(app.seq.clips.map((c) => c.id)), enabled: has },
      { label: 'Deselect All', shortcut: 'Mod+Shift+A', action: () => app.select([]), enabled: has },
      { separator: true },
      { label: 'Preferences…', action: () => { location.href = ROUTES.settings; }, icon: 'gear' },
    ] },
    { label: 'Clip', items: [
      { label: 'Split at Playhead', shortcut: 'S', action: () => ops.splitAtPlayhead(app), enabled: has, icon: 'split' },
      { label: 'Speed / Duration…', shortcut: 'Mod+R', action: () => ops.speedDialog(app), enabled: sel },
      { label: 'Speed Presets', submenu: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4, 8].map((sp) => ({ label: Math.round(sp * 100) + '%', action: () => ops.setSpeed(app, sp), enabled: sel })) },
      { label: 'Freeze Frame (2 s)', action: () => ops.freezeFrame(app), enabled: has },
      { label: 'Scene Edit Detection…', action: () => detectScenes(app), enabled: sel, icon: 'scope' },
      { label: 'Nudge Left 1 Frame', shortcut: 'Alt+ArrowLeft', action: () => ops.nudge(app, -1), enabled: sel },
      { label: 'Nudge Right 1 Frame', shortcut: 'Alt+ArrowRight', action: () => ops.nudge(app, 1), enabled: sel },
      { label: 'Link', action: () => ops.link(app), enabled: () => has() && app.selection.size > 1 },
      { label: 'Unlink', action: () => ops.unlink(app), enabled: sel },
      { label: 'Enable / Disable', action: () => ops.updateClips(app, [...app.selection], (c) => ({ enabled: c.enabled === false }), 'Toggle Clip'), enabled: sel },
      { separator: true },
      { label: 'Add Fade In (1 s)', action: () => ops.updateClips(app, [...app.selection], { fadeIn: 1 }, 'Fade In'), enabled: sel },
      { label: 'Add Fade Out (1 s)', action: () => ops.updateClips(app, [...app.selection], { fadeOut: 1 }, 'Fade Out'), enabled: sel },
      { label: 'Remove Fades', action: () => ops.updateClips(app, [...app.selection], { fadeIn: 0, fadeOut: 0 }, 'Remove Fades'), enabled: sel },
      { separator: true },
      { label: 'Ripple Trim Previous Edit to Playhead', shortcut: 'Q', action: () => ops.rippleTrim(app, 'start'), enabled: has },
      { label: 'Ripple Trim Next Edit to Playhead', shortcut: 'W', action: () => ops.rippleTrim(app, 'end'), enabled: has },
      { label: 'Track Select Forward', shortcut: 'A', action: () => ops.selectForward(app, true), enabled: has },
      { separator: true },
      { label: 'Selection Tool', shortcut: 'V', action: () => app.timeline.setTool('select'), icon: 'cursor' },
      { label: 'Razor Tool', shortcut: 'C', action: () => app.timeline.setTool('razor'), icon: 'scissors' },
    ] },
    { label: 'Sequence', items: [
      { label: 'Sequence Settings…', action: () => ops.sequenceSettings(app), enabled: has },
      { label: 'Aspect Ratio', submenu: ops.ASPECTS.map(([l, w, hh]) => ({ label: `${l}  (${w} × ${hh})`, checked: () => !!app.seq && app.seq.width === w && app.seq.height === hh, action: () => ops.setAspect(app, w, hh), enabled: has })) },
      { label: 'Switch Sequence', submenu: () => (app.project ? app.project.sequences.map((s) => ({ label: s.name, checked: () => s.id === app.project.activeSeq, action: () => io.switchSequence(app, s.id) })) : []) },
      { label: 'New Sequence', action: () => io.newSequence(app), enabled: has },
      { separator: true },
      { label: 'Mark In', shortcut: 'I', action: () => ops.setIn(app), enabled: has },
      { label: 'Mark Out', shortcut: 'O', action: () => ops.setOut(app), enabled: has },
      { label: 'Clear In and Out', shortcut: 'Alt+X', action: () => ops.clearInOut(app), enabled: has },
      { label: 'Add Marker', shortcut: 'M', action: () => ops.addMarker(app), enabled: has, icon: 'marker' },
      { label: 'Next Marker', shortcut: 'Shift+M', action: () => ops.jumpMarker(app, 1), enabled: has },
      { separator: true },
      { label: 'Add Video Track', action: () => ops.addTrack(app, 'video'), enabled: has },
      { label: 'Add Audio Track', action: () => ops.addTrack(app, 'audio'), enabled: has },
      { label: () => (app.timeline.snap ? 'Snapping: On' : 'Snapping: Off'), action: () => app.timeline.snapBtn.click(), icon: 'magnet' },
    ] },
    { label: 'Graphics', items: [
      ...Object.entries(GEN_TEMPLATES).map(([k, t]) => ({ label: 'New ' + t.label, shortcut: k === 'title' ? 'T' : k === 'lower' ? 'Shift+T' : undefined, action: () => ops.addGenerated(app, k), enabled: has, icon: t.gen.type === 'color' ? 'image' : t.gen.type === 'shape' ? 'rect' : t.gen.type === 'adjust' ? 'layers' : 'title' })),
      { separator: true },
      { label: 'Text Styles', submenu: Object.entries(TEXT_STYLES).map(([k, st]) => ({ label: st.label, action: () => ops.applyTextStyle(app, k), enabled: has })) },
      { separator: true },
      { label: 'Import Captions (SRT / VTT)…', action: () => importCaptions(app), icon: 'captions' },
      { label: 'Export Captions (SRT)', action: () => exportCaptions(app, 'srt'), enabled: has },
    ] },
    { label: 'Effects', items: [
      { label: 'Apply Default Transition', shortcut: 'Shift+D', action: () => ops.applyTransition(app, 'dissolve'), enabled: has, icon: 'transition' },
      { label: 'Video Transitions', submenu: Object.entries(TRANSITIONS).map(([k, t]) => ({ label: t.label, action: () => ops.applyTransition(app, k), enabled: has })) },
      { label: 'Apply Transition to All Cuts', submenu: Object.entries(TRANSITIONS).map(([k, t]) => ({ label: t.label, action: () => ops.applyTransitionAll(app, k), enabled: has })) },
      { label: 'Remove Transitions', action: () => ops.removeTransitions(app), enabled: sel },
      { separator: true },
      { label: 'Ready Looks', submenu: [...Object.entries(LOOK_PRESETS).map(([k, l]) => ({ label: l.label, action: () => ops.applyLook(app, k), enabled: sel })), { separator: true }, { label: 'Remove Look', action: () => ops.clearLook(app), enabled: sel }] },
      { label: 'Film Looks (136)…', action: () => { ops.setFilmLook(app, null); app.showEffects('film'); }, enabled: sel, icon: 'film' },
      { label: 'Auto Mask (AI people)', icon: 'mask', submenu: MASK_MODES.map((m, i) => ({ label: m, action: () => ops.addAutoMask(app, i), enabled: sel })) },
      { separator: true },
      { label: 'Animation Presets', submenu: Object.entries(PRESETS).map(([k, p]) => ({ label: p.label, action: () => ops.applyPreset(app, k), enabled: sel })) },
      { label: 'Remove All Keyframes', action: () => ops.clearKeys(app), enabled: sel },
      { label: 'Next Keyframe', shortcut: 'Shift+K', action: () => ops.jumpKey(app, 1), enabled: sel },
      { label: 'Previous Keyframe', shortcut: 'Alt+K', action: () => ops.jumpKey(app, -1), enabled: sel },
      { separator: true },
      ...Object.entries(groupEffects()).map(([g, list]) => ({ label: g, submenu: list.map(([k, d]) => ({ label: d.label, action: () => ops.addEffect(app, k), enabled: sel })) })),
    ] },
    { label: 'View', items: [
      { label: 'Play / Pause', shortcut: 'Space', action: () => app.engine.toggle(), enabled: has, icon: 'play' },
      { label: 'Go to Start', shortcut: 'Home', action: () => app.engine.seek(0), enabled: has },
      { label: 'Go to End', shortcut: 'End', action: () => app.engine.seek(seqDuration(app.seq)), enabled: has },
      { label: 'Loop Playback', checked: () => app.engine.loop, action: () => app.loopBtn.click() },
      { separator: true },
      { label: 'Zoom Timeline In', shortcut: '=', action: () => app.timeline.zoomBy(1.5), enabled: has, icon: 'zoomIn' },
      { label: 'Zoom Timeline Out', shortcut: '-', action: () => app.timeline.zoomBy(1 / 1.5), enabled: has, icon: 'zoomOut' },
      { label: 'Zoom to Sequence', shortcut: '\\', action: () => app.timeline.fit(), enabled: has },
      { separator: true },
      { label: 'Monitor Zoom', submenu: [['fit', 'Fit'], [0.25, '25%'], [0.5, '50%'], [1, '100%'], [2, '200%'], [4, '400%']].map(([z, l]) => ({ label: l, checked: () => app.monZoom === z, action: () => app.setMonitorZoom(z) })) },
      { label: 'Zoom Monitor In', shortcut: 'Shift+Plus', action: () => app.zoomMonitorBy(1.25), enabled: has },
      { label: 'Zoom Monitor Out', shortcut: 'Shift+_', action: () => app.zoomMonitorBy(0.8), enabled: has },
      { label: 'Safe Margins', shortcut: "'", checked: () => !app.safeEl.hidden, action: () => app.toggleSafe() },
      { separator: true },
      { label: 'Source Monitor', action: () => app.showMonitor('source') },
      { label: 'Program Monitor', action: () => app.showMonitor('program') },
      { label: 'Fullscreen Monitor', shortcut: 'F', action: () => app.fullscreenMonitor(), icon: 'fullscreen' },
    ] },
    { label: 'Window', items: [
      { label: 'Media', action: () => (app.mobile.matches ? app.sheet('media') : app.leftTabs.show('media')), icon: 'film' },
      { label: 'Effects', action: () => app.showEffects(), icon: 'fx' },
      { label: 'Titles & Graphics', action: () => app.showEffects('gen'), icon: 'title' },
      { label: 'Text Styles', action: () => app.showEffects('textstyles'), icon: 'text' },
      { label: 'Ready Looks', action: () => app.showEffects('looks'), icon: 'sparkle' },
      { label: 'Transitions', action: () => app.showEffects('transitions'), icon: 'transition' },
      { label: 'Audio Mixer', action: () => (app.mobile.matches ? app.sheet('audio') : app.leftTabs.show('audio')), icon: 'volume' },
      { label: 'Properties', action: () => app.showProperties(), icon: 'sliders' },
      { separator: true },
      { label: () => (resolvedTheme() === 'dark' ? 'Light Theme' : 'Dark Theme'), action: () => toggleTheme(), icon: 'brightness' },
      { label: 'Command Palette', shortcut: 'Mod+K', action: () => app.palette.show(), icon: 'command' },
      { label: 'Go to EYAD IMAGE', action: () => { location.href = ROUTES.image; }, icon: 'image' },
      { label: 'Go to Projects', action: () => { location.href = ROUTES.projects; }, icon: 'folder' },
    ] },
    { label: 'Help', items: [
      { label: 'Supported Files', action: () => supportedFilesDialog() },
      { label: 'Keyboard Shortcuts', action: () => shortcutsDialog() },
      { label: 'Premiere Project Compatibility', action: () => io.prprojInfoDialog() },
      { label: 'Studio Documentation', action: () => { location.href = ROUTES.help; } },
      { separator: true },
      { label: 'About EYAD STUDIO', action: () => aboutDialog() },
      ...experienceHelp('video'),
    ] },
  ];
}
