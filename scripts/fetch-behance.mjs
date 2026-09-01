// Auto-checks the Behance profile for new/removed projects and keeps
// data/behance.json + assets/images/behance/ in sync. Run by
// .github/workflows/behance-sync.yml on a schedule — see
// BEHANCE_SETUP.md for context.
//
// Behance has no working public API or RSS feed anymore (both were
// discontinued), and plain HTTP requests get blocked by their bot
// detection. This uses a real headless browser with a stealth plugin to
// load the profile the same way a person would, then reads the project
// grid straight out of the rendered page.

import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { writeFile, mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

chromium.use(stealth());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const IMAGES_DIR = path.join(ROOT, "assets/images/behance");
const DATA_PATH = path.join(ROOT, "data/behance.json");
const USERNAME = process.env.BEHANCE_USERNAME || "eyad_ayman";

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/\|.*$/, "")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function scrapeProjects() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const res = await page.goto(`https://www.behance.net/${USERNAME}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    if (!res || res.status() >= 400) {
      throw new Error(`Profile page returned status ${res ? res.status() : "unknown"}`);
    }
    await page.waitForSelector("img.js-cover-image", { timeout: 15000 });
    await page.waitForTimeout(1500); // let the first batch fully settle before scrolling

    // Trigger lazy-loaded projects further down the page. Behance loads
    // these in bursts with pauses between, so require several
    // consecutive stable reads (not just one) before concluding we've
    // reached the end — a single stable read too early is exactly what
    // truncated a real scrape during testing.
    let stableStreak = 0;
    let prevCount = -1;
    for (let i = 0; i < 20 && stableStreak < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
      const count = await page.evaluate(() => document.querySelectorAll("img.js-cover-image").length);
      stableStreak = count === prevCount ? stableStreak + 1 : 0;
      prevCount = count;
    }

    const projects = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll("img.js-cover-image"));
      const seen = new Set();
      const out = [];
      imgs.forEach((img) => {
        const article = img.closest("article");
        const a = article ? article.querySelector('a[href*="/gallery/"]') : null;
        if (!a || seen.has(a.href)) return;
        seen.add(a.href);
        out.push({ title: img.alt, url: a.href, image: img.src });
      });
      return out;
    });

    await browser.close();
    return projects;
  } catch (err) {
    await browser.close();
    throw err;
  }
}

function galleryId(url) {
  const m = url.match(/\/gallery\/(\d+)\//);
  return m ? m[1] : null;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

async function main() {
  await mkdir(IMAGES_DIR, { recursive: true });

  let previous = { projects: [] };
  try {
    previous = JSON.parse(await readFile(DATA_PATH, "utf8"));
  } catch {
    // no previous data yet
  }
  const previousById = new Map((previous.projects || []).map((p) => [p.id, p]));

  const scraped = await scrapeProjects();
  if (scraped.length === 0) {
    throw new Error("Scraped zero projects — Behance may have changed their markup, or the page didn't load correctly. Leaving existing data untouched.");
  }

  // Safety guard: a real removal of most of a portfolio in one run is
  // implausible. If the scrape came back with far fewer projects than
  // last time, treat it as a failed/partial load (slow lazy-loading,
  // a layout change, a soft block) rather than real deletions, and
  // abort without touching any existing data or images.
  const previousCount = (previous.projects || []).length;
  if (previousCount > 0 && scraped.length < previousCount * 0.7) {
    throw new Error(
      `Scraped only ${scraped.length} projects vs ${previousCount} previously — that's a bigger drop than a real portfolio edit would produce. ` +
      `Treating this as a partial/failed scrape and leaving existing data untouched rather than deleting projects.`
    );
  }

  const current = [];
  const keepFiles = new Set();

  for (let i = 0; i < scraped.length; i++) {
    const p = scraped[i];
    const id = galleryId(p.url);
    if (!id) continue;

    const existing = previousById.get(id);
    let file = existing ? existing.file : null;

    if (!file) {
      const ext = path.extname(new URL(p.image).pathname) || ".jpg";
      file = `${id}-${slugify(p.title)}${ext}`;
      await download(p.image, path.join(IMAGES_DIR, file));
      console.log("Downloaded new project:", p.title);
    }
    keepFiles.add(file);
    current.push({ id, title: p.title, url: p.url, file });
  }

  // Clean up images for projects that are no longer published.
  for (const [id, old] of previousById) {
    if (!current.find((p) => p.id === id)) {
      try {
        await unlink(path.join(IMAGES_DIR, old.file));
        console.log("Removed project no longer on Behance:", old.title);
      } catch {
        // already gone
      }
    }
  }

  await writeFile(
    DATA_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), projects: current }, null, 2) + "\n"
  );
  console.log(`Wrote ${current.length} projects to ${DATA_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
