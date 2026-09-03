# BaseballTime / TourneyScan

Finds 10U, 11U, 12U, and 14U tournaments with open brackets near Sanger, TX by scraping NCS
(playncs.com), PAC (playpacsports.com), and PPS (baseball.playpps.com) twice
daily, storing results in Supabase (`tourneyscan` schema in the PickEm
project), and serving a filterable dashboard from `/site` on Vercel.

## Layout

- `scraper/` — Node 22 scraper. `npm run dry` prints JSON without touching the
  DB; `npm run scrape` upserts events + daily registration snapshots.
  Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars.
- `.github/workflows/scrape.yml` — runs the scraper at 7 AM and 7 PM Central,
  plus manual runs via the Actions tab (workflow_dispatch).
- `site/` — static dashboard (no build step). Vercel Root Directory = `site`.

## How counts work

NCS and PPS events get exact per-division team counts (10U/11U/12U/14U, stored
in `events.division_counts`) from each event's public team listing (Who's
Coming / division count pills). `teams_14u` is kept in sync for 14U. PAC
doesn't publish team lists, so PAC rows carry the total across all ages and
show ≈ on the dashboard. Tracked divisions live in `scraper/src/util.js`
(`TRACKED_DIVISIONS`); the dashboard's Age picker mirrors that list.

## When it breaks

If a site redesigns, that org's parser fails loudly and the Actions run goes
red (email from GitHub). The other orgs keep working — failures are isolated
per source. Fix lives in `scraper/src/{ncs,pac,pps}.js`.
