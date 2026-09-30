// EYAD STUDIO V4 — Spatial Studio layer.
// Adds a non-macOS creative workspace: movable panels, workspace presets,
// font manager (local IndexedDB + FontFace), multi-window helpers,
// quick effects/looks and persistent UI customisation. No external runtime deps.
import { h } from './dom.js';
import { icon } from './icons.js';
import { dialog, toast } from './ui.js';
import { FONTS } from '../image/doc.js';

const UI_KEY = 'eyad-studio:v4-ui';
const FONT_DB = 'eyad-studio-fonts-v1';
const FONT_STORE = 'fonts';

const defaults = {
  vibe: 'studio',
  glass: 74,
  blur: 22,
  radius: 24,
  density: 'comfortable',
  freeform: false,
  grain: 0.16,
  accent: '#ff3045',
};

let state = loadState();

function loadState() {
  try { return { ...defaults, ...(JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}) }; }
  catch { return { ...defaults }; }
}
function saveState() {
  try { localStorage.setItem(UI_KEY, JSON.stringify(state)); } catch {}
}
function root() { return document.querySelector('.studio-app') || document.body; }

function applyState() {
  const r = root();
  r.dataset.vibe = state.vibe;
  r.dataset.freeform = state.freeform ? 'true' : 'false';
  r.dataset.density = state.density;
  r.style.setProperty('--eyad-glass', String(state.glass / 100));
  r.style.setProperty('--eyad-blur', `${state.blur}px`);
  r.style.setProperty('--eyad-radius', `${state.radius}px`);
  r.style.setProperty('--eyad-grain-opacity', String(state.grain));
  r.style.setProperty('--eyad-accent', state.accent);
  document.documentElement.dataset.eyadV4 = '1';
}

function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FONT_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(FONT_STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function fontPut(item) {
  const db = await dbOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(FONT_STORE, 'readwrite');
    tx.objectStore(FONT_STORE).put(item);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function fontAll() {
  const db = await dbOpen();
  const out = await new Promise((resolve, reject) => {
    const tx = db.transaction(FONT_STORE, 'readonly');
    const req = tx.objectStore(FONT_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  db.close(); return out;
}
async function loadFonts() {
  if (!('FontFace' in window)) return;
  try {
    const items = await fontAll();
    for (const item of items) {
      try {
        const face = new FontFace(item.family, item.buffer, item.descriptors || {});
        await face.load();
        document.fonts.add(face);
        if (!FONTS.some(([css]) => css === `'${item.family}'`)) FONTS.push([`'${item.family}'`, item.family]);
      } catch {}
    }
  } catch {}
}

function installCustomStyle() {
  if (document.getElementById('eyad-v4-style')) return;
  const s = document.createElement('style');
  s.id = 'eyad-v4-style';
  s.textContent = `
    :root[data-eyad-v4="1"] .studio-app { --eyad-glass: .74; --eyad-blur: 22px; --eyad-radius: 24px; --eyad-accent: #ff3045; }
    .eyad-v4-pill { display:inline-flex; align-items:center; gap:7px; height:32px; padding:0 12px; border:1px solid rgba(255,255,255,.14); border-radius:999px; background:rgba(18,18,20,.58); color:#f5f5f5; box-shadow:0 8px 28px rgba(0,0,0,.2), inset 0 1px rgba(255,255,255,.08); backdrop-filter:blur(18px) saturate(1.25); -webkit-backdrop-filter:blur(18px) saturate(1.25); cursor:pointer; }
    .eyad-v4-pill:hover { transform:translateY(-1px); border-color:rgba(255,255,255,.25); }
    .eyad-v4-pill b { font-size:10px; letter-spacing:.12em; }
    .eyad-v4-menu { position:fixed; z-index:99999; width:min(720px,calc(100vw - 28px)); max-height:min(760px,calc(100vh - 40px)); overflow:auto; padding:18px; border:1px solid rgba(255,255,255,.14); border-radius:30px; background:rgba(18,18,20,.82); color:#f4f4f4; box-shadow:0 32px 100px rgba(0,0,0,.5); backdrop-filter:blur(32px) saturate(1.4); -webkit-backdrop-filter:blur(32px) saturate(1.4); }
    .eyad-v4-menu h2 { margin:0; font:700 26px/1.05 var(--st-display,system-ui); text-transform:uppercase; }
    .eyad-v4-menu .sub { color:#aaa; font-size:11px; margin-top:5px; }
    .eyad-v4-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:16px; }
    .eyad-v4-card { border:1px solid rgba(255,255,255,.1); border-radius:20px; padding:14px; background:rgba(255,255,255,.045); }
    .eyad-v4-card h3 { margin:0 0 5px; font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
    .eyad-v4-card p { margin:0 0 12px; color:#9d9d9d; font-size:10px; }
    .eyad-v4-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .eyad-v4-menu input[type=range] { width:100%; accent-color:var(--eyad-accent); }
    .eyad-v4-menu input[type=text], .eyad-v4-menu input[type=url] { width:100%; min-height:34px; border:1px solid rgba(255,255,255,.12); border-radius:12px; background:rgba(0,0,0,.24); color:#fff; padding:0 10px; }
    .eyad-v4-swatch { width:28px; height:28px; padding:0; border:0; border-radius:50%; overflow:hidden; }
    .eyad-v4-fonts { display:flex; flex-wrap:wrap; gap:6px; max-height:160px; overflow:auto; }
    .eyad-v4-font { border:1px solid rgba(255,255,255,.1); background:rgba(255,255,255,.05); color:#fff; border-radius:12px; padding:7px 9px; cursor:pointer; }
    .eyad-v4-close { position:absolute; top:12px; right:12px; border:0; background:rgba(255,255,255,.08); color:#fff; width:32px; height:32px; border-radius:50%; cursor:pointer; }
    .studio-app[data-vibe="studio"] { --st-radius:10px; }
    .studio-app[data-vibe="studio"] .img-top, .studio-app[data-vibe="studio"] .img-options, .studio-app[data-vibe="studio"] .img-toolbar, .studio-app[data-vibe="studio"] .img-panels,
    .studio-app[data-vibe="studio"] .cam-panel, .studio-app[data-vibe="studio"] .vid-left, .studio-app[data-vibe="studio"] .vid-right { border-color:rgba(255,255,255,.09); }
    .studio-app[data-vibe="studio"] .img-top, .studio-app[data-vibe="studio"] .img-options { background:rgba(14,14,16,.82); backdrop-filter:blur(var(--eyad-blur)) saturate(1.2); -webkit-backdrop-filter:blur(var(--eyad-blur)) saturate(1.2); }
    .studio-app[data-vibe="studio"] .img-toolbar, .studio-app[data-vibe="studio"] .img-panels { background:rgba(20,20,22,.68); backdrop-filter:blur(calc(var(--eyad-blur) * .75)) saturate(1.18); -webkit-backdrop-filter:blur(calc(var(--eyad-blur) * .75)) saturate(1.18); }
    .studio-app[data-vibe="studio"] .img-tool[aria-pressed="true"], .studio-app[data-vibe="studio"] .studio-btn.is-primary { box-shadow:0 0 0 1px color-mix(in srgb,var(--eyad-accent) 50%,transparent), 0 8px 24px color-mix(in srgb,var(--eyad-accent) 18%,transparent); }
    .studio-app[data-vibe="studio"] .img-stage { background:radial-gradient(circle at 50% 20%, rgba(255,255,255,.045), transparent 40%), #0b0b0c; }
    .studio-app[data-vibe="studio"] .img-tab, .studio-app[data-vibe="studio"] .img-panel-head, .studio-app[data-vibe="studio"] .cam-look, .studio-app[data-vibe="studio"] .studio-btn { border-radius:14px; }
    .studio-app[data-vibe="studio"] .img-tab.is-active { box-shadow:0 6px 25px rgba(0,0,0,.22), inset 0 0 0 1px rgba(255,255,255,.08); }
    .studio-app[data-vibe="studio"]::after { content:""; position:fixed; inset:0; pointer-events:none; z-index:9990; opacity:var(--eyad-grain-opacity); background-image:var(--st-grain); mix-blend-mode:screen; }
    .studio-app[data-freeform="true"] .img-main { position:relative; display:block; }
    .studio-app[data-freeform="true"] .img-toolbar { position:absolute; z-index:30; left:12px; top:12px; height:auto; max-height:calc(100% - 24px); border:1px solid rgba(255,255,255,.12); border-radius:22px; box-shadow:0 18px 60px rgba(0,0,0,.3); }
    .studio-app[data-freeform="true"] .img-panels { position:absolute; z-index:31; right:12px; top:12px; bottom:12px; width:300px; border:1px solid rgba(255,255,255,.12); border-radius:22px; box-shadow:0 18px 60px rgba(0,0,0,.3); }
    .studio-app[data-freeform="true"] .img-center { height:100%; }
    .studio-app[data-freeform="true"] .img-options { position:absolute; z-index:32; left:50%; top:10px; transform:translateX(-50%); width:max-content; max-width:calc(100% - 360px); border:1px solid rgba(255,255,255,.12); border-radius:999px; box-shadow:0 14px 50px rgba(0,0,0,.25); }
    .studio-app[data-freeform="true"] .img-toolbar, .studio-app[data-freeform="true"] .img-panels, .studio-app[data-freeform="true"] .img-options { transition:none; }
    .eyad-v4-draggable { touch-action:none; user-select:none; }
    @media (max-width:760px){ .eyad-v4-grid{grid-template-columns:1fr}.eyad-v4-menu{border-radius:22px}.studio-app[data-freeform="true"] .img-toolbar,.studio-app[data-freeform="true"] .img-panels{position:relative;inset:auto;width:auto;max-height:none}.studio-app[data-freeform="true"] .img-options{position:relative;left:auto;top:auto;transform:none;width:auto;max-width:none;border-radius:0} }
  `;
  document.head.appendChild(s);
}

function makeDraggable(el, handle = el) {
  if (!el || el.dataset.eyadDrag === '1') return;
  el.dataset.eyadDrag = '1'; el.classList.add('eyad-v4-draggable');
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !state.freeform) return;
    if (e.target.closest('button,input,select,a,textarea')) return;
    const r = el.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    el.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      el.style.left = `${Math.max(6, ev.clientX - ox)}px`;
      el.style.top = `${Math.max(6, ev.clientY - oy)}px`;
      el.style.right = 'auto'; el.style.bottom = 'auto'; el.style.transform = 'none';
    };
    const up = () => {
      el.releasePointerCapture?.(e.pointerId);
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
      savePositions();
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  });
}
function savePositions() {
  if (!state.freeform) return;
  const out = {};
  for (const sel of ['.img-toolbar','.img-panels','.img-options']) {
    const el = document.querySelector(sel); if (el) out[sel] = { left: el.style.left, top: el.style.top, right: el.style.right, bottom: el.style.bottom, transform: el.style.transform };
  }
  try { localStorage.setItem(UI_KEY + ':positions', JSON.stringify(out)); } catch {}
}
function restorePositions() {
  if (!state.freeform) return;
  try {
    const out = JSON.parse(localStorage.getItem(UI_KEY + ':positions') || '{}');
    for (const [sel,p] of Object.entries(out)) {
      const el=document.querySelector(sel); if (!el) continue;
      for (const k of ['left','top','right','bottom','transform']) if (p[k] != null) el.style[k]=p[k];
    }
  } catch {}
}
function wireDrag() {
  makeDraggable(document.querySelector('.img-toolbar'));
  makeDraggable(document.querySelector('.img-panels'), document.querySelector('.img-panels'));
  makeDraggable(document.querySelector('.img-options'));
  restorePositions();
}

function openNewWindow() {
  const u = new URL(location.href);
  u.searchParams.set('eyadWindow', Date.now().toString(36));
  const w = window.open(u.href, '_blank', 'noopener,noreferrer,width=1500,height=950');
  if (!w) toast('Allow pop-ups to open another Studio window.', { type:'warn' });
  else toast('Studio window opened.', { type:'ok' });
}

function duplicateTab() {
  const u = new URL(location.href);
  u.searchParams.set('eyadDuplicate', Date.now().toString(36));
  window.open(u.href, '_blank', 'noopener,noreferrer');
  toast('Duplicated the current Studio tab.', { type:'ok' });
}

function fontManager() {
  const list = h('div', { class:'eyad-v4-fonts' });
  const refresh = () => {
    list.replaceChildren(...FONTS.slice().reverse().map(([css,name]) => h('button', { class:'eyad-v4-font', type:'button', style:{fontFamily:css}, text:name, onclick:()=>toast(`${name} is available in the text tool.`,{type:'ok'}) })));
  };
  refresh();
  const input = h('input', { type:'file', accept:'.woff,.woff2,.ttf,.otf', multiple:true });
  const urlInput = h('input', { type:'url', placeholder:'Optional web font CSS / font URL' });
  const body = h('div', { class:'eyad-v4-grid' },
    h('div',{class:'eyad-v4-card'}, h('h3',{text:'Add from device'}), h('p',{text:'Import WOFF, WOFF2, TTF or OTF. Fonts are stored locally and loaded offline.'}),
      input,
      h('div',{class:'eyad-v4-row',style:{marginTop:'10px'}},
        h('button',{class:'studio-btn is-small is-primary',type:'button',text:'Import fonts',onclick:async()=>{
          const fs=[...input.files]; if(!fs.length)return;
          for(const f of fs){
            try{
              const buffer=await f.arrayBuffer(), family=f.name.replace(/\.(woff2?|ttf|otf)$/i,'').replace(/[-_]+/g,' ');
              const face=new FontFace(family,buffer); await face.load(); document.fonts.add(face);
              if(!FONTS.some(([css])=>css===`'${family}'`)) FONTS.push([`'${family}'`,family]);
              await fontPut({id:family.toLowerCase(),family,buffer,descriptors:{}});
            }catch(e){toast(`Could not load ${f.name}`,{type:'error'});}
          }
          refresh(); toast('Fonts added to EYAD Studio.',{type:'ok'});
        }}),
        h('a',{class:'studio-btn is-small',href:'https://fonts.google.com',target:'_blank',rel:'noopener',text:'Find fonts online'})
      )),
    h('div',{class:'eyad-v4-card'}, h('h3',{text:'Font library'}), h('p',{text:'Built-in + imported fonts available to the editors.'}), list));
  dialog({ title:'Studio Font Lab', width:760, body });
}

function customization() {
  const wrap = h('div', { class: 'eyad-v4-menu' });
  const close = h('button', { class: 'eyad-v4-close', type: 'button', text: '×', onclick: () => wrap.remove() });
  const slider = (label, key, min, max, step = 1) => {
    const val = h('span', { class: 'studio-mono', text: String(state[key]) });
    const r = h('input', { type: 'range', min, max, step, value: state[key] });
    r.addEventListener('input', () => { state[key] = +r.value; val.textContent = r.value; applyState(); saveState(); });
    return h('label', { class: 'eyad-v4-card' }, h('h3', { text: label }), val, r);
  };
  const vibe = (id, label, desc) => h('button', {
    class: 'eyad-v4-card', type: 'button', style: { textAlign: 'left', cursor: 'pointer' },
    onclick: () => { state.vibe = id; applyState(); saveState(); }
  }, h('h3', { text: label }), h('p', { text: desc }));
  const workspace = h('div', { class: 'eyad-v4-card' },
    h('h3', { text: 'Workspace' }),
    h('p', { text: 'Freeform lets you drag the main editor toolbar, options and inspector around the canvas.' }),
    h('button', { class: 'studio-btn is-small is-primary', type: 'button', text: state.freeform ? 'Freeform ON' : 'Enable Freeform', onclick: () => {
      state.freeform = !state.freeform; applyState(); saveState(); setTimeout(wireDrag, 20);
    } })
  );
  const windows = h('div', { class: 'eyad-v4-card' },
    h('h3', { text: 'Studio windows' }),
    h('p', { text: 'Open another editor window behind the current one, or duplicate this tab.' }),
    h('div', { class: 'eyad-v4-row' },
      h('button', { class: 'studio-btn is-small', type: 'button', text: 'New window', onclick: openNewWindow }),
      h('button', { class: 'studio-btn is-small', type: 'button', text: 'Duplicate tab', onclick: duplicateTab })
    )
  );
  const fonts = h('div', { class: 'eyad-v4-card' },
    h('h3', { text: 'Fonts' }),
    h('p', { text: 'Bring fonts from this PC/device or browse the web for new ones.' }),
    h('button', { class: 'studio-btn is-small', type: 'button', text: 'Open Font Lab', onclick: fontManager })
  );
  const grid = h('div', { class: 'eyad-v4-grid' },
    vibe('studio', 'Studio / Swag', 'Dark creative room, floating glass controls, grain and sharp editor contrast.'),
    vibe('clean', 'Clean Glass', 'Less texture, more transparency and a calmer workspace.'),
    slider('Glass', 'glass', 20, 100, 1),
    slider('Blur', 'blur', 4, 42, 1),
    slider('Corner radius', 'radius', 8, 38, 1),
    slider('Grain', 'grain', 0, .35, .01),
    workspace, windows, fonts
  );
  wrap.append(close, h('h2', { text: 'STUDIO CONTROL' }), h('div', { class: 'sub', text: 'Build your own workspace. Nothing is locked to one layout.' }), grid);
  document.body.appendChild(wrap);
  const x = innerWidth / 2 - wrap.offsetWidth / 2, y = innerHeight / 2 - wrap.offsetHeight / 2;
  wrap.style.left = Math.max(10, x) + 'px'; wrap.style.top = Math.max(10, y) + 'px';
}
function injectControls() {
  const top = document.querySelector('.img-top, .hub-header, .cam-top, .vid-top');
  if (!top || top.querySelector('.eyad-v4-control')) return;
  const host = top.querySelector('.img-top-right, .hub-actions, .cam-top-right') || top;
  const b=h('button',{class:'eyad-v4-pill eyad-v4-control',type:'button',title:'Studio Control',onclick:customization},icon('sliders',14),h('b',{text:'STUDIO'}));
  host.prepend(b);
}

export async function initStudioV4() {
  installCustomStyle();
  applyState();
  await loadFonts();
  injectControls();
  wireDrag();
  const mo=new MutationObserver(()=>{ injectControls(); if(state.freeform) wireDrag(); });
  mo.observe(document.body,{childList:true,subtree:true});
  addEventListener('keydown',(e)=>{
    if((e.ctrlKey||e.metaKey)&&e.altKey&&e.code==='KeyK'){e.preventDefault();customization();}
    if((e.ctrlKey||e.metaKey)&&e.altKey&&e.code==='KeyW'){e.preventDefault();openNewWindow();}
  });
  setTimeout(()=>{injectControls();wireDrag();},250);
}
