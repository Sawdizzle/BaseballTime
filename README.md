# BaseballTime / TourneyScan

Finds 10U through 14U tournaments with open brackets anywhere in Texas and
Oklahoma (the dashboard measures distance from any city or zip you enter,
defaulting to Sanger, TX) by scraping NCS
(playncs.com), PAC (playpacsports.com), the Playbook365 family
(PPS, 24 Sports, RBI, 2D Sports, Five Tool — one scraper, `playbook365.js`), USSSA
(usssa.com JSON API, statewide TX + OK), and Perfect Game (the national
RadGrid schedule, filtered to the states we want) twice
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

## The dashboard

`site/index.html` is the whole front end — one file, no build step, same as
before. It runs four client-side views off a single Supabase load:

- **Board** — a "best bet" hero (the soonest *weekend-length* event that clears
  your team floor, nearest first among ties), then date-grouped rows, then a
  detail rail. The rail is a permanent column above 1100px and a tap-to-open
  bottom sheet below it.
- **Map** — the same filtered set as pins, plus a nearest-first list. Leaflet is
  loaded from a CDN only when the view is first opened, so the board never pays
  for it.
- **Saved** — none → watching → registered, kept per device. Registered rows get
  a countdown, directions and season totals.
- **Players** — unchanged logic, restyled.

Filters live in a modal sheet whose primary button previews the result count
before you apply it. Everything (filters, players, saved) stays in
`localStorage` and is never sent anywhere.

### Design decisions worth knowing

- **Map tiles** are plain OpenStreetMap, inverted and desaturated in CSS to sit
  on the dark palette. Every hosted dark style (CARTO, Mapbox, Stadia,
  MapTiler) now needs an API key. If traffic outgrows OSM's tile policy, swap
  `TILES` for a keyed provider and drop the `.leaflet-tile-pane` filter.
- **Sparklines** need six weekly snapshots per event. `registration_snapshots`
  only started filling on 2026-09-02, so they render nothing until an event has
  six weeks of history — by design, rather than drawing a fake trend. They are
  fetched per event (hero and watched events only), so they never hit the
  1000-row API cap.
- **Distances are straight-line**, not driving miles. The design called for
  "18 mi · 27 min"; drive time needs a routing provider we don't have, so the
  minutes are omitted instead of estimated.
- **Entry fees** are published by only about a sixth of events, so the fee is
  dropped from a row when missing and the season total says how many of the
  registered events actually published one.
- **The calendar subscription** covers events matching your current search, not
  your registered list — registered state is device-local, and a webcal URL is
  fixed at subscribe time, so it could never track it.

## How counts work

NCS, PPS, USSSA, and Perfect Game events get exact per-division team counts (10U–14U, stored
in `events.division_counts`) from each event's public team listing (Who's
Coming / division count pills). `teams_14u` is kept in sync for 14U. PAC
doesn't publish team lists, so PAC rows carry the total across all ages and
show ≈ on the dashboard. Tracked divisions live in `scraper/src/util.js`
(`TRACKED_DIVISIONS`); the dashboard's Age picker mirrors that list.

## Email alerts

Readers can ask to be emailed when a **new** tournament matches the search they
have on screen. Nothing is sent when there is nothing new.

- `site/index.html` posts to the `tourneyscan.request_alerts` Postgres function.
  That function is `SECURITY DEFINER`; the table itself is revoked from `anon`,
  so the public key can create a pending signup but can never read an address
  back out.
- Double opt-in. The confirmation token only ever travels inside the email.
  `/confirm` and `/unsubscribe` (see `api/alerts.js`) call the matching
  functions. Every email carries the unsubscribe link.
- `scraper/src/alerts.js` runs right after each scrape. It sends confirmations
  to new signups, then a digest to confirmed subscribers who are due (daily is
  20 h, weekly is 6.5 days), listing only events whose `first_seen` is newer
  than that subscriber's last email.

**Setup, one manual step.** The step is wired but dormant until a Resend key
exists. It logs "RESEND_API_KEY not set — skipping" and exits 0, so the workflow
stays green.

1. Create a Resend account and verify `youthbaseballtime.com` by adding the DNS
   records it gives you.
2. Add the key as a repo secret:
   `gh secret set RESEND_API_KEY`
3. Optional overrides, as repo secrets or env vars: `ALERT_FROM` (defaults to
   `alerts@youthbaseballtime.com`), `ALERT_REPLY_TO`, `ALERT_SITE`.

Until the domain is verified Resend rejects every send with a 403 naming the
domain, so step 1 is not optional. To test before the DNS propagates, set
`ALERT_FROM` to `Baseball Time <onboarding@resend.dev>`; Resend accepts that
sender but only delivers to the account owner's address. Remove the override
once the domain is verified.

A failed confirmation is not lost: `confirm_sent_at` is only stamped on success,
so the next run retries, bounded to signups from the last seven days.

## When it breaks

If a site redesigns, that org's parser fails loudly and the Actions run goes
red (email from GitHub). The other orgs keep working — failures are isolated
per source. Fix lives in `scraper/src/{ncs,pac,playbook365,usssa,pg}.js`.
