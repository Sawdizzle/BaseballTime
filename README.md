# BaseballTime / TourneyScan

Finds 10U through 14U tournaments with open brackets anywhere in Texas and
Oklahoma (the dashboard measures distance from any city or zip you enter,
defaulting to Sanger, TX) by scraping NCS
(playncs.com), PAC (playpacsports.com), PPS (baseball.playpps.com), and USSSA
(usssa.com JSON API, statewide TX + OK) twice
daily, storing results in Supabase (`tourneyscan` schema in the PickEm
project), and serving a filterable dashboard from `/site` on Vercel.

## Layout

- `scraper/` — Node 22 scraper. `npm run dry` prints JSON without touching the
  DB; `npm run scrape` upserts events + daily registration snapshots.
  Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars.
- `.github/workflows/scrape.yml` — runs the scraper at 7 AM and 7 PM Central,
  plus manual runs via the Actions tab (workflow_dispatch).
- `site/` — static dashboard (no build step). Vercel Root Directory = `site`.
  Distance is computed in the browser from each event's lat/lng and the
  user's chosen location (zip via Zippopotam, city via Open-Meteo); the
  scraper's `distance_miles` column is Sanger-based and only used for the
  run log's qualifying summary.
  Installable as a home-screen app: `manifest.webmanifest`, `sw.js` (shell
  cache only; data is always live), and the icon PNGs derived from
  `icon.png` (the 2048px master; also the masthead logo at 192px). If the
  artwork changes, re-export icon-512 / icon-192 / apple-touch-icon (180)
  and icon-512-maskable (78% inset on flat navy for Android's crop), then
  bump `CACHE` in `sw.js`.

## How counts work

NCS, PPS, and USSSA events get exact per-division team counts (10U–14U, stored
in `events.division_counts`) from each event's public team listing (Who's
Coming / division count pills). `teams_14u` is kept in sync for 14U. PAC
doesn't publish team lists, so PAC rows carry the total across all ages and
show ≈ on the dashboard. Tracked divisions live in `scraper/src/util.js`
(`TRACKED_DIVISIONS`); the dashboard's Age picker mirrors that list.

## When it breaks

If a site redesigns, that org's parser fails loudly and the Actions run goes
red (email from GitHub). The other orgs keep working — failures are isolated
per source. Fix lives in `scraper/src/{ncs,pac,pps,usssa}.js`.
