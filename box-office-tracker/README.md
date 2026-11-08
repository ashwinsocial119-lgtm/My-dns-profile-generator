# 🎬 Box Office Tracker

Near-real-time box office for **up to 3 films at once**: Indian (Hindi, Tamil, Telugu, Malayalam, Kannada…) and international (Hollywood and others). Every film is checked against the most reliable public trackers, and the figures are shown side by side.

You can use it two ways on an iPhone:

| | **iPhone widget** (Scriptable) | **Web app** (add to Home Screen) |
|---|---|---|
| Needs hosting? | No, it runs entirely on your phone | Yes, free on Vercel or Cloudflare Pages |
| Home-screen widget | ✅ small, medium, large and Lock Screen | — (shows as an app icon) |
| Auto-refresh | About hourly (iOS decides the exact moment) | Every hour while open, and on reopen after an hour |
| Manual refresh | Run the script, tap **↻ Refresh** | Refresh button, or pull down |
| Dark mode | Always dark | Dark by default (Auto and Light available) |

The two work fine together. The web app can hand your film list to the widget.

---

## Where the numbers come from

| Source | Best for | How fresh |
|---|---|---|
| **[Sacnilk](https://www.sacnilk.com)** | Indian films: India **net** and gross, overseas, worldwide, language split, and **live day-of estimates**. Also India collections of Hollywood films. | Updated through the day (marked **● LIVE**) |
| **[The Numbers](https://www.the-numbers.com)** | Hollywood and global: domestic daily, weekend **estimates** (Sunday), international and worldwide. | Daily; estimates appear before actuals |
| **[Box Office Mojo](https://www.boxofficemojo.com)** (IMDb) | Studio-reported domestic and international, and opening weekend. | Daily (actuals; often a day behind The Numbers' estimates) |
| **[Wikipedia](https://en.wikipedia.org)** | Editor-maintained total citing trade sources (Bollywood Hungama, The Numbers, etc.). Also used to search films and link each one to the other sources. | Usually within a day |

**Headline figure**
- For **Indian films** the big number is Sacnilk's worldwide gross in ₹.
- For **other films** it is the higher of The Numbers and Box Office Mojo in $. Running totals only go up, so the higher one is the more recently updated.

The card names the source used, and every source row links to its original page.

**"Latest day"** shows Sacnilk's live estimate for Indian films, or The Numbers' latest US/Canada daily figure for others. Figures more than ~10 days old are never shown as "latest".

> Trade figures are estimates and *will* differ between sources (net vs gross, different markets, studio vs tracker). Seeing them side by side is the point.

---

## Option 1: iPhone home-screen widget (no server needed)

1. Install **[Scriptable](https://apps.apple.com/app/scriptable/id1405459188)** (free) from the App Store.
2. Get the script onto your phone. Pick one:
   - Open [`widget/Box Office Tracker.js`](widget/Box%20Office%20Tracker.js) on GitHub, tap **Raw**, select all and copy. In Scriptable, tap **+**, paste, and name it *Box Office Tracker*.
   - If you deployed the web app: open **Settings → Copy widget script**, then in Scriptable tap **+** and paste.
   - Download the file and save it to **iCloud Drive › Scriptable**. It appears in Scriptable automatically.
3. Run the script in Scriptable. Tap **＋ Add film**, type a title, and pick the right result. Repeat for up to 3 films. If you already use the web app, choose **Import** instead (copy your films from the web app's Settings first).
4. Long-press the Home Screen → **+** → **Scriptable** → choose **Medium** (shows all 3 films), **Large** (posters and per-source figures) or **Small** (one film). Long-press the new widget → **Edit Widget** → *Script*: **Box Office Tracker**.
   - Small widget: set **Parameter** to `2` or `3` to show your 2nd or 3rd film.
   - Lock Screen: add a Scriptable **rectangular** widget to show your first film.
   - Optional: set *When Interacting* to **Run Script** to open the full view when you tap.

The widget asks iOS to refresh every 60 minutes. iOS controls the exact timing, so it can sometimes be later. Running the script (or tapping the widget) always fetches fresh numbers. To make a tap open your web app instead, set `webAppUrl` in the `CONFIG` block near the top of the script.

---

## Option 2: Web app with dark mode (add to Home Screen)

Browsers can't read Sacnilk, The Numbers or Box Office Mojo directly. So the app includes a tiny, locked-down `/api/fetch` function that fetches only those sites' film pages. Your phone does all the parsing; Wikipedia is called straight from your phone. Both free hosts below work.

### Deploy on Vercel (recommended)

1. Sign in at [vercel.com](https://vercel.com) with GitHub → **Add New… → Project** → import this repository.
2. Set **Root Directory** to `box-office-tracker`. Leave Framework Preset as **Other** and the build command empty (the included `vercel.json` sets the output directory to `public`).
3. **Deploy**. Open the `https://<your-project>.vercel.app` URL on your iPhone.

### …or Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick this repo.
2. **Root directory:** `box-office-tracker` · **Build command:** *(none)* · **Build output directory:** `public`.
3. Deploy. The `functions/` folder is picked up automatically for `/api/*`.

### Put it on your Home Screen

In Safari, open your deployed URL → **Share** → **Add to Home Screen**. It then opens full-screen like an app, in dark mode, with pull-to-refresh.

### Using it

- **Search** any film in the bar. Results show their origin (WIKI, BOM or SAC). Tap one to track it. The app matches it on every source automatically, which takes a couple of seconds.
- **Max 3 films.** Tap **×** on a card to stop tracking it.
- **Refresh:** automatic every hour (and when you come back to the app after an hour), or tap ↻ or pull down any time.
- **Settings (⚙︎):** theme (Dark, Auto or Light), headline currency (the film's home currency, ₹ or $), and widget setup. The ₹/$ conversion uses a live exchange rate from open.er-api.com.

---

## Project layout

```
box-office-tracker/
├── public/                 # the web app (static)
│   ├── index.html
│   ├── css/app.css
│   ├── js/core.js          # ★ all scraping/parsing/matching — shared with the widget
│   ├── js/app.js           # UI, refresh scheduling, storage
│   └── widget/…            # built widget script, served for easy install
├── lib/proxy.js            # the allow-listed /api/fetch proxy (shared by all hosts)
├── api/                    # Vercel functions → lib/proxy.js
├── functions/api/          # Cloudflare Pages function → lib/proxy.js
├── server.mjs              # run everything locally / on any Node host
├── widget/
│   ├── widget.src.js       # Scriptable widget source
│   └── Box Office Tracker.js  # ← built: core.js + widget in one file
├── scripts/build-widget.mjs
├── scripts/smoke.mjs       # live check against the real sites
└── test/core.test.js
```

## Development

Needs Node 18+. There are no dependencies to install.

```bash
cd box-office-tracker
npm start                 # http://localhost:8787 (web app + /api)
npm test                  # unit tests (parsers, formatting, proxy allow-list)
npm run build:widget      # rebuild the Scriptable script after editing core.js or widget.src.js
npm run smoke -- "jailer 2" "clayface"   # hit the real sources end-to-end
```

**If a source stops working:** these sites occasionally change their HTML. Run `npm run smoke` to see which parser broke. Each source's parser is a small function in `public/js/core.js` (`parseSacnilk`, `parseNumbers`, `parseBom`, `parseWiki`). After fixing, run `npm run build:widget` and re-copy the script to Scriptable.

**Proxy safety:** `/api/fetch` only accepts `https` URLs on the four source hosts, and only their film, search and API paths (see `ALLOW` in `lib/proxy.js`). It is not an open proxy. Responses get a short shared cache (2–5 min) so quick reloads don't hammer the sources. Manual refreshes bypass the cache.

Not affiliated with Sacnilk, Nash Information Services (The Numbers), IMDb/Box Office Mojo or Wikipedia. This is for personal use. Please be respectful of these sites; the app makes only a handful of requests per film per hour.
