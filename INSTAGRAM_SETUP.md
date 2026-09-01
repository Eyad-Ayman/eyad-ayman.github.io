# Instagram feed — setup

The site currently shows an **Elfsight** embed in "Feeds From Instagram"
(`index.html`, search for `elfsight-app-8608f34f`) — this is your
original widget app ID, already connected to `@eyadayman__` from the
old version of this site. Nothing further to set up; it should just
work as-is.

It's on Elfsight's free plan, which means it shows their own **"Free
Instagram Feed Widget"** badge — Elfsight only removes that on a paid
plan. That badge was explicitly removed from this site earlier in this
project, then reintroduced by request, so it's a known, deliberate
tradeoff rather than an oversight.

## Branding-free path: the official Instagram API instead

If you'd rather not show that badge, the site already has the
infrastructure for a branding-free version — a scheduled GitHub Action
(`.github/workflows/instagram-sync.yml`) that pulls your real posts via
Instagram's own API into `data/instagram.json`, no third party involved.
Once that has real data in it, `assets/js/instagram-feed.js`
**automatically replaces the Elfsight embed** with your real posts — you
don't need to remove anything by hand.

## 1. Push this project to GitHub

If you haven't already:

```bash
git init
git add .
git commit -m "Initial site"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## 2. Create a Meta developer app

1. Go to <https://developers.facebook.com/apps> and log in with the
   Facebook account linked to your Instagram (or link one — Instagram
   login now works standalone via "Instagram API with Instagram Login").
2. Click **Create App** → choose the **Business** type → give it any name
   (e.g. "eyad-ayman-site").
3. In the app dashboard, add the **Instagram** product.
4. Under Instagram → **API setup with Instagram login**, follow the
   prompts to connect your Instagram account and generate a **long-lived
   access token**. Copy it somewhere safe — it's a long string.

   (If your account is Personal rather than Business/Creator, Meta's flow
   will prompt you to convert it — this is required for API access and
   doesn't change how your Instagram looks or works.)

## 3. Add the token to GitHub

In your GitHub repo: **Settings → Secrets and variables → Actions → New
repository secret**.

- Name: `IG_ACCESS_TOKEN`
- Value: the long-lived token from step 2

## 4. (Optional but recommended) Let the workflow keep itself alive

The long-lived token expires after 60 days. The workflow can rotate it
automatically every run if you give it permission to update secrets:

1. Create a GitHub **classic** personal access token with the `repo`
   scope: <https://github.com/settings/tokens/new>
2. Add it as another repo secret named `INSTAGRAM_SYNC_PAT`.

Without this step, the feed itself keeps working fine — you'll just need
to repeat step 2 manually about every 55 days when the token expires.

## 5. Run it

Go to the repo's **Actions** tab → **Sync Instagram feed** → **Run
workflow** to trigger the first sync manually. After that it runs on its
own every 6 hours. Once `data/instagram.json` has real posts in it, the
homepage gallery switches from the "not connected yet" note to your real
posts automatically — no rebuild or redeploy needed.
