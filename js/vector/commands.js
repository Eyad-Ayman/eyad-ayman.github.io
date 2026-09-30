// EYAD VECTOR — document commands (menus, shortcuts, panels all call these).
import { uid } from '../core/dom.js';
import { toast, formDialog } from '../core/ui.js';
import { bounds, unionBounds, find, cloneNode, transformNode, translate, scaleAbout, rotateAbout, walk, makePath } from './model.js';
import { pathfinder, outlineStroke, paperReady, toPaper, fromPaper } from './pathops.js';

const need = (app, n = 1) => { if (app.sel.size < n) { toast(n > 1 ? `Select at least ${n} objects.` : 'Select an object first.', { type: 'warn' }); return false; } return true; };

export async function run(app, name, arg) {
  const doc = app.doc;
  const sel = () => app.selNodes();
  switch (name) {
    // ---- clipboard
    case 'copy': if (!app.sel.size) return; app.clipboard = JSON.stringify(app.selNodesDeep()); try { const { exportSVG } = await import('./model.js'); const b = app.selBounds(); if (b && navigator.clipboard?.writeText) navigator.clipboard.writeText(exportSVG({ ...doc, items: app.selNodesDeep() }, { ...b, name: 'Selection', bg: null })).catch(() => {}); } catch (e) { /* ignore */ } toast('Copied', { timeout: 700 }); return;
    case 'cut': if (!app.sel.size) return; await run(app, 'copy'); app.change('Cut', () => { for (const n of app.selNodesDeep()) app.removeNode(n.id); }); return;
    case 'paste': case 'pasteFront': case 'pasteBack': {
      if (!app.clipboard) { toast('Nothing copied yet.'); return; }
      const items = JSON.parse(app.clipboard).map(cloneNode);
      app.change('Paste', () => {
        if (name === 'paste') items.forEach((n) => transformNode(n, translate(16, 16)));
        if (name === 'pasteBack') doc.items.unshift(...items); else doc.items.push(...items);
        app.sel = new Set(items.map((n) => n.id));
      });
      app.clipboard = JSON.stringify(items);
      return;
    }
    // ---- selection
    case 'selectAll': app.sel = new Set(doc.items.filter((n) => !n.locked && !n.hidden).map((n) => n.id)); app.selectionChanged(); return;
    case 'deselect': app.sel = new Set(); app.selectionChanged(); return;
    case 'selectInverse': app.sel = new Set(doc.items.filter((n) => !app.sel.has(n.id) && !n.locked && !n.hidden).map((n) => n.id)); app.selectionChanged(); return;
    case 'selectSameFill': case 'selectSameStroke': {
      const key = name === 'selectSameFill' ? 'fill' : 'stroke';
      const ref = app.selNodesDeep()[0]?.style?.[key]; if (!ref) { toast('Select an object with a ' + key + ' first.'); return; }
      const out = new Set(); walk(doc.items, (n) => { if (n.style && JSON.stringify(n.style[key]) === JSON.stringify(ref) && !n.locked) out.add(n.id); });
      app.sel = out; app.selectionChanged(); return;
    }
    case 'delete': if (!app.sel.size) return; if (app.tool.id === 'direct' && app.anchorSel.size) return run(app, 'deleteAnchors'); app.change('Delete', () => { for (const n of app.selNodesDeep()) app.removeNode(n.id); app.sel = new Set(); }); return;
    // ---- objects
    case 'group': {
      if (!need(app, 1)) return;
      const nodes = sel(); if (!nodes.length) return;
      app.change('Group', () => {
        const idx = Math.max(...nodes.map((n) => doc.items.indexOf(n)));
        const g = { id: uid('n'), type: 'group', name: 'Group', hidden: false, locked: false, style: { opacity: 1, blend: 'normal' }, children: nodes };
        doc.items.splice(idx + 1, 0, g);
        doc.items = doc.items.filter((n) => !nodes.includes(n));
        app.sel = new Set([g.id]);
      });
      return;
    }
    case 'ungroup': {
      const gs = sel().filter((n) => n.type === 'group'); if (!gs.length) { toast('Select a group.'); return; }
      app.change('Ungroup', () => {
        const ids = [];
        for (const g of gs) { const i = doc.items.indexOf(g); const kids = g.children.map((c) => { if ((g.style?.opacity ?? 1) < 1 && c.style) c.style.opacity = (c.style.opacity ?? 1) * g.style.opacity; return c; }); doc.items.splice(i, 1, ...kids); ids.push(...kids.map((k) => k.id)); }
        app.sel = new Set(ids);
      });
      return;
    }
    case 'makeCompound': {
      const ps = sel().filter((n) => n.type === 'path'); if (ps.length < 2) { toast('Select two or more paths.'); return; }
      app.change('Make Compound Path', () => {
        const top = ps[ps.length - 1];
        const n = makePath(ps.flatMap((p) => p.subpaths), JSON.parse(JSON.stringify(top.style)), 'Compound path');
        n.fillRule = 'evenodd';
        const i = Math.max(...ps.map((p) => doc.items.indexOf(p)));
        doc.items.splice(i + 1, 0, n); doc.items = doc.items.filter((x) => !ps.includes(x));
        app.sel = new Set([n.id]);
      });
      return;
    }
    case 'releaseCompound': {
      const ps = sel().filter((n) => n.type === 'path' && n.subpaths.length > 1); if (!ps.length) { toast('Select a compound path.'); return; }
      app.change('Release Compound Path', () => { const ids = []; for (const p of ps) { const i = doc.items.indexOf(p); const parts = p.subpaths.map((sp, k) => ({ ...makePath([sp], JSON.parse(JSON.stringify(p.style)), p.name + ' ' + (k + 1)) })); doc.items.splice(i, 1, ...parts); ids.push(...parts.map((x) => x.id)); } app.sel = new Set(ids); });
      return;
    }
    case 'lock': if (!need(app)) return; app.change('Lock', () => { for (const n of app.selNodesDeep()) n.locked = true; app.sel = new Set(); }); return;
    case 'unlockAll': app.change('Unlock All', () => walk(doc.items, (n) => { n.locked = false; })); return;
    case 'hide': if (!need(app)) return; app.change('Hide', () => { for (const n of app.selNodesDeep()) n.hidden = true; app.sel = new Set(); }); return;
    case 'showAll': app.change('Show All', () => walk(doc.items, (n) => { n.hidden = false; })); return;
    case 'arrange': {
      if (!need(app)) return;
      app.change('Arrange', () => {
        const nodes = sel(); const rest = doc.items.filter((n) => !nodes.includes(n));
        if (arg === 'top') doc.items = [...rest, ...nodes];
        else if (arg === 'bottom') doc.items = [...nodes, ...rest];
        else {
          const items = doc.items.slice(), order = arg === 'up' ? [...nodes].reverse() : nodes;
          for (const n of order) { const i = items.indexOf(n), j = arg === 'up' ? i + 1 : i - 1; if (j < 0 || j >= items.length || nodes.includes(items[j])) continue; items[i] = items[j]; items[j] = n; }
          doc.items = items;
        }
      });
      return;
    }
    // ---- anchors
    case 'deleteAnchors': app.change('Delete Anchors', () => {
      const byNode = new Map();
      for (const key of app.anchorSel) { const [id, si, pi] = key.split(':'); if (!byNode.has(id)) byNode.set(id, []); byNode.get(id).push([+si, +pi]); }
      for (const [id, list] of byNode) {
        const f = find(doc, id); if (!f) continue;
        list.sort((a, b) => b[0] - a[0] || b[1] - a[1]).forEach(([si, pi]) => f.node.subpaths[si]?.pts.splice(pi, 1));
        f.node.subpaths = f.node.subpaths.filter((sp) => sp.pts.length >= 2);
        if (!f.node.subpaths.length) app.removeNode(id);
      }
      app.anchorSel = new Set();
    }); return;
    case 'anchorCorner': case 'anchorSmooth': app.change('Convert Anchor', () => {
      for (const key of app.anchorSel) {
        const [id, si, pi] = key.split(':'); const f = find(doc, id); const sp = f?.node.subpaths[+si]; const q = sp?.pts[+pi]; if (!q) continue;
        if (name === 'anchorCorner') { q.hi = null; q.ho = null; q.smooth = false; }
        else { const L = sp.pts.length, a = sp.pts[(+pi - 1 + L) % L], b = sp.pts[(+pi + 1) % L]; const dx = (b.x - a.x) / 6, dy = (b.y - a.y) / 6; q.hi = [q.x - dx, q.y - dy]; q.ho = [q.x + dx, q.y + dy]; q.smooth = true; }
      }
    }); return;
    // ---- colours
    case 'defaultColors': app.defFill = { kind: 'solid', color: '#ffffff', a: 1 }; app.defStroke = { kind: 'solid', color: '#111111', a: 1 }; app.defSW = 1;
      if (app.sel.size) app.change('Default Colours', () => { for (const n of app.selNodesDeep()) if (n.style && n.type !== 'image') { n.style.fill = { ...app.defFill }; n.style.stroke = { ...app.defStroke }; n.style.sw = 1; } });
      app.renderSwatches(); app.panels.refresh(); return;
    case 'swapFillStroke':
      if (app.sel.size) app.change('Swap Fill & Stroke', () => { for (const n of app.selNodesDeep()) if (n.style && n.type !== 'image') { const f = n.style.fill; n.style.fill = n.style.stroke; n.style.stroke = f; if (n.style.stroke && !n.style.sw) n.style.sw = 2; } });
      else { const f = app.defFill; app.defFill = app.defStroke; app.defStroke = f; }
      app.renderSwatches(); app.panels.refresh(); return;
    case 'noneFill': if (app.sel.size) app.change('No Fill', () => { for (const n of app.selNodesDeep()) if (n.style && n.type !== 'image') n.style.fill = null; }); else app.defFill = null; app.renderSwatches(); return;
    // ---- paths
    case 'outlineStroke': {
      const ps = app.selNodesDeep().filter((n) => n.type === 'path' && n.style?.stroke); if (!ps.length) { toast('Select a stroked path.'); return; }
      const outs = []; for (const p of ps) outs.push([p, await outlineStroke(p)]);
      app.change('Outline Stroke', () => { for (const [p, o] of outs) { const f = find(doc, p.id); if (!f) continue; if (p.style.fill) { f.list.splice(f.index + 1, 0, o); p.style.stroke = null; } else f.list.splice(f.index, 1, o); } app.sel = new Set(outs.map((x) => x[1].id)); });
      return;
    }
    case 'reverse': app.change('Reverse Path', () => { for (const n of app.selNodesDeep()) if (n.type === 'path') for (const sp of n.subpaths) sp.pts.reverse().forEach((q) => { const t = q.hi; q.hi = q.ho; q.ho = t; }); }); return;
    case 'simplify': {
      await paperReady();
      app.change('Simplify', () => { for (const n of app.selNodesDeep()) if (n.type === 'path') { const p = toPaper(n); if (p.children) p.children.forEach((c) => c.simplify(arg || 2.5)); else p.simplify(arg || 2.5); n.subpaths = fromPaper(p); } });
      return;
    }
    case 'join': {
      const ps = app.selNodesDeep().filter((n) => n.type === 'path');
      if (ps.length === 1 && ps[0].subpaths.length === 1 && !ps[0].subpaths[0].closed) { app.change('Close Path', () => { ps[0].subpaths[0].closed = true; }); return; }
      if (ps.length !== 2) { toast('Select one open path to close, or two open paths to join.'); return; }
      const [a, b] = ps, sa = a.subpaths[a.subpaths.length - 1], sb = b.subpaths[0];
      if (sa.closed || sb.closed) { toast('Both paths must be open.'); return; }
      app.change('Join', () => {
        const ea = sa.pts[sa.pts.length - 1], d0 = Math.hypot(sb.pts[0].x - ea.x, sb.pts[0].y - ea.y), d1 = Math.hypot(sb.pts[sb.pts.length - 1].x - ea.x, sb.pts[sb.pts.length - 1].y - ea.y);
        if (d1 < d0) sb.pts.reverse().forEach((q) => { const t = q.hi; q.hi = q.ho; q.ho = t; });
        sa.pts.push(...sb.pts); b.subpaths.shift(); if (!b.subpaths.length) app.removeNode(b.id); else a.subpaths.push(...b.subpaths.splice(0));
        app.sel = new Set([a.id]);
      });
      return;
    }
    case 'pathfinder': {
      const nodes = sel().filter((n) => n.type === 'path' || n.type === 'group');
      if (nodes.length < 2) { toast('Select two or more shapes.', { type: 'warn' }); return; }
      const ordered = doc.items.filter((n) => nodes.includes(n));
      try {
        const res = await pathfinder(ordered, arg);
        app.change({ unite: 'Unite', subtract: 'Minus Front', intersect: 'Intersect', exclude: 'Exclude', divide: 'Divide' }[arg], () => {
          const idx = Math.min(...ordered.map((n) => doc.items.indexOf(n)));
          doc.items = doc.items.filter((n) => !ordered.includes(n));
          if (arg === 'divide' && res.length > 1) { const g = { id: uid('n'), type: 'group', name: 'Divided', hidden: false, locked: false, style: { opacity: 1, blend: 'normal' }, children: res }; doc.items.splice(idx, 0, g); app.sel = new Set([g.id]); }
          else { doc.items.splice(idx, 0, ...res); app.sel = new Set(res.map((n) => n.id)); }
        });
      } catch (e) { toast(e.message, { type: 'error' }); }
      return;
    }
    // ---- align / distribute
    case 'align': {
      const nodes = sel(); if (!nodes.length) return;
      const toBoard = app.alignTo === 'artboard' || nodes.length === 1;
      const ref = toBoard ? app.activeArtboard() : unionBounds(nodes.map(bounds));
      app.change('Align', () => {
        for (const n of nodes) {
          const b = bounds(n); if (!b) continue;
          let dx = 0, dy = 0;
          if (arg === 'left') dx = ref.x - b.x; if (arg === 'hcenter') dx = ref.x + ref.w / 2 - (b.x + b.w / 2); if (arg === 'right') dx = ref.x + ref.w - (b.x + b.w);
          if (arg === 'top') dy = ref.y - b.y; if (arg === 'vcenter') dy = ref.y + ref.h / 2 - (b.y + b.h / 2); if (arg === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
          transformNode(n, translate(dx, dy));
        }
      });
      return;
    }
    case 'distribute': {
      const nodes = sel(); if (nodes.length < 3) { toast('Select three or more objects to distribute.'); return; }
      const ax = arg === 'h' ? 'x' : 'y', sz = arg === 'h' ? 'w' : 'h';
      const bs = nodes.map((n) => ({ n, b: bounds(n) })).filter((x) => x.b).sort((a, b) => a.b[ax] - b.b[ax]);
      const first = bs[0].b, last = bs[bs.length - 1].b;
      const total = bs.reduce((s, x) => s + x.b[sz], 0), gap = (last[ax] + last[sz] - first[ax] - total) / (bs.length - 1);
      app.change('Distribute', () => { let pos = first[ax] + first[sz] + gap; for (let i = 1; i < bs.length - 1; i++) { const d = pos - bs[i].b[ax]; transformNode(bs[i].n, arg === 'h' ? translate(d, 0) : translate(0, d)); pos += bs[i].b[sz] + gap; } });
      return;
    }
    // ---- transforms
    case 'reflect': { if (!need(app)) return; const b = app.selBounds(); const cx = b.x + b.w / 2, cy = b.y + b.h / 2; app.change('Reflect', () => { for (const n of app.selNodesDeep()) transformNode(n, arg === 'h' ? scaleAbout(-1, 1, cx, cy) : scaleAbout(1, -1, cx, cy)); }); return; }
    case 'rotate': { if (!need(app)) return; const b = app.selBounds(); app.change('Rotate', () => { for (const n of app.selNodesDeep()) transformNode(n, rotateAbout((arg || 90) * Math.PI / 180, b.x + b.w / 2, b.y + b.h / 2)); }); return; }
    case 'transformDialog': {
      if (!need(app)) return;
      const b = app.selBounds();
      const kind = arg || 'move';
      const fields = kind === 'move' ? [{ key: 'dx', label: 'Horizontal', type: 'number', value: 0, suffix: 'px' }, { key: 'dy', label: 'Vertical', type: 'number', value: 0, suffix: 'px' }, { key: 'copy', label: 'Copy', type: 'checkbox', value: false }]
        : kind === 'rotate' ? [{ key: 'a', label: 'Angle', type: 'number', value: 45, suffix: '°' }, { key: 'copy', label: 'Copy', type: 'checkbox', value: false }]
          : [{ key: 'sx', label: 'Horizontal', type: 'number', value: 100, suffix: '%' }, { key: 'sy', label: 'Vertical', type: 'number', value: 100, suffix: '%' }, { key: 'copy', label: 'Copy', type: 'checkbox', value: false }];
      const v = await formDialog({ title: { move: 'Move', rotate: 'Rotate', scale: 'Scale' }[kind], fields, ok: 'Apply' });
      if (!v) return;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const m = kind === 'move' ? translate(Number(v.dx) || 0, Number(v.dy) || 0) : kind === 'rotate' ? rotateAbout((Number(v.a) || 0) * Math.PI / 180, cx, cy) : scaleAbout((Number(v.sx) || 100) / 100, (Number(v.sy) || 100) / 100, cx, cy);
      app.change({ move: 'Move', rotate: 'Rotate', scale: 'Scale' }[kind], () => {
        if (v.copy) { const copies = sel().map(cloneNode); copies.forEach((c) => transformNode(c, m)); doc.items.push(...copies); app.sel = new Set(copies.map((c) => c.id)); }
        else for (const n of app.selNodesDeep()) transformNode(n, m);
      });
      return;
    }
    case 'setBounds': {
      const b = app.selBounds(); if (!b) return;
      const { x = b.x, y = b.y, w = b.w, h = b.h } = arg;
      app.change('Transform', () => { const m = [w / (b.w || 1), 0, 0, h / (b.h || 1), 0, 0]; m[4] = x - b.x * m[0]; m[5] = y - b.y * m[3]; for (const n of app.selNodesDeep()) transformNode(n, m); });
      return;
    }
    default: toast('Unknown command: ' + name);
  }
}
