# BaseballTime / TourneyScan

Finds 10U through 14U tournaments with open brackets across Texas, Oklahoma and
their neighbours (the dashboard measures distance from any city or zip you
enter, defaulting to Sanger, TX) by scraping NCS (playncs.com, one region page
per state), PAC (playpacsports.com), the Playbook365 family
(PPS, 24 Sports, RBI, 2D Sports, Five Tool — one scraper, `playbook365.js`), USSSA
(usssa.com JSON API, statewide TX + OK), and Perfect Game (the national
RadGrid schedule, filtered to the states we want) twice
daily, storing results in Supabase (`tourneyscan` schema in the PickEm
project), and serving a filterable dashboard from `/site` on Vercel.

`NEARBY_STATES` in `scraper/src/index.js` is the one place the footprint is
set; NCS, Playbook365 and Perfect Game all take it. **Pass it to every source
you add** — Perfect Game silently fell back to a Texas-only default for months
because the call site omitted it.

## Layout

- `scraper/` — Node 22 scraper. `npm run dry` prints JSON without touching the
  DB; `npm run scrape` upserts events + daily registration snapshots.
  Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars.
- `.github/workflows/scrape.yml` — runs the scraper at 7 AM and 7 PM Central,
  plus manual runs via the Actions tab (workflow_dispatch).
- `site/` — static dashboard (no build step). Vercel Root Directory = `site`.
  Fonts are self-hosted in `site/fonts/` (seven latin-subset woff2 files);
  `vercel.json` serves them immutable for a year, so a re-export needs a new
  filename, not an overwrite. `site/icon.png` is the 2048px master and is
  excluded from deploys by `.vercelignore` — it is a source file, not an asset.
  Distance is computed in the browser from each event's lat/lng and the
  user's chosen location (zip via Zippopotam, city via Open-Meteo); the
  scraper's `distance_miles` column is Sanger-based and only used for the
  run log's qualifying summary.
  The install prompt waits for a second visit *and* for a scroll or a tap on the
  board: it used to appear 2.5s into a first visit, as a fixed bar over the rows
  the reader had just arrived to read.
  Installable as a home-screen app: `manifest.webmanifest`, `sw.js` (shell
  cache only; data is always live), and the icon PNGs derived from
  `icon.png` (the 2048px master; also the masthead logo at 192px). If the
  artwork changes, re-export icon-512 / icon-192 / apple-touch-icon (180)
  and icon-512-maskable (78% inset on flat navy for Android's crop), then
  bump `CACHE` in `sw.js`.

## What the page costs to open

The board is the only thing a reader is waiting for, so nothing else is allowed
in front of it.

- **No third-party JavaScript on the critical path.** supabase-js was 54 KB from
  a CDN that had to load, parse and construct a client before the first query
  could be built. The page speaks to PostgREST directly (`from()` / `rpc()` at
  the top of the app script) — the same chainable shape, about forty lines.
- **Only the columns the page reads.** `select("*")` shipped 443 KB per load, a
  third of it columns nothing rendered. `EVENT_COLS` names the seventeen that
  are used; `class_counts` is 72 KB wanted by one card, so the hero fetches it
  for its own event the way sparkline history does.
- **Fonts come from this origin.** The Google Fonts stylesheet was a
  render-blocking request to a third party, which then pointed at a fourth.
- **A returning reader gets their board back before the network answers.** The
  last response is kept in `localStorage` and painted immediately; the masthead's
  scrape time is drawn from those same rows, so a stale board says so. A first
  visit gets skeleton rows — the page used to sit empty, which on a phone meant
  the first thing on screen was the footer's small print.
- **Leaflet and its tiles wait for idle**, even on the board, where the detail
  rail wants a mini-map.

## The dashboard

`site/index.html` is the whole front end — one file, no build step, same as
before. It runs four client-side views off a single Supabase load:

- **Board** — a "best bet" hero (the soonest *weekend-length* event that clears
  your team floor, nearest first among ties), then date-grouped rows, then a
  detail rail. The rail is a permanent column above 1100px and a tap-to-open
  bottom sheet below it.
- **Map** — the same filtered set as pins, plus a nearest-first list. Leaflet is
  loaded from a CDN only once something actually needs it. That is not only the
  Map view: above 1100px the detail rail carries a mini-map, so the board pulls
  it too — deferred to `requestIdleCallback` there, so the list and its data go
  first and the map fills in behind them.
- **Saved** — none → watching → registered, kept per device. Registered rows get
  a countdown, directions and season totals.
- **Players** — unchanged logic, restyled.

Filters live in a modal sheet whose primary button previews the result count
before you apply it. Everything (filters, players, saved) stays in
`localStorage` and is never sent anywhere.

**Light and dark.** The Scoreboard palette is the dark one and the design's
authority; light mode reuses the colours of the previous build, lifted from the
logo (pale ice ground, navy ink, feather blue), remapped onto the same
structure. It exists because the app gets used standing at a ballfield in full
Texas sun, where a dark screen is at its worst. With no stored choice the page
follows `prefers-color-scheme` and keeps tracking it; the masthead toggle sets
an explicit preference that wins from then on. A script in `<head>` applies the
theme before first paint so there is no flash.

Colours that JavaScript resolves rather than CSS — map pins, the sparkline ramp,
the tile filter — are declared as custom properties and read with `cssVar()`, so
each theme has exactly one definition.

**Every text colour clears 4.5:1 against every ground it lands on**, checked
against the actual card, rail and chip backgrounds rather than just the page.
`--text-4` used to measure 3.66 on cards, and it carries 12–13px type: the
eyebrows, the month tallies, and the whole footer explaining what the counts
mean. `--dim`, which steps a below-minimum row back, stops at the point where
the dimmed text still passes — a row under your floor should recede, not become
unreadable. Retune these with a contrast checker, not by eye.

## URLs, and the pages search engines can find

The dashboard used to live at exactly one address. A search could not be linked
to, Share sent people to an unfiltered board, and the sitemap had a single
entry — so there was nothing to rank for "12U baseball tournaments near Plano",
which is the query this site exists to answer.

**Landing pages** are the indexable URLs: `/12u-baseball-tournaments/plano-tx`,
`/14u-baseball-tournaments`, `/youth-baseball-tournaments/dallas-tx`.
`api/page.js` serves them — the same `site/index.html`, with the title,
description, canonical, `SportsEvent` `ItemList` and forty real tournament rows
already in the HTML, plus links to the neighbouring age and place pages. A
crawler that runs no JavaScript gets the answer; the client boots and takes the
board over, replacing `#board` wholesale, so there is no hydration to reconcile.
`window.__LANDING` carries the resolved place, so the page comes up filtered
without a geocoding round trip.

**Which places get a page** is curated, in `METROS` in `api/_shared.js`, not
derived from the data. The scraped `city` field holds multi-venue listings
("Arlington, Bedford, Grapevine, Mesquite"), metro labels ("DFW Metroplex") and
whichever small town hosted a tournament, so ranking cities by event count
nominates Millsap and spells the DFW page as a four-town slug. `METROS` is
ordered by market prominence because `primaryMetros()` folds near-duplicates
into the first match: at a 50-mile radius, Plano and Frisco and Irving list
almost exactly Dallas's tournaments, and publishing all of them is the thin-
duplicate pattern search engines exist to filter. Those URLs still work and
still show the right board — they set their canonical to the metro they
duplicate and stay out of the sitemap. Nine distinct markets survive today, so
`/sitemap.xml` carries 60 URLs rather than 292 near-copies.

**Everything else is a query string.** `/?ages=11U,12U&miles=25&near=Waco,+TX…`
round-trips every filter, so any search can be copied out of the address bar.
There are far too many combinations to index, so they canonicalise back and
carry `noindex`. The URL only leaves its clean landing form once the board
actually stops matching what that page promised — every filter counts, not just
the two the path names. A crawler carries no stored filters, so it always sees
the clean URL.

## Two domains

The same deployment answers on both `youthbaseballtime.com` (national) and
`youthbaseballtimeintx.com` (Texas and Oklahoma). Both must be aliased to this
Vercel project for any of the below to work.

They serve identical data, so for search they have to differ in everything
else or Google will treat one as a duplicate of the other and index only one.
The `SITES` map at the top of the app script is the whole difference: brand,
title, description, `h1`, Open Graph image, structured-data `areaServed`, geo
meta, and the starting radius (150 mi national, 80 mi Texas). Add a domain by
adding an entry.

- **Canonical URLs come from the site's own `host` field, never
  `location.hostname`** — otherwise a preview deploy canonicalises to itself and
  can get indexed in place of the real site. The static `<link rel="canonical"
  href="/">` is relative so each domain self-canonicalises even before scripts
  run; `applySEO()` then makes it absolute.
- **`?site=tx` forces a brand** on localhost or a `vercel.app` preview, where
  the real hostname isn't available to switch on.
- **`robots.txt`, `sitemap.xml` and `/app.webmanifest` are generated per
  request** by `api/seo.js` from the `Host` header, because a static file can
  only name one domain. The manifest moved off `manifest.webmanifest` so no
  static file shadows the rewrite — Vercel resolves the filesystem before
  rewrites, which is also why `/` cannot be routed through a function while
  `site/index.html` exists. `<lastmod>` reports the newest scrape, not the
  deploy.

- **Every asset reference is root-relative.** The same document is served from
  `/12u-baseball-tournaments/plano-tx`, where `icon-192.png` would resolve
  inside that directory; the service worker registers with an explicit `/`
  scope for the same reason.
- **Structured data**: `Organization`, `WebSite` and `WebPage` ship in the
  markup (Bing and social scrapers run JavaScript poorly) and are rewritten per
  host; every listed tournament is emitted as a `SportsEvent` in an `ItemList`,
  which is the part search engines can turn into a rich result. Entry-fee
  `offers` are omitted rather than guessed when an organizer doesn't publish one.
  The markup ships **no** `ItemList` placeholder: an empty one told every
  crawler that does not run JavaScript that the site lists zero events. Landing
  pages have theirs filled in by `api/page.js`; the plain home page's is created
  by the client once it has data.
- **Open Graph images** live at `site/og.png` and `site/og-tx.png`, 1200×630.
  They were drawn on a canvas and saved through the dev server's `/save`
  endpoint; re-run that snippet if the branding changes.

**The national domain is ahead of the data.** Coverage is Texas-heavy by an
order of magnitude, so national queries land on a board with nothing in range
until the scraper widens. Perfect Game already downloads the whole national grid
and throws away everything outside `states`, so unfiltering it is close to free;
NCS has a region page per state and `REGIONS` in `ncs.js` already lists all
twenty, so it only needs states added to `NEARBY_STATES`; USSSA needs its full
state→ID map in `scraper/src/usssa.js`; the rest (PAC, PPS, 24 Sports, RBI,
Five Tool) are regional operators that will stay Texas-heavy whatever we do.

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
  minutes are omitted instead of estimated. "Use my location" hands the browser
  coordinates straight to the filter and labels them "My location" — there is no
  key-free reverse geocoder worth a dependency, and inventing a place name would
  be worse than naming none.

- **Only about a third of events publish a venue.** With one, Directions
  searches Maps by name and lands on the field. Without one, a text search for
  "Denton, TX" drops you downtown, so the link carries the coordinates instead,
  and the detail rail says the organizer hasn't published the field. The
  distance is measured from the same point either way.

- **The "best bet" card only picks an event with an exact count for your age.**
  An org that publishes no per-age split is judged on its all-ages total, so a
  PAC event with forty teams across every age clears a 3-team 14U floor with
  nobody in 14U. That is fine for a row marked `≈`; it is not fine for the one
  card the page puts its name behind.
- **Entry fees** are published by only about a sixth of events, so the fee is
  dropped from a row when missing and the season total says how many of the
  registered events actually published one.
- **The calendar subscription** covers events matching your current search, not
  your registered list — registered state is device-local, and a webcal URL is
  fixed at subscribe time, so it could never track it. The URL carries every
  parameter that moves the board, `hide` and `win` included: a floor that only
  dims rows on screen must not delete them from the calendar.

- **Delisted events are dropped on read, not deleted.** Nothing removes a row
  when an organizer pulls an event, so the board, the calendar and the alert
  digest each filter out anything more than three days behind *its own org's*
  newest `last_seen`. Per-org is the important part: judged against the newest
  row overall, a single broken parser would erase that organizer from the site
  three days later. Judged per org, its rows age together and all survive.

- **PostgREST truncates every response at 1000 rows** and says so only in a
  `Content-Range` header, so an unpaged `.select()` loses data silently as
  coverage grows. Every query that can exceed that pages explicitly, ordered by
  a unique tiebreak — paging a non-unique sort drops and duplicates rows.

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

Which domain an alert names is per-signup, not global: the dashboard records its
own host in the subscription's `filters` blob, and the confirmation email, the
unsubscribe link, the subject line and the sign-off are all built from it.
`/confirm` and `/unsubscribe` brand themselves from the `Host` they were opened
on for the same reason. `ALERT_SITE` is only the fallback for signups made
before that field existed.

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
