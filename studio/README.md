# EYAD STUDIO

Eyad Ayman's own browser-based creative software, added to the portfolio as a
separate app under `/studio/`. The portfolio itself is unchanged apart from one
nav link ("Studio ↗") in `index.html` and two sitemap entries.

| URL | What |
| --- | --- |
| `/studio/` | Studio home (apps, recent projects, drop any file) |
| `/studio/image/` | **EYAD IMAGE** — layered image editor with PSD import |
| `/studio/video/` | **EYAD VIDEO** — timeline video editor with `.prproj` import |
| `/studio/projects/` | Projects saved in this browser (`.eyad`) |
| `/studio/settings/` | Preferences, autosave, storage |
| `/studio/help/` | Documentation: supported files, compatibility, shortcuts |

No build step, no server, no dependencies to install: plain HTML + ES modules,
deployable as-is on GitHub Pages. Everything runs locally; files are never uploaded.

## Isolation from the portfolio
- All Studio code, CSS, fonts, icons and workers live in `/studio/`. The portfolio
  never loads any of it.
- Studio CSS is only loaded by Studio pages and is scoped to `.studio-app`
  (element resets use `:where()` so they have zero specificity).
- Studio has its own service worker (`studio/sw.js`, scope `/studio/`) and its own
  cache names (`eyad-studio-*`). The portfolio keeps its own `sw.js`.
- Storage: IndexedDB database `eyad-studio`, settings in localStorage key
  `eyad-studio:settings:v1`.

## Structure
```
studio/
  index.html, image/, video/, projects/, settings/, help/   pages
  css/        studio.css (shared), image.css, video.css, hub.css
  js/core/    dom, ui kit (menus, dialogs, sheets, palette), db (IndexedDB), zip,
              .eyad format, file detection, settings, shell, history, docs
  js/image/   doc model, compositor, view (zoom/pan/gestures), tools, history
              commands, selections, panels, menus, ops, PSD import/export, io
  js/video/   model, engine (playback/compositing/Web Audio), timeline, panels,
              ops (edits), effects registry, media store, .prproj reader, export, io
  js/workers/ filters (pixel ops), psd (parser), peaks (waveforms)
  vendor/     ag-psd (MIT) — real PSD parser
  fonts/      Oswald, Inter, JetBrains Mono (SIL OFL)
  sw.js, manifest.webmanifest, icons/
  scripts/build-sw.py   regenerate the offline file list after editing Studio files
```

## Honest limits
- **PSD**: real parser; layers, groups, masks, clipping, opacity, common blend
  modes and vector shape layers are rebuilt. Text / smart objects arrive as pixels,
  adjustment layers as placeholders, layer styles are listed but not rendered,
  CMYK is refused with instructions. Every import shows a per-file report.
  PSD export is labelled *Experimental*.
- **.prproj**: sequences, tracks, clip timing, speed, media references and markers
  are reconstructed where the XML allows; effects, transitions, keyframes, nested /
  multicam sequences and graphics are reported, not reproduced. Media always starts
  offline and must be relinked. Tested against real-structure fixtures; Premiere's
  format varies between versions, so unusual projects may import partially.
- **Video codecs** are whatever the browser supports (ProRes/HEVC MOV usually not
  in Chrome — the app says so). Video export records in real time with
  MediaRecorder (MP4 or WebM depending on the browser).
- Canvas filter effects in video need `CanvasRenderingContext2D.filter`
  (Chrome/Edge/Firefox); other browsers show a “Limited support” note.

## Maintenance
After changing any file in `/studio/`, run `python3 studio/scripts/build-sw.py`
so installed/offline copies pick up the new files.

## Previewing on your computer
Don't double-click `index.html` — browsers block modules, fetch(), fonts and
storage on `file://` pages, so the Studio can't start and the portfolio's
gallery feeds (data/*.json) can't load (this was already true for the gallery
before the Studio existed). Instead:
- **Windows:** double-click `Preview locally (Windows).bat` in the site folder.
- **Mac/Linux:** run `local-preview/preview-mac-linux.sh`.
Both serve the folder at http://localhost:8080/ — the same way GitHub Pages does.


## V4 Spatial Studio upgrade

The Studio now ships with a local, dependency-free spatial workspace layer:

- Studio / Swag visual chrome instead of macOS traffic-light window styling.
- Floating glass controls, grain, blur and configurable corner radius.
- **Studio Control** panel (`Ctrl/Cmd + Alt + K`) for persistent UI customisation.
- Freeform workspace mode: drag the image toolbar, options bar and inspector around the canvas.
- New Studio windows and duplicated browser tabs.
- **Font Lab**: import WOFF/WOFF2/TTF/OTF from the device, persist them in IndexedDB, and use them in the text tool; includes an online font discovery link.
- Camera **Smart Looks** rail with local film-engine presets for direct flash, Y2K CCD, night flash, disposable, warm skin and street looks.
- Image **Glow / Bloom**, **Direct Flash Bloom**, and **Optical Chromatic** effects as separate layers.
- Template Store **Trending now** filter for quick trend-oriented starting points.
- All runtime libraries remain local in `vendor/`; no new CDN/runtime dependency was added.
