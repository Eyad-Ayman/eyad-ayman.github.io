// Pulls the latest posts from Instagram via the Instagram Graph API
// (Instagram Login) and writes them to data/instagram.json, which the
// site's homepage fetches client-side to render the "Feeds From
// Instagram" gallery. Run by .github/workflows/instagram-sync.yml on a
// schedule — see INSTAGRAM_SETUP.md for one-time setup instructions.
//
// Required env var: IG_ACCESS_TOKEN (a long-lived Instagram user token)

import { writeFile, mkdir, readFile, readdir, unlink, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "instagram.json");
const IMAGES_DIR = path.join(__dirname, "..", "assets", "images", "instagram");
// Instagram's media_url serves the full-resolution original — measured at
// 1-2 MB each, ~25 MB across the feed, which made the gallery crawl in on
// a phone. Mirror them locally at a sane display size instead (the grid
// never shows them wider than ~600px). This also removes a time bomb:
// Instagram's CDN URLs are signed and expire, so linking them directly
// meant the images would eventually break on their own.
const IMAGE_MAX_WIDTH = 900;
const IMAGE_QUALITY = 82;
// Instagram caps each individual page at 100 regardless of what "limit" is
// set to — this is just the page size, not a cap on total results. Every
// post gets pulled by following paging.next until it runs out.
const PAGE_SIZE = 100;

const token = process.env.IG_ACCESS_TOKEN;
if (!token) {
  console.error("Missing IG_ACCESS_TOKEN env var. See INSTAGRAM_SETUP.md.");
  process.exit(1);
}

async function fetchJSON(url) {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

function mapPost(item) {
  return {
    id: item.id,
    caption: (item.caption || "").split("\n")[0].slice(0, 140),
    // Videos don't expose a usable media_url for an <img>; use their thumbnail instead.
    image: item.media_type === "VIDEO" ? item.thumbnail_url : item.media_url,
    // For videos, media_url is the actual playable file — kept separately
    // so the gallery can render a real inline <video> instead of a static
    // thumbnail that just links out to Instagram.
    videoUrl: item.media_type === "VIDEO" ? item.media_url : null,
    permalink: item.permalink,
    timestamp: item.timestamp,
    isVideo: item.media_type === "VIDEO",
  };
}

async function fetchMedia() {
  const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";
  let url = `https://graph.instagram.com/me/media?fields=${fields}&limit=${PAGE_SIZE}&access_token=${token}`;
  const posts = [];

  while (url) {
    const data = await fetchJSON(url);
    (data.data || []).forEach((item) => posts.push(mapPost(item)));
    url = data.paging && data.paging.next ? data.paging.next : null;
  }

  return posts;
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Pull each post's image down once and store a downscaled copy in the repo,
// so the site serves small same-origin images instead of multi-megabyte
// signed CDN originals. Already-downloaded posts are skipped on later runs.
async function mirrorImages(posts) {
  await mkdir(IMAGES_DIR, { recursive: true });
  let downloaded = 0;

  for (const post of posts) {
    if (!post.image) continue;
    const file = `${post.id}.jpg`;
    const dest = path.join(IMAGES_DIR, file);
    const localPath = `./assets/images/instagram/${file}`;

    if (await exists(dest)) {
      post.image = localPath;
      continue;
    }

    try {
      const res = await fetch(post.image);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await sharp(buf)
        .rotate()
        .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: IMAGE_QUALITY, progressive: true })
        .toFile(dest);
      post.image = localPath;
      downloaded++;
    } catch (err) {
      // Keep the remote URL for this one rather than dropping the post —
      // a slow image beats a missing one.
      console.warn(`Could not mirror image for ${post.id}: ${err.message}`);
    }
  }

  // Drop images for posts that are no longer in the feed.
  const keep = new Set(posts.map((p) => `${p.id}.jpg`));
  for (const existing of await readdir(IMAGES_DIR)) {
    if (!keep.has(existing)) {
      await unlink(path.join(IMAGES_DIR, existing)).catch(() => {});
      console.log("Removed image for deleted post:", existing);
    }
  }

  console.log(`Mirrored ${downloaded} new image(s); ${posts.length} post(s) total.`);
}

// Long-lived tokens last 60 days and must be refreshed before they expire
// (Instagram allows refreshing once the token is at least 24h old). We
// always attempt this so the workflow can run indefinitely without manual
// intervention, as long as INSTAGRAM_SYNC_PAT is configured to let the
// workflow write the refreshed token back to the repo secret.
async function refreshToken() {
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`;
  try {
    const data = await fetchJSON(url);
    return data.access_token || null;
  } catch (err) {
    console.warn("Token refresh skipped:", err.message);
    return null;
  }
}

async function main() {
  const posts = await fetchMedia();
  await mirrorImages(posts);
  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(
    OUT_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), posts }, null, 2) + "\n"
  );
  console.log(`Wrote ${posts.length} posts to ${OUT_PATH}`);

  const refreshed = await refreshToken();
  if (refreshed && process.env.GITHUB_OUTPUT) {
    // Picked up by the workflow step that updates the GitHub secret.
    await writeFile(process.env.GITHUB_OUTPUT, `new_token=${refreshed}\n`, { flag: "a" });
    console.log("Token refreshed; new_token output set for the workflow.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
