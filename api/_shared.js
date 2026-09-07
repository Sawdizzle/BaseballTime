// Shared by api/page.js and api/seo.js. The leading underscore keeps Vercel
// from treating it as a route.

export const SUPABASE_URL = "https://yeykyutsbeqjcgdxlucn.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_SLM96UPQ3Rgrf6MTpXRZUQ_LklkFhPH";

export const SITES = {
  "youthbaseballtime.com": {
    key: "national",
    brand: "Baseball Time",
    scope: "nationwide",
    og: "og.png",
    areaServed: [{ "@type": "Country", name: "United States" }],
  },
  "youthbaseballtimeintx.com": {
    key: "tx",
    brand: "Baseball Time in TX",
    scope: "across Texas and Oklahoma",
    og: "og-tx.png",
    areaServed: [
      { "@type": "State", name: "Texas" },
      { "@type": "State", name: "Oklahoma" },
    ],
  },
};
export const FALLBACK_HOST = "youthbaseballtime.com";

// ?site=tx forces a brand, mirroring the client's FORCED handling, because a
// preview deploy and localhost answer on a hostname we do not own. Without the
// server honouring it too, a previewed landing page rendered a national title
// around a Texas h1 and canonical.
export function hostOf(req) {
  const forced = String(req.query?.site || "");
  if (forced) {
    const hit = Object.keys(SITES).find((h) => SITES[h].key === forced);
    if (hit) return hit;
  }
  const raw = String(req.headers["x-forwarded-host"] || req.headers.host || FALLBACK_HOST);
  const host = raw.split(",")[0].trim().split(":")[0].replace(/^www\./, "").toLowerCase();
  return SITES[host] ? host : FALLBACK_HOST;
}

// A forced-brand URL points its canonical at the other domain, so it must never
// be indexable on whichever host actually served it.
export const isForced = (req) => Boolean(String(req.query?.site || ""));

export const DIVISIONS = ["10U", "11U", "12U", "13U", "14U"];

/* ---------------------------------------------------------------------------
   Landing pages.

   Curated rather than derived from the data. The scraped city field carries
   multi-venue listings ("Arlington, Bedford, Grapevine, Mesquite"), metro
   labels ("DFW Metroplex") and whichever small town happened to host a
   tournament, so ranking cities by event count nominates Millsap and Chouteau
   and spells the DFW page as a four-town slug. These are the places people
   actually type, with coordinates resolved once so a page never depends on a
   geocoding call. A metro only reaches the sitemap if it has events in range.
   --------------------------------------------------------------------------- */
export const METROS = [
  { slug: "dallas-tx", city: "Dallas", state: "TX", lat: 32.7831, lng: -96.8067 },
  { slug: "fort-worth-tx", city: "Fort Worth", state: "TX", lat: 32.7254, lng: -97.3208 },
  { slug: "houston-tx", city: "Houston", state: "TX", lat: 29.7633, lng: -95.3633 },
  { slug: "san-antonio-tx", city: "San Antonio", state: "TX", lat: 29.4241, lng: -98.4936 },
  { slug: "austin-tx", city: "Austin", state: "TX", lat: 30.2672, lng: -97.7431 },
  { slug: "oklahoma-city-ok", city: "Oklahoma City", state: "OK", lat: 35.4676, lng: -97.5164 },
  { slug: "tulsa-ok", city: "Tulsa", state: "OK", lat: 36.154, lng: -95.9928 },
  { slug: "el-paso-tx", city: "El Paso", state: "TX", lat: 31.7587, lng: -106.4869 },
  { slug: "waco-tx", city: "Waco", state: "TX", lat: 31.5493, lng: -97.1467 },
  { slug: "corpus-christi-tx", city: "Corpus Christi", state: "TX", lat: 27.8006, lng: -97.3964 },
  { slug: "lubbock-tx", city: "Lubbock", state: "TX", lat: 33.5779, lng: -101.8552 },
  { slug: "amarillo-tx", city: "Amarillo", state: "TX", lat: 35.222, lng: -101.8313 },
  { slug: "college-station-tx", city: "College Station", state: "TX", lat: 30.628, lng: -96.3344 },
  { slug: "tyler-tx", city: "Tyler", state: "TX", lat: 32.3513, lng: -95.3011 },
  { slug: "killeen-tx", city: "Killeen", state: "TX", lat: 31.1171, lng: -97.7278 },
  { slug: "beaumont-tx", city: "Beaumont", state: "TX", lat: 30.0861, lng: -94.1018 },
  { slug: "midland-tx", city: "Midland", state: "TX", lat: 31.9974, lng: -102.0779 },
  { slug: "odessa-tx", city: "Odessa", state: "TX", lat: 31.8457, lng: -102.3676 },
  { slug: "abilene-tx", city: "Abilene", state: "TX", lat: 32.4487, lng: -99.7331 },
  { slug: "longview-tx", city: "Longview", state: "TX", lat: 32.5007, lng: -94.7405 },
  { slug: "wichita-falls-tx", city: "Wichita Falls", state: "TX", lat: 33.9137, lng: -98.4934 },
  { slug: "round-rock-tx", city: "Round Rock", state: "TX", lat: 30.5083, lng: -97.6789 },
  { slug: "sherman-tx", city: "Sherman", state: "TX", lat: 33.6357, lng: -96.6089 },
  { slug: "temple-tx", city: "Temple", state: "TX", lat: 31.0982, lng: -97.3428 },
  { slug: "victoria-tx", city: "Victoria", state: "TX", lat: 28.8053, lng: -97.0036 },
  { slug: "new-braunfels-tx", city: "New Braunfels", state: "TX", lat: 29.703, lng: -98.1244 },
  { slug: "san-marcos-tx", city: "San Marcos", state: "TX", lat: 29.8833, lng: -97.9414 },
  { slug: "norman-ok", city: "Norman", state: "OK", lat: 35.2226, lng: -97.4395 },
  { slug: "edmond-ok", city: "Edmond", state: "OK", lat: 35.6528, lng: -97.4781 },
  { slug: "broken-arrow-ok", city: "Broken Arrow", state: "OK", lat: 36.0526, lng: -95.7908 },
  { slug: "moore-ok", city: "Moore", state: "OK", lat: 35.3395, lng: -97.4867 },
  { slug: "lawton-ok", city: "Lawton", state: "OK", lat: 34.6087, lng: -98.3903 },
  { slug: "stillwater-ok", city: "Stillwater", state: "OK", lat: 36.1156, lng: -97.0584 },
  { slug: "ardmore-ok", city: "Ardmore", state: "OK", lat: 34.1743, lng: -97.1436 },
  { slug: "owasso-ok", city: "Owasso", state: "OK", lat: 36.2695, lng: -95.8547 },
  { slug: "conroe-tx", city: "Conroe", state: "TX", lat: 30.3119, lng: -95.4561 },
  { slug: "the-woodlands-tx", city: "The Woodlands", state: "TX", lat: 30.158, lng: -95.4894 },
  { slug: "katy-tx", city: "Katy", state: "TX", lat: 29.7858, lng: -95.8244 },
  { slug: "sugar-land-tx", city: "Sugar Land", state: "TX", lat: 29.6197, lng: -95.635 },
  { slug: "plano-tx", city: "Plano", state: "TX", lat: 33.0198, lng: -96.6989 },
  { slug: "frisco-tx", city: "Frisco", state: "TX", lat: 33.1507, lng: -96.8236 },
  { slug: "mckinney-tx", city: "McKinney", state: "TX", lat: 33.1976, lng: -96.6153 },
  { slug: "allen-tx", city: "Allen", state: "TX", lat: 33.1032, lng: -96.6706 },
  { slug: "arlington-tx", city: "Arlington", state: "TX", lat: 32.7357, lng: -97.1081 },
  { slug: "irving-tx", city: "Irving", state: "TX", lat: 32.814, lng: -96.9489 },
  { slug: "garland-tx", city: "Garland", state: "TX", lat: 32.9126, lng: -96.6389 },
  { slug: "mesquite-tx", city: "Mesquite", state: "TX", lat: 32.7668, lng: -96.5992 },
  { slug: "denton-tx", city: "Denton", state: "TX", lat: 33.2148, lng: -97.1331 },
  { slug: "grapevine-tx", city: "Grapevine", state: "TX", lat: 32.9343, lng: -97.0781 },
  { slug: "waxahachie-tx", city: "Waxahachie", state: "TX", lat: 32.3865, lng: -96.8483 },
];
export const metroBySlug = new Map(METROS.map((m) => [m.slug, m]));

// One age, one place, or both. Anything else is not a landing page.
//   /12u-baseball-tournaments
//   /12u-baseball-tournaments/plano-tx
//   /youth-baseball-tournaments/plano-tx
export function parseLandingPath(pathname) {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (!parts[0] || parts.length > 2) return null;
  const m = parts[0].match(/^(?:(\d{2})u|youth)-baseball-tournaments$/);
  if (!m) return null;
  const age = m[1] ? `${m[1]}U` : null;
  if (age && !DIVISIONS.includes(age)) return null;
  const metro = parts[1] ? metroBySlug.get(parts[1]) : null;
  if (parts[1] && !metro) return null;
  if (!age && !metro) return null;   // /youth-baseball-tournaments alone is just the home page
  return { age, metro, path: "/" + parts.join("/") };
}

export const landingPath = (age, metro) =>
  `/${age ? age.toLowerCase() : "youth"}-baseball-tournaments${metro ? "/" + metro.slug : ""}`;

const R = 3958.8, toR = (d) => (d * Math.PI) / 180;
export function miles(a, b) {
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Delisted events, per org, exactly as the dashboard judges them.
const STALE_MS = 3 * 86400e3;
export function dropDelisted(rows) {
  const newestByOrg = new Map();
  for (const e of rows) {
    const t = Date.parse(e.last_seen) || 0;
    if (t > (newestByOrg.get(e.org) || 0)) newestByOrg.set(e.org, t);
  }
  return rows.filter((e) => (Date.parse(e.last_seen) || 0) >= (newestByOrg.get(e.org) || 0) - STALE_MS);
}

const API_PAGE = 1000;
const COLS = "id,org,name,city,state,venue,lat,lng,start_date,end_date,divisions,division_counts,total_registered,cost,event_url,last_seen";

// PostgREST truncates at 1000 rows and reports it only in Content-Range.
export async function fetchEvents() {
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  for (let n = 0; ; n += API_PAGE) {
    const url = `${SUPABASE_URL}/rest/v1/events?select=${COLS}&end_date=gte.${today}&order=start_date.asc,id.asc`;
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Accept-Profile": "tourneyscan",
        Range: `${n}-${n + API_PAGE - 1}`,
      },
    });
    if (!r.ok) throw new Error(`${r.status} from Supabase`);
    const batch = await r.json();
    out.push(...batch);
    if (batch.length < API_PAGE) return dropDelisted(out);
  }
}

// The events a landing page is about: in the age (if any), within radius.
// 50 miles keeps "near Plano" honest — at 75 the circle reached Fort Worth and
// every Metroplex page listed the same tournaments.
export const LANDING_RADIUS = 50;
export function eventsFor(rows, { age, metro }) {
  return rows.filter((e) => {
    if (age && !(e.divisions || []).includes(age)) return false;
    if (!age && !(e.divisions || []).some((d) => DIVISIONS.includes(d))) return false;
    if (metro) {
      if (e.lat == null || e.lng == null) return false;
      if (miles(metro, { lat: +e.lat, lng: +e.lng }) > LANDING_RADIUS) return false;
    }
    return true;
  });
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------------------------------------------------------------------
   Which metros deserve their own indexed page.

   The data is heavily concentrated: a circle around Plano and a circle around
   Frisco hold almost the same tournaments, and publishing both as separate
   pages is the thin-duplicate pattern search engines exist to filter out. So a
   metro is "primary" only if its event set is meaningfully different from every
   more prominent metro already kept — METROS is ordered by prominence for
   exactly this, so Dallas survives and its suburbs fold into it.

   A folded metro's URL still works and still shows the right board; it just
   points its canonical at the page it duplicates and stays out of the sitemap.
   --------------------------------------------------------------------------- */
const MIN_EVENTS = 12;
const OVERLAP = 0.8;

export function primaryMetros(rows) {
  const kept = [];
  for (const m of METROS) {
    const set = new Set(eventsFor(rows, { age: null, metro: m }).map((e) => e.id));
    if (set.size < MIN_EVENTS) continue;
    const twin = kept.find((k) => {
      let n = 0;
      for (const id of set) if (k.set.has(id)) n++;
      return n / Math.min(set.size, k.set.size) > OVERLAP;
    });
    if (twin) twin.folds.push(m);
    else kept.push({ metro: m, set, folds: [] });
  }
  return kept;
}

// The metro whose page this one's canonical should point at — itself when primary.
export function primaryFor(rows, metro) {
  if (!metro) return null;
  for (const k of primaryMetros(rows)) {
    if (k.metro.slug === metro.slug) return k.metro;
    if (k.folds.some((f) => f.slug === metro.slug)) return k.metro;
  }
  return metro;
}
