import { toggleTheme, resolvedTheme } from '../core/settings.js';
// EYAD VIDEO — menus (menubar, mobile menu sheet, command palette).
import * as ops from './ops.js';
import * as io from './io.js';
import { ROUTES } from '../core/shell.js';
import { EFFECTS } from './effects.js';
import { listProjects } from '../core/db.js';
import { exportVideoDialog, exportWav, exportFrame } from './export.js';
import { supportedFilesDialog, shortcutsDialog, aboutDialog } from '../core/docs.js';
import { seqDuration } from './model.js';

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
      ] },
      { separator: true },
      { label: 'Relink Media…', action: () => app.relinkDialog(), enabled: () => has() && app.project.media.some((m) => m.offline) },
      { label: 'Project Import Report', action: () => io.showImportReport(app), enabled: () => has() && !!app.importReport },
      { label: 'Rename Project…', action: () => io.renameProject(app), enabled: has },
      { label: 'Close Project', action: () => io.closeProject(app), enabled: has },
      { label: 'Back to Portfolio', action: () => { location.href = ROUTES.portfolio; } },
    ] },
    { label: 'Edit', items: [
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
      { label: 'Link', action: () => ops.link(app), enabled: () => has() && app.selection.size > 1 },
      { label: 'Unlink', action: () => ops.unlink(app), enabled: sel },
      { label: 'Enable / Disable', action: () => ops.updateClips(app, [...app.selection], (c) => ({ enabled: c.enabled === false }), 'Toggle Clip'), enabled: sel },
      { separator: true },
      { label: 'Add Fade In (1 s)', action: () => ops.updateClips(app, [...app.selection], { fadeIn: 1 }, 'Fade In'), enabled: sel },
      { label: 'Add Fade Out (1 s)', action: () => ops.updateClips(app, [...app.selection], { fadeOut: 1 }, 'Fade Out'), enabled: sel },
      { label: 'Remove Fades', action: () => ops.updateClips(app, [...app.selection], { fadeIn: 0, fadeOut: 0 }, 'Remove Fades'), enabled: sel },
      { separator: true },
      { label: 'Selection Tool', shortcut: 'V', action: () => app.timeline.setTool('select'), icon: 'cursor' },
      { label: 'Razor Tool', shortcut: 'C', action: () => app.timeline.setTool('razor'), icon: 'scissors' },
    ] },
    { label: 'Sequence', items: [
      { label: 'Sequence Settings…', action: () => ops.sequenceSettings(app), enabled: has },
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
    { label: 'Effects', items: Object.entries(EFFECTS).map(([k, d]) => ({ label: d.label, action: () => ops.addEffect(app, k), enabled: sel, icon: 'fx' })) },
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
      { label: 'Source Monitor', action: () => app.showMonitor('source') },
      { label: 'Program Monitor', action: () => app.showMonitor('program') },
      { label: 'Fullscreen Monitor', shortcut: 'F', action: () => app.fullscreenMonitor(), icon: 'fullscreen' },
    ] },
    { label: 'Window', items: [
      { label: 'Media', action: () => (app.mobile.matches ? app.sheet('media') : app.leftTabs.show('media')), icon: 'film' },
      { label: 'Effects', action: () => (app.mobile.matches ? app.sheet('effects') : app.leftTabs.show('effects')), icon: 'fx' },
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
    ] },
  ];
}
