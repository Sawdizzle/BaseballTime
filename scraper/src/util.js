export const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) TourneyScan/1.0";
export const SANGER = { lat: 33.3632, lng: -97.1739 };
export const SANGER_ZIP = "76266";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Parse NCS-style "Sep 12-13", "Aug 28 - Nov 15", "Jun 7" (no year given), or
// "Feb 27-28, 2027" (NCS adds the year once the event is in the next year).
export function parseNcsDates(text, now = new Date()) {
  const t = text.trim();
  const m = t.match(/^([A-Za-z]{3})\w*\s+(\d{1,2})(?:\s*-\s*(?:([A-Za-z]{3})\w*\s+)?(\d{1,2}))?(?:,\s*(\d{4}))?/);
  if (!m) return { start: null, end: null };
  const sm = MONTHS[m[1].toLowerCase()];
  const sd = parseInt(m[2], 10);
  const em = m[3] ? MONTHS[m[3].toLowerCase()] : sm;
  const ed = m[4] ? parseInt(m[4], 10) : sd;
  if (!sm) return { start: null, end: null };
  const explicitYear = m[5] ? parseInt(m[5], 10) : null;
  let year = explicitYear ?? now.getFullYear();
  let end = new Date(Date.UTC(year, em - 1, ed));
  // No year given: listings are upcoming events, so if it ended >45 days ago
  // it must be next year.
  if (!explicitYear && end.getTime() < now.getTime() - 45 * 86400e3) { year += 1; end = new Date(Date.UTC(year, em - 1, ed)); }
  const start = new Date(Date.UTC(em < sm ? year : year, sm - 1, sd)); // em<sm means wraps year; start stays this year
  const iso = (d) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

// Parse "10/30 - 11/01/2026" or "08-24-2026 - 11-01-2026" (PPS / PAC styles).
export function parseSlashDates(text) {
  const t = text.trim();
  let m = t.match(/(\d{2})[\/\-](\d{2})(?:[\/\-](\d{4}))?\s*-\s*(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (m) {
    const endY = m[6];
    const startY = m[3] || endY;
    return { start: `${startY}-${m[1]}-${m[2]}`, end: `${endY}-${m[4]}-${m[5]}` };
  }
  m = t.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (m) return { start: `${m[3]}-${m[1]}-${m[2]}`, end: `${m[3]}-${m[1]}-${m[2]}` };
  return { start: null, end: null };
}

export function haversineMiles(a, b) {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)) * 10) / 10;
}

// Full US map: the geocoder matches Open-Meteo's admin1 (state) name, so any
// state missing here silently loses its distance. Needed for going national.
const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// Metro-area labels that aren't real place names. DFW → roughly the metro
// centre (DFW Airport), which is what a "DFW locations" event means in practice.
const CITY_ALIASES = {
  "DFW|TX": { lat: 32.8998, lng: -97.0403 },
  "DFW METROPLEX|TX": { lat: 32.8998, lng: -97.0403 },
  "MWC|OK": { lat: 35.4495, lng: -97.3967 }, // Midwest City
};

// Geocode a city via Open-Meteo (free, no key). Returns {lat,lng} or null.
export async function geocodeCity(city, state) {
  const wantAdmin = STATE_NAMES[state] || state;
  // Multi-city listings ("Red Oak / Ferris / Lancaster") — try each segment
  // until one resolves in the right state. Never fall back to a match in a
  // different state (a "Lancaster" in California is worse than no answer).
  const segments = city
    .replace(/\s+area$/i, "")
    .replace(/\([^)]*\)/g, "")
    .split(/[\/,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const seg of segments) {
    const alias = CITY_ALIASES[`${seg.toUpperCase()}|${state}`];
    if (alias) return alias;
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(seg)}&count=10&language=en&format=json`;
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const data = await res.json();
      const hit = (data.results || []).find((r) => r.country_code === "US" && r.admin1 === wantAdmin);
      if (hit) return { lat: hit.latitude, lng: hit.longitude };
      await sleep(150);
    } catch {
      /* try next segment */
    }
  }
  return null;
}

// Extract "City, ST" from strings like "Denton Area, TX", "Richardson/Wylie, TX", "Durant, OK | Venue"
export function splitCityState(raw) {
  const beforePipe = raw.split("|")[0].trim();
  const m = beforePipe.match(/^(.+?),\s*([A-Z]{2})\b/);
  if (!m) return { city: beforePipe, state: "TX" };
  return { city: m[1].trim(), state: m[2] };
}

export function normDivisions(list) {
  return [...new Set(list.map((d) => d.trim().toUpperCase()).filter(Boolean))];
}

// Age divisions we drill into for exact per-division team counts.
export const TRACKED_DIVISIONS = ["10U", "11U", "12U", "13U", "14U"];
export const hasTrackedDivision = (divisions) => divisions.some((d) => TRACKED_DIVISIONS.includes(d));

// Skill class inside an age bracket. Sources spell these a dozen ways ("Op",
// "OPEN", "AA", "Maj", "D3", "REC"), and the difference matters: a 10U Open
// bracket with one team and a 10U AA bracket with eleven are not the same
// tournament to a coach. Returns null when there's no class to speak of.
export function normClass(raw) {
  const s = String(raw || "").trim().replace(/[()]/g, "").trim();
  if (!s) return null;
  const key = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const MAP = {
    OP: "Open", OPEN: "Open",
    MAJ: "Major", MAJOR: "Major",
    AAA: "AAA", AA: "AA", A: "A", B: "B", C: "C",
    REC: "Rec", RECREATIONAL: "Rec",
    ALLSTAR: "All-Star", ALL: "All-Star",
    D1: "D1", D2: "D2", D3: "D3",
    CP: "Coach Pitch", MP: "Machine Pitch", TB: "T-Ball",
    ELITE: "Elite", SELECT: "Select", CLASSIC: "Classic",
  };
  if (MAP[key]) return MAP[key];
  // Unknown but short and plausible: keep it as written rather than lose it.
  return s.length <= 14 ? s : null;
}

// Fold a {age: {class: n}} tree down to {age: total} for the headline number.
export function totalsByAge(classCounts) {
  const out = {};
  for (const [age, classes] of Object.entries(classCounts || {})) {
    out[age] = Object.values(classes).reduce((a, b) => a + (b || 0), 0);
  }
  return out;
}

// Record one division's teams under its age and class.
export function addClassCount(classCounts, age, cls, teams) {
  if (!age) return;
  const bucket = (classCounts[age] = classCounts[age] || {});
  const key = cls || "Open";
  bucket[key] = (bucket[key] || 0) + (teams || 0);
}
