// EYAD STUDIO — shared UI kit: menus, dialogs, toasts, sheets, command palette.
import { h, clear, keyLabel, isTyping, modKey } from './dom.js';
import { icon } from './icons.js';

const root = () => document.querySelector('.studio-app') || document.body;

// ---------------------------------------------------------------- Toasts

let toastHost = null;
export function toast(message, { type = 'info', timeout = 3800, action = null, detail = '' } = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'studio-toasts', role: 'status', 'aria-live': 'polite' });
    root().appendChild(toastHost);
  }
  const ic = { info: 'info', ok: 'check', warn: 'warn', error: 'warn' }[type] || 'info';
  const el = h('div', { class: `studio-toast is-${type}` },
    icon(ic, 16),
    h('div', { class: 'studio-toast-body' }, h('div', { text: message }), detail ? h('div', { class: 'studio-toast-detail', text: detail }) : null),
    action ? h('button', { class: 'studio-btn is-small', text: action.label, onclick: () => { action.fn(); close(); } }) : null,
    h('button', { class: 'studio-icon-btn is-small', 'aria-label': 'Dismiss', onclick: () => close() }, icon('close', 14)),
  );
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  let t = timeout ? setTimeout(close, timeout) : 0;
  function close() {
    clearTimeout(t);
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 220);
  }
  close.close = close;
  close.set = (msg) => { const m = el.querySelector('.studio-toast-body > div'); if (m) m.textContent = msg; };
  return close;
}

// ---------------------------------------------------------------- Dialogs

const openDialogs = [];
export function isDialogOpen() { return openDialogs.length > 0; }

/**
 * dialog({ title, body, buttons:[{label,value,primary,danger}], width, dismissable, onOpen })
 * Resolves with the chosen button's value (or null when dismissed).
 */
export function dialog({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], width = 440, dismissable = true, onOpen, className = '' }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const btns = buttons.map((b) => h('button', {
      class: 'studio-btn' + (b.primary ? ' is-primary' : '') + (b.danger ? ' is-danger' : ''),
      type: 'button', text: b.label,
      onclick: () => done(typeof b.value === 'function' ? b.value() : b.value),
    }));
    const box = h('div', { class: 'studio-dialog ' + className, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { width: `min(${width}px, calc(100vw - 24px))` } },
      h('div', { class: 'studio-dialog-head' },
        h('h2', { class: 'studio-dialog-title', text: title }),
        dismissable ? h('button', { class: 'studio-icon-btn', 'aria-label': 'Close', onclick: () => done(null) }, icon('close', 16)) : null),
      h('div', { class: 'studio-dialog-body' }, body || null),
      btns.length ? h('div', { class: 'studio-dialog-foot' }, btns) : null,
    );
    const scrim = h('div', { class: 'studio-scrim' }, box);
    scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim && dismissable) done(null); });
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) { e.preventDefault(); e.stopPropagation(); done(null); }
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const primary = buttons.findIndex((b) => b.primary);
        if (primary >= 0) { e.preventDefault(); e.stopPropagation(); btns[primary].click(); }
      }
    };
    scrim.addEventListener('keydown', onKey);
    root().appendChild(scrim);
    openDialogs.push(scrim);
    requestAnimationFrame(() => {
      scrim.classList.add('is-in');
      const first = box.querySelector('[autofocus], input:not([type=hidden]), select, textarea') || btns.find((b, i) => buttons[i].primary) || btns[0];
      if (first) first.focus();
    });
    if (onOpen) onOpen({ box, close: done });
    let finished = false;
    function done(v) {
      if (finished) return;
      finished = true;
      scrim.classList.remove('is-in');
      openDialogs.splice(openDialogs.indexOf(scrim), 1);
      setTimeout(() => scrim.remove(), 160);
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ignore */ }
      resolve(v);
    }
  });
}

export function alertDialog(title, message, { detail, list } = {}) {
  const body = h('div', { class: 'studio-stack' },
    h('p', { text: message }),
    detail ? h('p', { class: 'studio-dim', text: detail }) : null,
    list ? h('ul', { class: 'studio-list' }, list.map((x) => h('li', { text: x }))) : null);
  return dialog({ title, body, buttons: [{ label: 'OK', value: true, primary: true }] });
}

export function confirmDialog(title, message, { ok = 'OK', cancel = 'Cancel', danger = false, extra = null } = {}) {
  const buttons = [{ label: cancel, value: false }];
  if (extra) buttons.push(extra);
  buttons.push({ label: ok, value: true, primary: !danger, danger });
  return dialog({ title, body: h('p', { text: message }), buttons });
}

export function promptDialog(title, label, value = '', { ok = 'OK', maxLength = 120 } = {}) {
  const input = h('input', { class: 'studio-input', type: 'text', value, maxLength, autofocus: true });
  const body = h('label', { class: 'studio-field' }, h('span', { text: label }), input);
  setTimeout(() => input.select(), 30);
  return dialog({ title, body, buttons: [{ label: 'Cancel', value: null }, { label: ok, value: () => input.value.trim(), primary: true }] });
}

/**
 * Build a form from field specs. Returns { el, values(), set(key,val) }.
 * field: { key, label, type: number|text|select|checkbox|range|color|segmented, value, min, max, step, options:[{value,label}], suffix, hint }
 */
export function buildForm(fields, onChange) {
  const inputs = {};
  const el = h('div', { class: 'studio-form' });
  for (const f of fields) {
    if (f.type === 'heading') { el.appendChild(h('div', { class: 'studio-form-heading', text: f.label })); continue; }
    if (f.type === 'note') { el.appendChild(h('p', { class: 'studio-dim studio-small', text: f.label })); continue; }
    let input;
    if (f.type === 'select') {
      input = h('select', { class: 'studio-input' }, f.options.map((o) => h('option', { value: String(o.value), text: o.label, selected: String(o.value) === String(f.value) })));
    } else if (f.type === 'checkbox') {
      input = h('input', { type: 'checkbox', checked: !!f.value });
    } else if (f.type === 'range') {
      input = h('input', { class: 'studio-range', type: 'range', min: f.min, max: f.max, step: f.step || 1, value: f.value });
    } else if (f.type === 'color') {
      input = h('input', { class: 'studio-color', type: 'color', value: f.value });
    } else if (f.type === 'textarea') {
      input = h('textarea', { class: 'studio-input', rows: f.rows || 4, maxLength: f.maxLength, placeholder: f.placeholder });
      input.value = f.value ?? '';
    } else {
      input = h('input', { class: 'studio-input', type: f.type || 'text', value: f.value, min: f.min, max: f.max, step: f.step, maxLength: f.maxLength, placeholder: f.placeholder, inputMode: f.inputMode, autocomplete: f.autocomplete });
    }
    inputs[f.key] = { input, f };
    const readout = f.type === 'range' ? h('output', { class: 'studio-mono studio-readout', text: fmt(f.value, f) }) : null;
    const row = h('label', { class: 'studio-field' + (f.type === 'checkbox' ? ' is-check' : '') },
      h('span', { class: 'studio-field-label', text: f.label }),
      h('span', { class: 'studio-field-control' }, input, readout, f.suffix ? h('span', { class: 'studio-dim studio-small', text: f.suffix }) : null),
      f.hint ? h('span', { class: 'studio-field-hint', text: f.hint }) : null);
    const handler = () => {
      if (readout) readout.textContent = fmt(input.value, f);
      if (onChange) onChange(values());
    };
    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
    el.appendChild(row);
  }
  function fmt(v, f) { return (f.format ? f.format(Number(v)) : String(v)) + (f.unit || ''); }
  function values() {
    const out = {};
    for (const [k, { input, f }] of Object.entries(inputs)) {
      if (f.type === 'checkbox') out[k] = input.checked;
      else if (f.type === 'number' || f.type === 'range') out[k] = Number(input.value);
      else out[k] = input.value;
    }
    return out;
  }
  function set(k, v) {
    const r = inputs[k]; if (!r) return;
    if (r.f.type === 'checkbox') r.input.checked = !!v; else r.input.value = v;
  }
  return { el, values, set, inputs };
}

export async function formDialog({ title, fields, ok = 'OK', onChange, width = 420, intro, className = '' }) {
  const form = buildForm(fields, onChange);
  const body = intro ? h('div', {}, h('p', { class: 'studio-dim', text: intro }), form.el) : form.el;
  const v = await dialog({ title, body, width, className, buttons: [{ label: 'Cancel', value: null }, { label: ok, value: () => form.values(), primary: true }] });
  return v;
}

export function progressDialog(title, { cancellable = true } = {}) {
  let cancelFn = null;
  const bar = h('div', { class: 'studio-progress-bar' });
  const label = h('div', { class: 'studio-dim studio-small', text: 'Starting…' });
  const body = h('div', { class: 'studio-stack' }, h('div', { class: 'studio-progress' }, bar), label);
  let closeFn;
  const p = dialog({
    title, body, dismissable: false, width: 420,
    buttons: cancellable ? [{ label: 'Cancel', value: 'cancel' }] : [],
    onOpen: ({ close }) => { closeFn = close; },
  });
  p.then((v) => { if (v === 'cancel' && cancelFn) cancelFn(); });
  return {
    set(frac, text) {
      if (frac == null) bar.classList.add('is-indeterminate');
      else { bar.classList.remove('is-indeterminate'); bar.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%'; }
      if (text) label.textContent = text;
    },
    onCancel(fn) { cancelFn = fn; },
    close() { if (closeFn) closeFn('done'); },
  };
}

// ---------------------------------------------------------------- Menus

let openMenu = null;
const floatingSubs = () => document.querySelectorAll('.studio-menu.is-float');
function closeOpenMenu() { floatingSubs().forEach((x) => x.remove()); if (openMenu) { openMenu.close(); openMenu = null; } }
const inFloating = (t) => Array.from(floatingSubs()).some((x) => x.contains(t));
document.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.contains(e.target) && !inFloating(e.target)) closeOpenMenu();
}, true);
// Escape closes a menu that was opened with the mouse (focus is not inside the list then).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openMenu && !e.defaultPrevented && !(e.target.closest && e.target.closest('.studio-menu'))) { e.preventDefault(); closeOpenMenu(); }
});

function evalFlag(v) { return typeof v === 'function' ? v() : v; }

function closeChildSubs(list) {
  let c = list._child;
  while (c) { const n = c._child; c.remove(); c = n; }
  list._child = null;
  list.querySelectorAll(':scope > .is-sub-open').forEach((b) => { b.classList.remove('is-sub-open'); b.setAttribute('aria-expanded', 'false'); });
}

/** Renders a dropdown list for menu items. Returns the element. */
function renderMenuList(items, onPick, depth = 0) {
  const list = h('div', { class: 'studio-menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.separator) { list.appendChild(h('div', { class: 'studio-menu-sep', role: 'separator' })); continue; }
    if (it.heading) { list.appendChild(h('div', { class: 'studio-menu-heading', text: it.heading })); continue; }
    const enabled = it.enabled === undefined ? true : !!evalFlag(it.enabled);
    const checked = it.checked === undefined ? null : !!evalFlag(it.checked);
    const sub = typeof it.submenu === 'function' ? it.submenu() : it.submenu;
    const btn = h('button', {
      class: 'studio-menu-item' + (sub ? ' has-sub' : ''), type: 'button', role: checked === null ? 'menuitem' : 'menuitemcheckbox',
      'aria-checked': checked === null ? undefined : String(checked), disabled: !enabled,
    },
    h('span', { class: 'studio-menu-check' }, checked ? icon('check', 14) : null),
    h('span', { class: 'studio-menu-label', text: evalFlag(it.label) }),
    it.badge ? h('span', { class: 'studio-badge', text: it.badge }) : null,
    it.shortcut ? h('span', { class: 'studio-menu-key', text: keyLabel(it.shortcut) }) : null,
    sub ? icon('chevronRight', 14) : null);
    if (sub) {
      btn.setAttribute('aria-haspopup', 'menu');
      // Submenus float as their own fixed layer (a scrollable dropdown would clip them).
      const openSub = (focusFirst = false) => {
        closeChildSubs(list);
        if (!sub.length) return;
        const subEl = renderMenuList(sub, onPick, depth + 1);
        subEl.classList.add('is-dropdown', 'is-float');
        subEl._parentList = list; subEl._depth = depth + 1;
        list._child = subEl;
        btn.setAttribute('aria-expanded', 'true');
        btn.classList.add('is-sub-open');
        root().appendChild(subEl);
        const br = btn.getBoundingClientRect(), r = subEl.getBoundingClientRect();
        let x = br.right + 2;
        if (x + r.width > innerWidth - 4) x = Math.max(4, br.left - r.width - 2);
        let y = br.top - 5;
        if (y + r.height > innerHeight - 4) y = Math.max(4, innerHeight - 4 - r.height);
        subEl.style.left = x + 'px'; subEl.style.top = y + 'px';
        subEl.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowLeft' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeChildSubs(list); btn.focus(); }
        });
        if (focusFirst) subEl.querySelector('.studio-menu-item:not([disabled])')?.focus();
      };
      let hoverT = 0;
      btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { clearTimeout(hoverT); hoverT = setTimeout(() => { if (btn.matches(':hover')) openSub(); }, 90); } });
      btn.addEventListener('click', (e) => { e.stopPropagation(); if (!enabled) return; if (btn.classList.contains('is-sub-open') && e.pointerType !== 'mouse') { closeChildSubs(list); return; } openSub(e.detail === 0); });
      btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openSub(true); } });
    } else {
      btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') closeChildSubs(list); });
      btn.addEventListener('click', (e) => { e.stopPropagation(); if (!enabled) return; onPick(); it.action && it.action(); });
    }
    list.appendChild(btn);
  }
  list.addEventListener('keydown', (e) => {
    const btns = Array.from(list.querySelectorAll(':scope > .studio-menu-item:not([disabled])'));
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (btns[i + 1] || btns[0])?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (btns[i - 1] || btns[btns.length - 1])?.focus(); }
  });
  return list;
}

/** Desktop menubar. menus: [{ label, items }] */
export function createMenubar(host, menus) {
  clear(host);
  host.classList.add('studio-menubar');
  host.setAttribute('role', 'menubar');
  let active = null;
  const buttons = menus.map((m, idx) => {
    const b = h('button', { class: 'studio-menubar-item', type: 'button', text: m.label, 'aria-haspopup': 'true' });
    b.addEventListener('click', () => { if (active === idx) closeOpenMenu(); else open(idx); });
    b.addEventListener('pointerenter', () => { if (active !== null && active !== idx) open(idx); });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); open((idx + 1) % menus.length, true); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); open((idx - 1 + menus.length) % menus.length, true); }
      if (e.key === 'ArrowDown') { e.preventDefault(); open(idx, true); }
    });
    host.appendChild(b);
    return b;
  });
  function open(idx, focusFirst) {
    closeOpenMenu();
    active = idx;
    const b = buttons[idx];
    b.classList.add('is-open');
    const list = renderMenuList(menus[idx].items, () => closeOpenMenu());
    list.classList.add('is-dropdown');
    const r = b.getBoundingClientRect();
    list.style.left = Math.min(r.left, innerWidth - 280) + 'px';
    list.style.top = r.bottom + 'px';
    root().appendChild(list);
    list.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeOpenMenu(); b.focus(); }
      if (e.key === 'ArrowRight' && !e.target.classList.contains('has-sub') && !e.target.closest('.is-float')) open((idx + 1) % menus.length, true);
      if (e.key === 'ArrowLeft' && !e.target.closest('.is-float')) open((idx - 1 + menus.length) % menus.length, true);
    });
    const wrapper = {
      contains: (t) => list.contains(t) || host.contains(t),
      close: () => { list.remove(); b.classList.remove('is-open'); active = null; },
    };
    openMenu = wrapper;
    if (focusFirst) list.querySelector('.studio-menu-item:not([disabled])')?.focus();
  }
  return { open, close: closeOpenMenu };
}

export function contextMenu(x, y, items) {
  closeOpenMenu();
  const list = renderMenuList(items, () => closeOpenMenu());
  list.classList.add('is-dropdown', 'is-context');
  root().appendChild(list);
  const r = list.getBoundingClientRect();
  list.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  list.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  openMenu = { contains: (t) => list.contains(t), close: () => list.remove() };
  list.querySelector('.studio-menu-item:not([disabled])')?.focus({ preventScroll: true });
  list.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOpenMenu(); });
}

/** Menu structure rendered as a tappable list inside a bottom sheet (mobile). */
export function menuSheet(title, menus) {
  const body = h('div', { class: 'studio-menu-sheet' });
  let sheet;
  const render = (items, heading, back) => {
    clear(body);
    if (back) body.appendChild(h('button', { class: 'studio-sheet-row is-back', onclick: back }, icon('chevronLeft', 16), h('span', { text: heading })));
    for (const it of items) {
      if (!it || it.separator || it.heading) continue;
      const sub = typeof it.submenu === 'function' ? it.submenu() : it.submenu;
      const enabled = it.enabled === undefined ? true : !!evalFlag(it.enabled);
      const checked = it.checked === undefined ? null : !!evalFlag(it.checked);
      body.appendChild(h('button', {
        class: 'studio-sheet-row', disabled: !enabled,
        onclick: () => {
          if (sub || it.items) render(sub || it.items, evalFlag(it.label), () => render(menus.map((m) => (m.items ? { label: m.label, items: m.items } : m)), title));
          else { sheet.close(); it.action && it.action(); }
        },
      }, h('span', { text: evalFlag(it.label) }),
      it.badge ? h('span', { class: 'studio-badge', text: it.badge }) : null,
      checked ? icon('check', 16) : null,
      (sub || it.items) ? icon('chevronRight', 16) : null));
    }
  };
  render(menus.map((m) => (m.items ? { label: m.label, items: m.items } : m)), title);
  sheet = openSheet({ title, content: body });
  return sheet;
}

// ---------------------------------------------------------------- Bottom sheets

let activeSheet = null;
export function openSheet({ title, content, onClose, height = 'auto', persistent = false }) {
  if (activeSheet) activeSheet.close();
  const handle = h('div', { class: 'studio-sheet-handle' });
  const panel = h('div', { class: 'studio-sheet', role: 'dialog', 'aria-label': title },
    handle,
    h('div', { class: 'studio-sheet-head' },
      h('div', { class: 'studio-sheet-title', text: title }),
      h('button', { class: 'studio-icon-btn', 'aria-label': 'Close', onclick: () => close() }, icon('close', 16))),
    h('div', { class: 'studio-sheet-body' }, content));
  if (height !== 'auto') panel.style.height = height;
  const scrim = h('div', { class: 'studio-sheet-scrim' + (persistent ? ' is-clear' : '') });
  scrim.addEventListener('pointerdown', () => close());
  root().appendChild(scrim);
  root().appendChild(panel);
  requestAnimationFrame(() => { panel.classList.add('is-in'); scrim.classList.add('is-in'); });
  // swipe down to dismiss
  let startY = null, dy = 0;
  handle.parentElement.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.studio-sheet-handle, .studio-sheet-head')) return;
    startY = e.clientY; dy = 0; panel.setPointerCapture(e.pointerId); panel.style.transition = 'none';
  });
  panel.addEventListener('pointermove', (e) => { if (startY === null) return; dy = Math.max(0, e.clientY - startY); panel.style.transform = `translateY(${dy}px)`; });
  const end = () => { if (startY === null) return; startY = null; panel.style.transition = ''; panel.style.transform = ''; if (dy > 80) close(); };
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);
  let closed = false;
  const onEsc = (e) => { if (e.key === 'Escape' && !document.querySelector('.studio-scrim')) { e.stopPropagation(); close(); } };
  addEventListener('keydown', onEsc, true);
  function close() {
    if (closed) return; closed = true;
    removeEventListener('keydown', onEsc, true);
    panel.classList.remove('is-in'); scrim.classList.remove('is-in');
    setTimeout(() => { panel.remove(); scrim.remove(); }, 240);
    if (activeSheet === api) activeSheet = null;
    if (onClose) onClose();
  }
  const api = { close, panel, get closed() { return closed; } };
  activeSheet = api;
  return api;
}
export function closeSheet() { if (activeSheet) activeSheet.close(); }

// ---------------------------------------------------------------- Command palette

export function commandPalette(getCommands) {
  let open = false;
  function show() {
    if (open) return;
    open = true;
    const cmds = getCommands().filter((c) => !c.when || c.when());
    const input = h('input', { class: 'studio-palette-input', type: 'text', placeholder: 'Type a command…', 'aria-label': 'Command', autocomplete: 'off', spellcheck: false });
    const list = h('div', { class: 'studio-palette-list', role: 'listbox' });
    let sel = 0, filtered = cmds;
    const render = () => {
      const q = input.value.trim().toLowerCase();
      filtered = !q ? cmds : cmds
        .map((c) => ({ c, s: score(c, q) }))
        .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c);
      sel = Math.min(sel, Math.max(0, filtered.length - 1));
      clear(list);
      if (!filtered.length) list.appendChild(h('div', { class: 'studio-palette-empty', text: 'No matching command' }));
      filtered.slice(0, 60).forEach((c, i) => {
        list.appendChild(h('button', {
          class: 'studio-palette-item' + (i === sel ? ' is-sel' : ''), type: 'button', role: 'option',
          onclick: () => run(c), onpointermove: () => { if (sel !== i) { sel = i; render(); } },
        },
        c.icon ? icon(c.icon, 16) : h('span', { class: 'studio-palette-dot' }),
        h('span', { class: 'studio-palette-label', text: c.label }),
        c.group ? h('span', { class: 'studio-palette-group', text: c.group }) : null,
        c.shortcut ? h('span', { class: 'studio-menu-key', text: keyLabel(c.shortcut) }) : null));
      });
      list.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
    };
    const box = h('div', { class: 'studio-palette' }, h('div', { class: 'studio-palette-bar' }, icon('search', 16), input, h('kbd', { class: 'studio-kbd', text: 'esc' })), list);
    const scrim = h('div', { class: 'studio-scrim is-top' }, box);
    scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(); });
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(filtered.length - 1, sel + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (filtered[sel]) run(filtered[sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    root().appendChild(scrim);
    render();
    requestAnimationFrame(() => { scrim.classList.add('is-in'); input.focus(); });
    function run(c) { close(); setTimeout(() => c.run(), 0); }
    function close() { open = false; scrim.classList.remove('is-in'); setTimeout(() => scrim.remove(), 150); }
  }
  function score(c, q) {
    const l = (c.label + ' ' + (c.group || '') + ' ' + (c.keywords || '')).toLowerCase();
    if (l.startsWith(q)) return 100;
    const i = l.indexOf(q);
    if (i >= 0) return 80 - i;
    // subsequence match
    let j = 0;
    for (const ch of l) if (ch === q[j]) j++;
    return j === q.length ? 20 : 0;
  }
  document.addEventListener('keydown', (e) => {
    if (modKey(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (!isDialogOpen()) show();
    }
  });
  return { show };
}

// ---------------------------------------------------------------- Save status

export function saveIndicator() {
  const dot = h('span', { class: 'studio-save-dot' });
  const label = h('span', { class: 'studio-save-label', text: 'No document' });
  const el = h('div', { class: 'studio-save', 'aria-live': 'polite' }, dot, label);
  return {
    el,
    set(state, text) {
      el.dataset.state = state; // saved | saving | dirty | recovered | idle | error
      label.textContent = text || ({ saved: 'Saved', saving: 'Saving…', dirty: 'Unsaved changes', recovered: 'Recovered project', idle: 'Not saved yet', error: 'Save failed' }[state] || '');
    },
  };
}

// ---------------------------------------------------------------- Keyboard

/**
 * Keymap: { 'Mod+Z': fn, 'Shift+Mod+Z': fn, 'V': fn, 'Space': fn }
 * Combo order-insensitive. Single keys ignore typing contexts.
 */
export function bindKeys(map, { target = document, when = () => true } = {}) {
  const norm = (combo) => combo.split('+').map((s) => s.trim()).sort().join('+').toLowerCase();
  const table = new Map(Object.entries(map).map(([k, v]) => [norm(k), v]));
  const handler = (e) => {
    if (e.defaultPrevented) return;
    if (!when(e)) return;
    if (isDialogOpen()) return;
    if (isTyping(e)) return;
    const parts = [];
    if (modKey(e)) parts.push('Mod');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    let key = e.key;
    if (key === ' ') key = 'Space';
    if (key === '+') key = 'Plus';
    if (e.code && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3); // layout-independent letters (Alt changes e.key on Mac)
    if (e.code && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
    if (key.length === 1) key = key.toUpperCase();
    parts.push(key);
    const fn = table.get(norm(parts.join('+')));
    if (fn) {
      const r = fn(e);
      if (r !== false) { e.preventDefault(); e.stopPropagation(); }
    }
  };
  target.addEventListener('keydown', handler);
  return () => target.removeEventListener('keydown', handler);
}

export function tooltip(el, text) { el.setAttribute('title', text); el.setAttribute('aria-label', el.getAttribute('aria-label') || text); return el; }

export function iconButton(name, label, onclick, { shortcut, cls = '', size = 18 } = {}) {
  const b = h('button', { class: 'studio-icon-btn ' + cls, type: 'button', 'aria-label': label, onclick }, icon(name, size));
  b.title = shortcut ? `${label} (${keyLabel(shortcut)})` : label;
  return b;
}
