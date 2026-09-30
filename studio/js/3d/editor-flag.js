/* EYAD 3D — classic (non-module) script loaded right after file-notice.js.
 * file-notice.js only marks /image/, /video/ and /vector/ as editor pages, so
 * the 3D page marks itself here: the Studio then uses the editor workspace
 * theme (dark by default) before first paint, like the other editors. */
(function () {
  try {
    document.documentElement.setAttribute('data-studio-editor', '');
    var st = JSON.parse(localStorage.getItem('eyad-studio:settings:v2') || '{}') || {};
    var ws = st.workspaceTheme || 'dark';
    var t = ws === 'dark' || ws === 'light' ? ws : null;
    if (!t) {
      t = st.theme || 'portfolio';
      if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      else if (t !== 'light' && t !== 'dark') t = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-studio-theme', t);
  } catch (e) {
    document.documentElement.setAttribute('data-studio-editor', '');
  }
})();
