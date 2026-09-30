// EYAD Studio V4 — fast, non-destructive creative effects.
import { makeNode } from './doc.js';
import { toast } from '../core/ui.js';

function source(app) {
  const n = app.active;
  if (!n || n.type !== 'raster' || !n.canvas) {
    toast('Select a raster layer for this effect.', {type:'warn'});
    return null;
  }
  return n;
}
function addLayer(app, canvas, name, opacity=1, blend='screen') {
  const n=makeNode('raster',{name,canvas});
  n.opacity=opacity; n.blend=blend;
  app.insertNode(n,name);
  return n;
}
export function glow(app, strength=0.7) {
  const n=source(app); if(!n)return;
  const src=n.canvas, c=document.createElement('canvas'); c.width=src.width;c.height=src.height;
  const g=c.getContext('2d'); g.imageSmoothingQuality='high';
  g.globalAlpha=1; g.drawImage(src,0,0);
  const blur=document.createElement('canvas'); blur.width=src.width;blur.height=src.height;
  const b=blur.getContext('2d'); b.filter=`blur(${Math.max(8,Math.round(Math.min(src.width,src.height)*.012))}px)`;
  b.drawImage(src,0,0);
  g.globalAlpha=Math.min(1,strength); g.globalCompositeOperation='screen'; g.filter='none'; g.drawImage(blur,0,0);
  addLayer(app,c,'Glow — Bloom',.8,'screen');
  toast('Glow / bloom added as a separate layer.',{type:'ok'});
}
export function flashBloom(app) {
  const n=source(app); if(!n)return;
  const src=n.canvas, c=document.createElement('canvas'); c.width=src.width;c.height=src.height;
  const g=c.getContext('2d'); g.filter='contrast(1.08) saturate(1.12)'; g.drawImage(src,0,0);
  const blur=document.createElement('canvas'); blur.width=src.width;blur.height=src.height;
  const b=blur.getContext('2d'); b.filter=`blur(${Math.max(5,Math.round(Math.min(src.width,src.height)*.008))}px) saturate(1.25)`; b.drawImage(src,0,0);
  g.globalCompositeOperation='screen'; g.globalAlpha=.55; g.filter='none'; g.drawImage(blur,0,0);
  addLayer(app,c,'Flash — Bloom',.72,'screen');
  toast('Flash bloom added — pair it with grain + halation for direct-flash style.',{type:'ok'});
}
export function chromatic(app) {
  const n=source(app); if(!n)return;
  const src=n.canvas, c=document.createElement('canvas'); c.width=src.width;c.height=src.height;
  const g=c.getContext('2d'); const d=2;
  g.globalCompositeOperation='screen';
  g.globalAlpha=.45; g.filter='saturate(1.5)';
  g.drawImage(src,d,0); g.drawImage(src,-d,0); g.drawImage(src,0,d); g.drawImage(src,0,-d);
  g.globalAlpha=1; g.filter='none'; g.drawImage(src,0,0);
  addLayer(app,c,'Optics — Chromatic',.65,'screen');
  toast('Optical chromatic effect added.',{type:'ok'});
}
