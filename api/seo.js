// GET /robots.txt, /sitemap.xml, /manifest.webmanifest
//
// The same app answers on two domains — youthbaseballtime.com (national) and
// youthbaseballtimeintx.com (Texas and Oklahoma) — and each needs to name
// itself, not the other. Static files in site/ can only carry one hostname, so
// these three are generated per request from the Host header. Cached hard at
// the edge, since the answer only changes when a scrape lands.
import { DIVISIONS, fetchEvents, eventsFor, landingPath, primaryMetros } from "./_shared.js";

const SUPABASE_URL = "https://yeykyutsbeqjcgdxlucn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_SLM96UPQ3Rgrf6MTpXRZUQ_LklkFhPH";

// Below this a landing page has nothing worth ranking for, so it stays out of
// the sitemap. It still resolves if someone follows a link to it — a thin page
// is fine to serve and bad to advertise.
const MIN_EVENTS = 3;

const SITES = {
  "youthbaseballtime.com": {
    name: "Baseball Time",
    short: "Baseball Time",
    description: "Find 10U-14U select baseball tournaments with open brackets. Live team counts per age division, rechecked twice a day.",
  },
  "youthbaseballtimeintx.com": {
    name: "Baseball Time in TX",
    short: "Baseball Time",
    description: "Find 10U-14U select baseball tournaments with open brackets across North Texas and Oklahoma. Live team counts per age division, rechecked twice a day.",
  },
};
const FALLBACK = "youthbaseballtime.com";

function hostOf(req) {
  const raw = String(req.headers["x-forwarded-host"] || req.headers.host || FALLBACK);
  const host = raw.split(",")[0].trim().split(":")[0].replace(/^www\./, "").toLowerCase();
  // Preview deploys and localhost answer as the national brand rather than
  // inventing a hostname we do not own.
  return SITES[host] ? host : FALLBACK;
}

// The newest successful scrape, so <lastmod> reflects the data rather than the
// deploy. Failures fall back to today: a wrong-but-recent date is better than
// telling a crawler the page is stale.
async function lastScrape() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/events?select=last_seen&order=last_seen.desc&limit=1`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Accept-Profile": "tourneyscan" },
    });
    if (!r.ok) return null;
    const [row] = await r.json();
    return row?.last_seen ? new Date(row.last_seen).toISOString() : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const host = hostOf(req);
  const site = SITES[host];
  const base = `https://${host}`;
  const kind = String(req.query?.kind || "robots");

  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");

  if (kind === "robots") {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send([
      "User-agent: *",
      "Allow: /",
      // Serverless endpoints are plumbing, and the confirm/unsubscribe links
      // carry single-use tokens that must never end up in an index.
      "Disallow: /api/",
      "Disallow: /confirm",
      "Disallow: /unsubscribe",
      "",
      `Sitemap: ${base}/sitemap.xml`,
      "",
    ].join("\n"));
    return;
  }

  if (kind === "sitemap") {
    const lastmod = (await lastScrape()) || new Date().toISOString();
    const urls = [{ loc: `${base}/`, priority: "1.0" }];

    // One entry per landing page that currently has something to show. Built
    // from the live data so a metro drops out of the index when its season
    // ends rather than sitting there as an empty page.
    try {
      const rows = await fetchEvents();
      // Only metros that are not near-duplicates of a bigger one; the folded
      // suburbs canonicalise into these rather than competing with them.
      const primaries = primaryMetros(rows).map((k) => k.metro);
      for (const age of [null, ...DIVISIONS]) {
        if (age && eventsFor(rows, { age, metro: null }).length >= MIN_EVENTS) {
          urls.push({ loc: base + landingPath(age, null), priority: "0.8" });
        }
        for (const metro of primaries) {
          if (eventsFor(rows, { age, metro }).length >= MIN_EVENTS) {
            urls.push({ loc: base + landingPath(age, metro), priority: age ? "0.7" : "0.6" });
          }
        }
      }
    } catch {
      // A Supabase hiccup should not empty the sitemap; the home page still ships.
    }

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map(({ loc, priority }) =>
        `  <url>\n` +
        `    <loc>${loc}</loc>\n` +
        `    <lastmod>${lastmod}</lastmod>\n` +
        `    <changefreq>daily</changefreq>\n` +
        `    <priority>${priority}</priority>\n` +
        `  </url>\n`).join("") +
      `</urlset>\n`
    );
    return;
  }

  if (kind === "manifest") {
    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    res.status(200).send(JSON.stringify({
      name: site.name,
      short_name: site.short,
      description: site.description,
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "any",
      background_color: "#080d15",
      theme_color: "#080d15",
      icons: [
        { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    }, null, 2));
    return;
  }

  res.status(404).send("not found");
}
