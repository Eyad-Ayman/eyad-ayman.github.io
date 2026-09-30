// EYAD VIDEO — Collect Files (project + every media file in one folder/zip,
// like a project manager) and XML export (FCP 7 XML "xmeml") so a sequence
// can continue in other professional editors that import XML.
import { toast, formDialog, progressDialog } from '../core/ui.js';
import { downloadBlob, sanitizeFilename } from '../core/files.js';
import { formatBytes } from '../core/dom.js';
import { clipEnd, activeSeq, trackById } from './model.js';

const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const extFor = (m) => (/\.[a-z0-9]{2,5}$/i.test(m.name) ? '' : ({ video: '.mp4', audio: '.m4a', image: '.png' }[m.kind] || ''));
const fileName = (m, used) => { let n = sanitizeFilename(m.name, 'media') + extFor(m); let k = n, i = 2; while (used.has(k.toLowerCase())) k = n.replace(/(\.[^.]+)?$/, `-${i++}$1`); used.add(k.toLowerCase()); return k; };

/** Build xmeml for the active sequence. Media paths are relative to the collected Media/ folder. */
export function sequenceXML(app, names = new Map()) {
  const p = app.project, s = activeSeq(p);
  const fps = s.fps, tb = Math.round(fps), ntsc = Math.abs(fps - Math.round(fps)) > 0.001;
  const f = (sec) => Math.round(sec * fps);
  const rate = `<rate><timebase>${tb}</timebase><ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`;
  const fileDef = new Set();
  const fileXml = (m) => {
    if (!m) return '';
    const id = 'file-' + m.id;
    if (fileDef.has(id)) return `<file id="${esc(id)}"/>`;
    fileDef.add(id);
    const nm = names.get(m.id) || sanitizeFilename(m.name, 'media');
    return `<file id="${esc(id)}"><name>${esc(nm)}</name><pathurl>Media/${esc(encodeURI(nm))}</pathurl>${rate}<duration>${f(m.duration || 0)}</duration><media>${m.kind !== 'audio' ? `<video><samplecharacteristics><width>${m.width || s.width}</width><height>${m.height || s.height}</height></samplecharacteristics></video>` : ''}${m.kind !== 'image' && (m.hasAudio || m.kind === 'audio') ? '<audio><channelcount>2</channelcount></audio>' : ''}</media></file>`;
  };
  const clipXml = (c, kind) => {
    const m = p.media.find((x) => x.id === c.mediaId);
    const st = f(c.start), en = f(clipEnd(c));
    const inF = f(c.in), outF = inF + (en - st) * (c.speed || 1);
    const name = c.gen ? (c.gen.text || c.name) : c.name;
    if (c.gen) return `<generatoritem id="gen-${esc(c.id)}"><name>${esc(String(name).slice(0, 120))}</name><duration>${en - st}</duration>${rate}<start>${st}</start><end>${en}</end><in>0</in><out>${en - st}</out><effect><name>${c.gen.type === 'color' ? 'Color' : 'Text'}</name><effectid>${c.gen.type === 'color' ? 'Color' : 'Text'}</effectid><effectcategory>${c.gen.type === 'color' ? 'Matte' : 'Text'}</effectcategory><effecttype>generator</effecttype><mediatype>video</mediatype></effect></generatoritem>`;
    return `<clipitem id="clip-${esc(c.id)}-${kind}"><name>${esc(name)}</name><enabled>${c.enabled === false ? 'FALSE' : 'TRUE'}</enabled><duration>${f(m ? m.duration : 0)}</duration>${rate}<start>${st}</start><end>${en}</end><in>${inF}</in><out>${Math.round(outF)}</out>${fileXml(m)}${c.speed && c.speed !== 1 ? `<filter><effect><name>Time Remap</name><effectid>timeremap</effectid><parameter><parameterid>speed</parameterid><name>speed</name><value>${(c.speed * 100).toFixed(2)}</value></parameter></effect></filter>` : ''}</clipitem>`;
  };
  const tracks = (kind) => s.tracks.filter((t) => t.kind === kind).map((t) => {
    const clips = s.clips.filter((c) => c.trackId === t.id).sort((a, b) => a.start - b.start);
    return `<track><enabled>${t.hidden || t.mute ? 'FALSE' : 'TRUE'}</enabled><locked>${t.lock ? 'TRUE' : 'FALSE'}</locked>${clips.map((c) => clipXml(c, kind)).join('')}</track>`;
  });
  const dur = Math.max(0, ...s.clips.map((c) => f(clipEnd(c))));
  const markers = s.markers.map((mk) => `<marker><name>${esc(mk.name)}</name><in>${f(mk.time)}</in><out>-1</out></marker>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence id="seq-${esc(s.id)}"><name>${esc(s.name)}</name><duration>${dur}</duration>${rate}${markers}<media><video><format><samplecharacteristics><width>${s.width}</width><height>${s.height}</height>${rate}</samplecharacteristics></format>${tracks('video').join('')}</video><audio>${tracks('audio').join('')}</audio></media></sequence></xmeml>\n`;
}

export async function exportXML(app) {
  if (!app.project) return;
  const used = new Set(), names = new Map();
  for (const m of app.project.media) names.set(m.id, fileName(m, used));
  downloadBlob(new Blob([sequenceXML(app, names)], { type: 'application/xml' }), sanitizeFilename(activeSeq(app.project).name || app.project.name) + '.xml');
  toast('XML exported. Keep it next to a “Media” folder with the clips (use Collect Files to get both at once).', { type: 'ok', timeout: 7000 });
}

/** Collect Files: project (.eyad, without embedded media), every media file, XML and a report — one zip. */
export async function collectFiles(app) {
  if (!app.project) return;
  const p = app.project;
  const online = p.media.filter((m) => app.media.online(m.id));
  const missing = p.media.filter((m) => !app.media.online(m.id));
  const total = online.reduce((a, m) => a + (m.size || 0), 0);
  const v = await formDialog({ title: 'Collect Files', ok: 'Collect', fields: [
    { type: 'note', label: `Packs the project, ${online.length} media file(s) (${formatBytes(total)}), an XML of the sequence and a report into one .zip — ready to archive, share or move to another computer.${missing.length ? ` ${missing.length} offline file(s) will be listed in the report.` : ''}` },
    { key: 'xml', label: 'Include XML for other editors', type: 'checkbox', value: true },
  ] });
  if (!v) return;
  if (total > 1.8e9) { toast('That is too much media to zip in the browser (limit about 1.8 GB). Download the .eyad with media instead.', { type: 'error', timeout: 8000 }); return; }
  const prog = progressDialog('Collecting files', { cancellable: false });
  try {
    const { zipSync } = await import('../../vendor/fflate/fflate.js');
    const { buildEyad } = await import('./io.js');
    const base = sanitizeFilename(p.name, 'Project');
    const entries = {};
    const used = new Set(), names = new Map();
    let i = 0;
    for (const m of online) {
      prog.set(i / Math.max(1, online.length), 'Media: ' + m.name);
      const r = app.media.rt.get(m.id);
      let blob = r && r.blob;
      if (!blob && r && r.url) { try { blob = await (await fetch(r.url)).blob(); } catch (e) { blob = null; } }
      if (!blob) { missing.push(m); continue; }
      const nm = fileName(m, used); names.set(m.id, nm);
      entries[`${base}/Media/${nm}`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
      i++;
    }
    prog.set(null, 'Project file…');
    const { blob: eyad } = await buildEyad(app, { embedMedia: false });
    entries[`${base}/${base}.eyad`] = [new Uint8Array(await eyad.arrayBuffer()), { level: 0 }];
    if (v.xml) entries[`${base}/${base}.xml`] = [new TextEncoder().encode(sequenceXML(app, names)), {}];
    const report = [`EYAD VIDEO — Collect Files report`, `Project: ${p.name}`, `Collected: ${new Date().toISOString()}`, '', `Media collected (${names.size}):`, ...[...names.values()].map((n) => '  Media/' + n),
      '', missing.length ? `Offline / not collected (${missing.length}):` : 'Nothing missing.', ...missing.map((m) => '  ' + m.name + (m.originalPath ? ' (' + m.originalPath + ')' : '')),
      '', 'Open the .eyad in EYAD VIDEO, then File ▸ Relink Media and pick the files in Media/ (they are matched by name).', v.xml ? 'The .xml opens in editors that import FCP 7 XML (File ▸ Import); keep it next to the Media folder.' : ''];
    entries[`${base}/Collect report.txt`] = [new TextEncoder().encode(report.join('\n')), {}];
    prog.set(null, 'Zipping…');
    downloadBlob(new Blob([zipSync(entries)], { type: 'application/zip' }), base + ' (collected).zip');
    toast(`Collected ${names.size} media file(s)${missing.length ? `, ${missing.length} offline` : ''}.`, { type: 'ok' });
  } catch (e) { toast('Collect Files failed: ' + e.message, { type: 'error' }); }
  finally { prog.close(); }
}
export { trackById };
