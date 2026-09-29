// EYAD STUDIO — "Open" source chooser: Files / Photos / Camera / Cloud / Recent.
// Every tile opens its picker straight from the tap, which iOS requires.
import { h } from './dom.js';
import { icon } from './icons.js';
import { dialog } from './ui.js';
import { pickFiles, IS_IOS, IS_TOUCH } from './files.js';
import { ROUTES } from './shell.js';

/**
 * chooseFiles({ title, accept, multiple, media: 'image'|'video'|'any',
 *               camera: bool, extras: [{ icon, label, sub, run: () => Promise<File[]|null> }] })
 * Resolves with File[] (possibly empty).
 */
export function chooseFiles({ title = 'Open', accept = '', multiple = true, media = 'any', camera = true, extras = [], recent = true } = {}) {
  let closeFn = null;
  let result = [];
  const tile = (ic, label, sub, run, primary = false) => h('button', {
    class: 'studio-open-tile' + (primary ? ' is-primary' : ''), type: 'button',
    onclick: async () => {
      const r = await run();
      if (r === undefined) return; // tile handled itself (keeps dialog open)
      result = r || [];
      closeFn && closeFn(true);
    },
  }, h('span', { class: 'studio-open-icon' }, icon(ic, 22)),
  h('span', { class: 'studio-open-text' }, h('strong', { text: label }), h('span', { text: sub })));

  const tiles = [
    tile('folder', IS_IOS ? 'Files' : 'Browse files',
      IS_IOS ? 'iCloud Drive, On My iPhone, Downloads, any file' : 'Choose from this device (or drop files anywhere)',
      () => pickFiles({ accept, multiple }), true),
  ];
  if (IS_TOUCH || IS_IOS) {
    tiles.push(tile('image', 'Photos', media === 'video' ? 'Videos from your library' : media === 'image' ? 'Images from your library' : 'Images and videos from your library',
      () => pickFiles({ multiple, source: 'photos', media })));
    if (camera) tiles.push(tile('camera', 'Camera', media === 'video' ? 'Record a video' : 'Take a photo', () => pickFiles({ source: 'camera', media: media === 'video' ? 'video' : 'image' })));
  }
  for (const x of extras) tiles.push(tile(x.icon || 'link', x.label, x.sub || '', x.run));
  if (recent) tiles.push(tile('clock', 'Recent projects', 'Saved in this browser', () => { location.href = ROUTES.projects; return null; }));

  const body = h('div', { class: 'studio-open' },
    h('div', { class: 'studio-open-grid' }, tiles),
    h('p', { class: 'studio-dim studio-small', text: 'Files are opened on this device. Nothing is uploaded.' }));
  return dialog({ title, body, buttons: [], width: 560, className: 'studio-open-dialog', onOpen: ({ close }) => { closeFn = close; } })
    .then(() => result);
}
