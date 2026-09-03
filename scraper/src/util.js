const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) TourneyScan/1.0";
export const SANGER = { lat: 33.3632, lng: -97.1739 };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Parse NCS-style "Sep 12-13", "Aug 28 - Nov 15", "Jun 7" (no year given).
export function parseNcsDates(text, now = new Date()) {
  const t = text.trim();
  const m = t.match(/^([A-Za-z]{3})\w*\s+(\d{1,2})(?:\s*-\s*(?:([A-Za-z]{3})\w*\s+)?(\d{1,2}))?/);
  if (!m) return { start: null, end: null };
  const sm = MONTHS[m[1].toLowerCase()];
  const sd = parseInt(m[2], 10);
  const em = m[3] ? MONTHS[m[3].toLowerCase()] : sm;
  const ed = m[4] ? parseInt(m[4], 10) : sd;
  if (!sm) return { start: null, end: null };
  let year = now.getFullYear();
  let end = new Date(Date.UTC(year, em - 1, ed));
  // Listings are upcoming events; if it ended >45 days ago, it must be next year.
  if (end.getTime() < now.getTime() - 45 * 86400e3) { year += 1; end = new Date(Date.UTC(year, em - 1, ed)); }
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

const STATE_NAMES = { TX: "Texas", OK: "Oklahoma", NM: "New Mexico", LA: "Louisiana", AR: "Arkansas", MO: "Missouri", CO: "Colorado", KS: "Kansas" };

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
export const TRACKED_DIVISIONS = ["10U", "11U", "12U", "14U"];
export const hasTrackedDivision = (divisions) => divisions.some((d) => TRACKED_DIVISIONS.includes(d));
