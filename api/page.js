// The indexable landing pages: /12u-baseball-tournaments/plano-tx and friends.
//
// The dashboard is one client-rendered file, which gave the whole site a single
// URL: nothing to link to for "12U baseball tournaments near Plano", one entry
// in the sitemap, and a shipped ItemList that declared zero events to every
// crawler that does not run JavaScript.
//
// This serves the same app with the head, the structured data and a real list
// of tournaments already filled in, so a crawler (and a reader on a slow
// connection) gets the answer in the HTML. The client boots as usual and takes
// the board over from there — it replaces #board wholesale on first render, so
// there is no hydration to reconcile.
import { readFile } from "node:fs/promises";
import {
  SITES, hostOf, METROS, metroBySlug, parseLandingPath, landingPath,
  fetchEvents, eventsFor, LANDING_RADIUS, esc, DIVISIONS, primaryFor, primaryMetros, isForced,
} from "./_shared.js";

const SSR_ROWS = 40;
let shellCache = null;
const shell = async () => (shellCache ??= await readFile(new URL("../site/index.html", import.meta.url), "utf8"));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso) => {
  const d = new Date(iso + "T12:00:00Z");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
const dateLine = (e) =>
  e.end_date && e.end_date !== e.start_date ? `${day(e.start_date)}–${day(e.end_date)}` : day(e.start_date);

const countFor = (e, age) => {
  const c = e.division_counts || {};
  if (age) return c[age] ?? e.total_registered ?? 0;
  return DIVISIONS.reduce((n, d) => n + (c[d] ?? 0), 0) || e.total_registered || 0;
};

function copy(site, { age, metro }, n) {
  const who = age ? `${age}` : "10U–14U";
  const where = metro ? `${metro.city}, ${metro.state}` : site.scope === "nationwide" ? "near you" : "in Texas & Oklahoma";
  const title = metro
    ? `${who} Baseball Tournaments near ${metro.city}, ${metro.state} — Open Brackets | ${site.brand}`
    : `${who} Baseball Tournaments — Open Brackets, Live Team Counts | ${site.brand}`;
  const description = metro
    ? `${n} ${who} select baseball tournaments with open brackets within ${LANDING_RADIUS} miles of ${metro.city}, ${metro.state}. Live team counts per age division, rechecked twice a day.`
    : `${who} select baseball tournaments with open brackets. Live team counts per age division from nine tournament organizers, rechecked twice a day.`;
  const heading = metro
    ? `${who} baseball tournaments near ${metro.city}, ${metro.state}`
    : `${who} baseball tournaments with open brackets`;
  return { title, description, heading, who, where };
}

// A plain list, styled by the board's own CSS. Replaced the moment the client
// renders, so it only has to be right for a crawler and a first paint.
function boardHTML(rows, age) {
  if (!rows.length) return "";
  return `<div data-ssr="1">` + rows.slice(0, SSR_ROWS).map((e) => {
    const div = age || DIVISIONS.find((d) => (e.divisions || []).includes(d));
    const where = [e.city, e.state].filter(Boolean).join(", ");
    return `<div class="row">
      <span class="when"><span class="dd">${esc(day(e.start_date).split(" ")[1])}</span><span class="dow" style="display:block">${esc(day(e.start_date).split(" ")[0])}</span></span>
      <span>
        <span class="name" style="display:block">${esc(e.name)}</span>
        <span class="rowmeta">${esc(e.org)}${where ? " · " + esc(where) : ""} · ${esc(dateLine(e))}</span>
      </span>
      <span class="count"><span class="n">${countFor(e, div)}</span><span class="u">${esc(div || "")} teams</span></span>
      <span class="distwrap"><span class="dist"></span></span>
    </div>`;
  }).join("") + `</div>`;
}

function itemListLD(rows, name) {
  const items = rows.slice(0, SSR_ROWS).map((e) => {
    const place = {
      "@type": "Place",
      name: e.venue || [e.city, e.state].filter(Boolean).join(", ") || "Venue to be announced",
      address: { "@type": "PostalAddress", addressLocality: e.city || undefined, addressRegion: e.state || undefined, addressCountry: "US" },
    };
    if (e.lat != null && e.lng != null) place.geo = { "@type": "GeoCoordinates", latitude: e.lat, longitude: e.lng };
    return {
      "@type": "SportsEvent", name: e.name, sport: "Baseball",
      startDate: e.start_date || undefined, endDate: e.end_date || e.start_date || undefined,
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      url: e.event_url || undefined, location: place,
      organizer: { "@type": "Organization", name: e.org },
    };
  });
  return JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList", name,
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, item })),
  });
}

// A sitemap tells a crawler these pages exist; links are how it actually walks
// between them, and how a reader gets from "12U near Dallas" to "13U near
// Dallas" without going through the filter sheet.
function relatedHTML(rows, target, primaries) {
  const here = target.metro;
  const ages = DIVISIONS.map((a) => ({
    label: `${a} tournaments${here ? ` near ${here.city}` : ""}`,
    href: landingPath(a, here),
    on: a === target.age,
  }));
  const places = primaries.slice(0, 8).map((m) => ({
    label: `${target.age || "Youth"} baseball near ${m.city}, ${m.state}`,
    href: landingPath(target.age, m),
    on: here && m.slug === here.slug,
  }));
  const list = (title, items) => `<div class="relgroup"><b>${esc(title)}</b><ul>${items
    .map((i) => i.on
      ? `<li><span aria-current="page">${esc(i.label)}</span></li>`
      : `<li><a href="${esc(i.href)}">${esc(i.label)}</a></li>`).join("")}</ul></div>`;
  return `<nav class="related" aria-label="Other tournament searches">
    ${list("By age", ages)}
    ${list("By place", places)}
  </nav>`;
}

export default async function handler(req, res) {
  const host = hostOf(req);
  const site = SITES[host];
  const base = `https://${host}`;
  const q = req.query || {};
  const target = parseLandingPath(`/${q.age || ""}-baseball-tournaments${q.metro ? "/" + q.metro : ""}`);

  if (!target) {
    res.setHeader("Location", "/");
    res.status(308).send("");
    return;
  }

  let rows = [], canonicalPath = target.path, primaries = [];
  try {
    const all = await fetchEvents();
    rows = eventsFor(all, target);
    // A suburb whose board is indistinguishable from its metro's points its
    // canonical there: the URL keeps working and stops competing with the page
    // it duplicates.
    const primary = primaryFor(all, target.metro);
    if (primary && primary.slug !== target.metro?.slug) canonicalPath = landingPath(target.age, primary);
    primaries = primaryMetros(all).map((k) => k.metro);
  } catch {
    // The shell still works — the client fetches its own data. Better a live
    // page with an empty server list than a 502 in front of a crawler.
  }

  const c = copy(site, target, rows.length);
  const url = base + canonicalPath;
  const ogImage = `${base}/${site.og}`;

  let html = await shell();
  html = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(c.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(c.description)}">`)
    .replace('<link rel="canonical" href="/">', `<link rel="canonical" href="${esc(url)}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(c.title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(c.description)}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(base + target.path)}">`)
    .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${esc(ogImage)}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${esc(c.title)}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(c.description)}">`)
    .replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${esc(ogImage)}">`)
    // Inserted, not substituted: the static markup deliberately ships no
    // ldEvents placeholder, because an empty ItemList tells a crawler the site
    // lists nothing.
    .replace("</head>", `<script type="application/ld+json" id="ldEvents">${
      itemListLD(rows, `Youth baseball tournaments ${target.metro ? "near " + target.metro.city : site.scope}`)
    }</script></head>`)
    .replace('<div id="board"></div>', `<div id="board">${boardHTML(rows, target.age)}</div>`)
    .replace("</footer>", `${relatedHTML(rows, target, primaries)}</footer>`);

  // A previewed brand canonicalises to the other domain, so it must not be
  // indexable on whichever host actually served it.
  if (isForced(req)) {
    html = html.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex, follow">');
  }

  // What the client needs to come up already filtered, without a geocode.
  const boot = {
    path: target.path, canonical: canonicalPath, age: target.age, radius: LANDING_RADIUS,
    title: c.title, description: c.description, heading: c.heading,
    loc: target.metro ? { label: `${target.metro.city}, ${target.metro.state}`, lat: target.metro.lat, lng: target.metro.lng } : null,
  };
  html = html.replace("<body>", `<body>\n<script>window.__LANDING=${JSON.stringify(boot).replace(/</g, "\\u003c")}</script>`);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=1800, stale-while-revalidate=86400");
  res.status(200).send(html);
}
