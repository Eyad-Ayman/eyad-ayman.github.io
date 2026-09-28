/* EYAD STUDIO — shown only when a Studio page is opened as a local file
 * (file://). Browsers block modules, workers, fonts and storage there, so the
 * Studio must be served over http(s): GitHub Pages or the local preview. */
/* It also applies the theme before first paint (no flash): the Studio follows
 * the portfolio's own light/dark toggle unless a Studio setting overrides it. */
(function () {
  try {
    var st = JSON.parse(localStorage.getItem('eyad-studio:settings:v2') || '{}') || {};
    var t = st.theme || 'portfolio';
    if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    else if (t !== 'light' && t !== 'dark') t = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-studio-theme', t);
  } catch (e) { /* storage blocked: light */ }
})();
(function () {
  if (location.protocol !== 'file:') return;
  function show() {
    var box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:#0b0b0d;color:#ecebe8;font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif';
    var inner = document.createElement('div');
    inner.style.cssText = 'max-width:560px';
    var h = document.createElement('h1');
    h.textContent = 'EYAD STUDIO needs to be served, not opened as a file';
    h.style.cssText = 'font-size:24px;margin:0 0 12px;letter-spacing:.02em';
    var p1 = document.createElement('p');
    p1.textContent = 'You opened this page directly from your disk (file://). Browsers block JavaScript modules, workers, fonts and local storage on file pages, so the Studio (and the portfolio gallery feeds) cannot start.';
    var p2 = document.createElement('p');
    p2.textContent = 'To preview on your computer: go to the site folder and double-click “Preview locally (Windows).bat” (Mac/Linux: run local-preview/preview-mac-linux.sh). It opens http://localhost:8080/ in your browser. Once pushed to GitHub Pages it works at https://eyad-ayman.github.io/studio/ with nothing else to do.';
    inner.appendChild(h); inner.appendChild(p1); inner.appendChild(p2);
    box.appendChild(inner);
    document.body.appendChild(box);
  }
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
