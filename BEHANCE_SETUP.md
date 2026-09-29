# Behance auto-sync — how it works

The Projects grid on the homepage already shows all 26 of your current
Behance projects, pulled from your real profile. Going forward, it
stays in sync **automatically** — no API key, no account setup, nothing
for you to do beyond pushing this repo to GitHub once.

## Why this doesn't use Behance's API

Adobe discontinued the Behance developer program — the API registration
page is gone, and their old RSS feeds return errors. There's no
official, credential-based way left to pull this data.

## How it actually works instead

`.github/workflows/behance-sync.yml` runs on a schedule (every 8 hours)
and on demand. It opens your public profile
(`behance.net/eyad_ayman`) with a real (headless) browser and reads the
project grid the same way a visitor's browser would — no login, no
scraping of private data, just your own public portfolio.

- **New project published?** It's downloaded and added to the grid
  automatically on the next run.
- **Project removed or unpublished?** It's automatically dropped from
  the grid and its image deleted from the repo.
- Everything it finds is written to `data/behance.json` and
  `assets/images/behance/`, which `assets/js/behance-feed.js` reads on
  every page load.

**Worth knowing:** this works by presenting as a normal browser to get
past Behance's automated-traffic blocking, which sits outside what
their Terms of Service technically allow for automated access — even
though it's only ever reading your own already-public portfolio data.
It runs a few times a day, not continuously, which keeps the footprint
low, but it's not something Behance has explicitly sanctioned.

## If your Behance username changes

Set a repository variable (not secret) named `BEHANCE_USERNAME` in
**Settings → Secrets and variables → Actions → Variables** with your new
username. Defaults to `eyad_ayman` if unset.

## Running it manually

Repo → **Actions** tab → **Sync Behance projects** → **Run workflow**.
