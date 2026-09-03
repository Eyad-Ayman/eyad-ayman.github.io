# How to update the site — no coding needed

This covers the three things you'll want to change most often: your photos, your bio, and your Work Experience. None of it needs programming — just replace a file or edit some plain text, then save.

## 1. Replacing photos

Every photo on the site lives in `assets/images/`, sorted by where it's used. **To swap a photo, just replace the file with a new one using the exact same filename.** The site will pick it up automatically — nothing else to change.

| Folder | What's in it | Notes |
|---|---|---|
| `assets/images/about/` | `photo-1.jpg` – `photo-4.jpg` — your About section photos | Keep the same filename when you replace one |
| `assets/images/hero/` | `portrait.webp` — your homepage photo; `loop.webm` + `loop-poster.webp` — the background video and its preview frame | The video needs to stay a `.webm` file |
| `assets/images/icons/` | `logo.gif`, `favicon.png`, `apple-touch-icon.png` | Site logo and browser-tab icon |
| `assets/images/social/` | Icons for Instagram/Facebook/LinkedIn/Behance/CV buttons | Rarely need to touch these |
| `assets/images/behance/` | Your Behance project covers | **Don't edit by hand** — this refills automatically every few hours from your real Behance profile |
| `assets/images/instagram/` | Your Instagram post images | **Don't edit by hand** — this refills automatically every few hours from your real Instagram |

**Adding a brand-new photo** (not just replacing one) needs one extra step: after adding the file, you'd need to add a line pointing to it in `index.html`. If you're not comfortable with that part, just tell me the photo and where it should go, and I'll wire it in — the photo itself you can drop in yourself any time.

## 2. Editing your bio ("Hey there!" section)

Open **`data/about.json`**. Each line inside `"paragraphs"` is one paragraph on the site, in order. Edit the text between the quotes, keep the commas between lines, save the file.

```json
{
  "paragraphs": [
    "First paragraph goes here.",
    "Second paragraph goes here."
  ]
}
```

To add a new paragraph, copy a line, paste it before the closing `]`, and add a comma after the line above it.

## 3. Editing Work Experience

Open **`data/experience.json`**. Each `{ ... }` block is one job on your timeline. Fields:

- `period` — the date range shown (e.g. `"July 2025 — Present"`)
- `title` — the role/company line
- `desc` — the one-line description underneath
- `icon` — which small icon shows: `case`, `video`, `pen`, or `star`
- `current` — set to `true` for your current role (adds the highlighted border), `false` for everything else

**To add a new job:** copy one whole `{ ... }` block, paste it wherever it belongs in the list, edit the four fields, and make sure there's a comma after every block except the very last one.

**To mark a new role as current:** set that block's `"current"` to `true`, and set your old current role back to `false` — only one should be `true` at a time.

Save the file, refresh the page, and the new list shows up. Nothing else needs to change.

## What updates itself, with no editing at all

- **Behance projects** — synced from your real profile every 8 hours
- **Instagram posts** — synced from your real account every 6 hours

You never need to touch `data/behance.json` or `data/instagram.json` directly — they're rewritten automatically. If you ever want to force an update immediately instead of waiting, go to the **Actions** tab on GitHub and run "Sync Behance projects" or "Sync Instagram feed" manually.

## If something looks wrong after an edit

JSON is picky about commas and quotes — a missing comma between two entries is the most common thing that breaks it. If the page stops showing your changes after an edit, the site is designed to fall back to showing the last-known-good content rather than break, so nothing will look empty — but paste me the file and I'll spot the typo in a few seconds.
