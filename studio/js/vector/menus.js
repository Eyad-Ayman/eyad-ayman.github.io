import { experienceHelp } from '../core/experience.js';
// EYAD VECTOR — menus (menubar, phone menu sheet, command palette).
import { toggleTheme, resolvedTheme } from '../core/settings.js';
import { ROUTES, goPortfolio } from '../core/shell.js';
import { shortcutsDialog, aboutDialog, supportedFilesDialog } from '../core/docs.js';
import * as io from './io.js';

export function buildMenus(app) {
  const has = () => app.sel.size > 0;
  const c = (name, arg) => () => app.cmd(name, arg);
  return [
    { label: 'File', items: [
      { label: 'New…', shortcut: 'Mod+N', action: () => io.newDocDialog(app), icon: 'plus' },
      { label: 'Open… (.eyad / .svg)', shortcut: 'Mod+O', action: () => io.openDialog(app), icon: 'folder' },
      { label: 'Place Image / SVG…', shortcut: 'Mod+Shift+P', action: () => io.placeImage(app), icon: 'image' },
      { separator: true },
      { label: 'Save', shortcut: 'Mod+S', action: () => io.save(app), icon: 'save' },
      { label: 'Save As…', shortcut: 'Mod+Shift+S', action: () => io.saveAs(app) },
      { label: 'Download .eyad Project', action: () => io.downloadEyad(app), icon: 'download' },
      { separator: true },
      { label: 'Export', submenu: [
        { label: 'Export As… (SVG / PNG / WebP / PDF)', shortcut: 'Mod+Alt+Shift+E', action: () => io.exportDialog(app) },
        { label: 'Quick Export SVG', action: () => io.quickExport(app, 'svg') },
        { label: 'Quick Export PNG (2×)', action: () => io.quickExport(app, 'png') },
        { label: 'Quick Export PDF', action: () => io.quickExport(app, 'pdf') },
      ] },
      { label: 'Send to EYAD VIDEO', action: () => io.sendTo(app, 'video'), icon: 'video' },
      { label: 'Open in EYAD IMAGE', action: () => io.sendTo(app, 'image'), icon: 'image' },
      { separator: true },
      { label: 'Rename Document…', action: () => io.renameDoc(app) },
      { label: 'Back to Portfolio', action: () => goPortfolio() },
    ] },
    { label: 'Edit', items: [
      { label: 'Fonts… (add from device / Google Fonts)', action: () => import('../core/fonts.js').then((m) => m.fontManagerDialog()), icon: 'text' },
      { separator: true },
      { label: () => 'Undo' + (app.undoStack.length ? ' ' + app.undoStack[app.undoStack.length - 1].label : ''), shortcut: 'Mod+Z', action: () => app.undo(), enabled: () => app.undoStack.length > 0, icon: 'undo' },
      { label: () => 'Redo' + (app.redoStack.length ? ' ' + app.redoStack[app.redoStack.length - 1].label : ''), shortcut: 'Mod+Shift+Z', action: () => app.redo(), enabled: () => app.redoStack.length > 0, icon: 'redo' },
      { separator: true },
      { label: 'Cut', shortcut: 'Mod+X', action: c('cut'), enabled: has },
      { label: 'Copy', shortcut: 'Mod+C', action: c('copy'), enabled: has },
      { label: 'Paste', shortcut: 'Mod+V', action: c('paste'), enabled: () => !!app.clipboard },
      { label: 'Paste in Front', shortcut: 'Mod+F', action: c('pasteFront'), enabled: () => !!app.clipboard },
      { label: 'Paste in Back', shortcut: 'Mod+B', action: c('pasteBack'), enabled: () => !!app.clipboard },
      { label: 'Duplicate', shortcut: 'Mod+D', action: () => app.duplicateSelection(), enabled: has },
      { label: 'Delete', shortcut: 'Delete', action: c('delete'), enabled: has },
      { separator: true },
      { label: 'Preferences…', action: () => { location.href = ROUTES.settings; }, icon: 'gear' },
    ] },
    { label: 'Object', items: [
      { label: 'Transform', submenu: [
        { label: 'Move…', action: c('transformDialog', 'move'), enabled: has },
        { label: 'Rotate…', action: c('transformDialog', 'rotate'), enabled: has },
        { label: 'Scale…', action: c('transformDialog', 'scale'), enabled: has },
        { label: 'Reflect Horizontal', action: c('reflect', 'h'), enabled: has },
        { label: 'Reflect Vertical', action: c('reflect', 'v'), enabled: has },
      ] },
      { label: 'Arrange', submenu: [
        { label: 'Bring to Front', shortcut: 'Mod+Shift+]', action: c('arrange', 'top'), enabled: has },
        { label: 'Bring Forward', shortcut: 'Mod+]', action: c('arrange', 'up'), enabled: has },
        { label: 'Send Backward', shortcut: 'Mod+[', action: c('arrange', 'down'), enabled: has },
        { label: 'Send to Back', shortcut: 'Mod+Shift+[', action: c('arrange', 'bottom'), enabled: has },
      ] },
      { separator: true },
      { label: 'Group', shortcut: 'Mod+G', action: c('group'), enabled: has },
      { label: 'Ungroup', shortcut: 'Mod+Shift+G', action: c('ungroup'), enabled: has },
      { label: 'Lock Selection', shortcut: 'Mod+2', action: c('lock'), enabled: has },
      { label: 'Unlock All', shortcut: 'Mod+Alt+2', action: c('unlockAll') },
      { label: 'Hide Selection', shortcut: 'Mod+3', action: c('hide'), enabled: has },
      { label: 'Show All', shortcut: 'Mod+Alt+3', action: c('showAll') },
      { separator: true },
      { label: 'Path', submenu: [
        { label: 'Join / Close', shortcut: 'Mod+J', action: c('join'), enabled: has },
        { label: 'Outline Stroke', shortcut: 'Mod+Shift+O', action: c('outlineStroke'), enabled: has },
        { label: 'Simplify', action: c('simplify', 2.5), enabled: has },
        { label: 'Reverse Direction', action: c('reverse'), enabled: has },
      ] },
      { label: 'Compound Path', submenu: [
        { label: 'Make', shortcut: 'Mod+8', action: c('makeCompound'), enabled: has },
        { label: 'Release', shortcut: 'Mod+Alt+Shift+8', action: c('releaseCompound'), enabled: has },
      ] },
      { label: 'Shape Builder', submenu: [
        { label: 'Unite', action: c('pathfinder', 'unite'), enabled: has, icon: 'union' },
        { label: 'Minus Front', action: c('pathfinder', 'subtract'), enabled: has, icon: 'subtract' },
        { label: 'Intersect', action: c('pathfinder', 'intersect'), enabled: has, icon: 'intersect' },
        { label: 'Exclude', action: c('pathfinder', 'exclude'), enabled: has, icon: 'exclude' },
        { label: 'Divide', action: c('pathfinder', 'divide'), enabled: has, icon: 'divide' },
      ] },
      { label: 'Align', submenu: [
        { label: 'Left', action: c('align', 'left'), enabled: has }, { label: 'Horizontal Centre', action: c('align', 'hcenter'), enabled: has }, { label: 'Right', action: c('align', 'right'), enabled: has },
        { label: 'Top', action: c('align', 'top'), enabled: has }, { label: 'Vertical Centre', action: c('align', 'vcenter'), enabled: has }, { label: 'Bottom', action: c('align', 'bottom'), enabled: has },
        { separator: true }, { label: 'Distribute Horizontally', action: c('distribute', 'h'), enabled: has }, { label: 'Distribute Vertically', action: c('distribute', 'v'), enabled: has },
      ] },
    ] },
    { label: 'Select', items: [
      { label: 'All', shortcut: 'Mod+A', action: c('selectAll') },
      { label: 'Deselect', shortcut: 'Mod+Shift+A', action: c('deselect'), enabled: has },
      { label: 'Inverse', action: c('selectInverse') },
      { separator: true },
      { label: 'Same Fill Colour', action: c('selectSameFill'), enabled: has },
      { label: 'Same Stroke Colour', action: c('selectSameStroke'), enabled: has },
    ] },
    { label: 'View', items: [
      { label: 'Zoom In', shortcut: 'Mod+=', action: () => app.view.zoomAt(1.25), icon: 'zoomIn' },
      { label: 'Zoom Out', shortcut: 'Mod+-', action: () => app.view.zoomAt(0.8), icon: 'zoomOut' },
      { label: 'Fit Artboard', shortcut: 'Mod+0', action: () => app.view.fitArtboard() },
      { label: 'Fit All', shortcut: 'Mod+Alt+0', action: () => app.view.fitAll() },
      { label: 'Actual Size', shortcut: 'Mod+1', action: () => app.view.zoomAt(1 / app.view.zoom) },
      { separator: true },
      { label: 'Outline Mode', shortcut: 'Mod+Y', checked: () => app.outline, action: () => { app.outline = !app.outline; app.render(); } },
      { label: 'Smart Guides', shortcut: 'Mod+U', checked: () => app.smartGuides, action: () => { app.smartGuides = !app.smartGuides; } },
      { label: 'Grid', shortcut: "Mod+'", checked: () => app.showGrid, action: () => { app.showGrid = !app.showGrid; app.drawGrid(); } },
      { label: 'Snap to Grid', shortcut: "Mod+Shift+'", checked: () => app.snapGrid, action: () => { app.snapGrid = !app.snapGrid; } },
      { label: 'Fullscreen', shortcut: 'F', action: () => { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {}); }, icon: 'fullscreen' },
    ] },
    { label: 'Window', items: [
      { label: 'Appearance', action: () => app.panels.focus('appearance'), icon: 'palette' },
      { label: 'Character', action: () => app.panels.focus('character'), icon: 'text' },
      { label: 'Align & Transform', action: () => app.panels.focus('align'), icon: 'alignCenter' },
      { label: 'Shape Builder', action: () => app.panels.focus('pathfinder'), icon: 'union' },
      { label: 'Layers', action: () => app.panels.focus('layers'), icon: 'layers' },
      { label: 'Artboards', action: () => app.panels.focus('artboards'), icon: 'artboard' },
      { label: 'Hide Panels', shortcut: 'Tab', action: () => app.root.classList.toggle('is-panels-hidden') },
      { separator: true },
      { label: () => (resolvedTheme() === 'dark' ? 'Light Theme' : 'Dark Theme'), action: () => toggleTheme(), icon: 'brightness' },
      { label: 'Command Palette', shortcut: 'Mod+K', action: () => app.palette.show(), icon: 'command' },
      { label: 'Go to EYAD IMAGE', shortcut: 'Mod+Alt+1', action: () => { location.href = ROUTES.image; }, icon: 'image' },
      { label: 'Go to EYAD VIDEO', shortcut: 'Mod+Alt+3', action: () => { location.href = ROUTES.video; }, icon: 'video' },
      { label: 'Go to Projects', action: () => { location.href = ROUTES.projects; }, icon: 'folder' },
    ] },
    { label: 'Help', items: [
      { label: 'Supported Files', action: () => supportedFilesDialog() },
      { label: 'Keyboard Shortcuts', action: () => shortcutsDialog('vector') },
      { label: 'Studio Documentation', action: () => { location.href = ROUTES.help; } },
      { separator: true },
      { label: 'About EYAD STUDIO', action: () => aboutDialog() },
      ...experienceHelp('vector'),
    ] },
  ];
}
