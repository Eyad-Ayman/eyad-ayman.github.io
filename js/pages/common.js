// EYAD STUDIO — shared helpers for the hub pages (home, projects, settings, help).
import { h } from '../core/dom.js';
import { bootStudio, hubHeader, ROUTES } from '../core/shell.js';
import { putHandoff } from '../core/db.js';
import { detectFile, sanitizeFilename } from '../core/files.js';
import { peekEyad } from '../core/eyad.js';
import { toast } from '../core/ui.js';

export function page(current, ...content) {
  bootStudio();
  const body = document.body;
  const main = h('main', { class: 'studio-hub-main', id: 'main' }, ...content);
  body.replaceChildren(
    h('a', { class: 'studio-skip', href: '#main', text: 'Skip to content' }),
    hubHeader(current),
    main,
    h('footer', { class: 'studio-hub-footer' },
      h('span', { text: 'EYAD STUDIO · part of Eyad Ayman’s portfolio · files stay on this device' }),
      h('span', {}, h('a', { href: ROUTES.help, text: 'Help & supported files' }), ' · ', h('a', { href: ROUTES.portfolio, text: '← Back to portfolio' }))));
  return main;
}

/** Route arbitrary files to the right editor through an IndexedDB hand-off. */
export async function routeFiles(files) {
  const image = [], video = [], vector = [], bad = [];
  for (const f of files) {
    const info = await detectFile(f).catch(() => ({ kind: 'unknown', label: 'unreadable' }));
    if (info.format === 'svg') vector.push(f);
    else if (info.kind === 'psd' || info.kind === 'image') image.push(f);
    else if (info.kind === 'video' || info.kind === 'audio' || info.kind === 'prproj') video.push(f);
    else if (info.kind === 'eyad') { const m = await peekEyad(f); (m && m.kind === 'video' ? video : m && m.kind === 'vector' ? vector : image).push(f); }
    else bad.push(`${sanitizeFilename(f.name)} (${info.label})`);
  }
  if (bad.length) toast(`Not supported: ${bad.join(', ')}`, { type: 'warn', timeout: 6000 });
  if (image.length && video.length) toast('Opening images in EYAD IMAGE — drop the video files into EYAD VIDEO afterwards.', { timeout: 5000 });
  if (vector.length && !image.length && !video.length) { const id = await putHandoff(vector); location.href = ROUTES.vector + '?handoff=' + id; return; }
  if (vector.length) image.push(...vector);
  if (image.length) { const id = await putHandoff(image); location.href = ROUTES.image + '?handoff=' + id; return; }
  if (video.length) { const id = await putHandoff(video); location.href = ROUTES.video + '?handoff=' + id; }
}

export function bindPageDrop(label = 'Drop to open in EYAD STUDIO') {
  const overlay = h('div', { class: 'studio-drop' }, h('div', { class: 'studio-drop-label', text: label }));
  document.body.appendChild(overlay);
  let depth = 0;
  addEventListener('dragenter', (e) => { if (Array.from(e.dataTransfer?.types || []).includes('Files')) { depth++; overlay.classList.add('is-on'); } });
  addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.classList.remove('is-on'); });
  addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault(); });
  addEventListener('drop', (e) => {
    depth = 0; overlay.classList.remove('is-on');
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    routeFiles(Array.from(e.dataTransfer.files));
  });
}

export function projectUrl(p) { return (p.kind === 'video' ? ROUTES.video : p.kind === 'vector' ? ROUTES.vector : ROUTES.image) + '?project=' + encodeURIComponent(p.id); }

export function thumbImg(p) {
  const wrap = h('div', { class: 'hub-thumb is-' + p.kind });
  if (p.thumb instanceof Blob) {
    const url = URL.createObjectURL(p.thumb);
    const img = h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('load', () => setTimeout(() => URL.revokeObjectURL(url), 1000), { once: true });
    wrap.appendChild(img);
  }
  return wrap;
}
