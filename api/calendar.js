// GET /api/calendar.ics?lat=&lng=&miles=&ages=&min=&orgs=
//
// A subscribable calendar of tournaments matching the same filters the
// dashboard uses, so a coach can keep the shortlist in the calendar they
// already live in. Read-only, no auth: it reads the same public rows the
// page does. Points at Supabase's REST endpoint directly to avoid pulling
// a client library into the function.
const SUPABASE_URL = "https://yeykyutsbeqjcgdxlucn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_SLM96UPQ3Rgrf6MTpXRZUQ_LklkFhPH";
const ALL_AGES = ["10U", "11U", "12U", "13U", "14U"];
const MAX_EVENTS = 400;

const R = 3958.8;
const toR = (d) => (d * Math.PI) / 180;
function miles(a, b) {
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateOnly = (iso) => String(iso || "").slice(0, 10).replace(/-/g, "");
// An all-day VEVENT's DTEND is exclusive, so push it one day past the last day.
const dayAfter = (iso) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
};

// RFC 5545 wants lines folded at 75 octets, continued with a leading space.
function fold(line) {
  const out = [];
  let s = line;
  while (Buffer.byteLength(s, "utf8") > 73) {
    let cut = 73;
    while (Buffer.byteLength(s.slice(0, cut), "utf8") > 73) cut--;
    out.push(s.slice(0, cut));
    s = " " + s.slice(cut);
  }
  out.push(s);
  return out.join("\r\n");
}

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const lat = parseFloat(q.lat), lng = parseFloat(q.lng);
    const maxMiles = Math.min(Math.max(parseInt(q.miles, 10) || 80, 0), 500);
    const minTeams = Math.max(parseInt(q.min, 10) || 0, 0);
    const ages = String(q.ages || "").split(",").map((a) => a.trim().toUpperCase()).filter((a) => ALL_AGES.includes(a));
    const wantAges = ages.length ? ages : ALL_AGES;
    const orgs = String(q.orgs || "").split(",").map((o) => o.trim().toUpperCase()).filter(Boolean);
    const here = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

    const today = new Date().toISOString().slice(0, 10);
    const url = `${SUPABASE_URL}/rest/v1/events?select=id,org,name,city,state,venue,lat,lng,start_date,end_date,divisions,division_counts,total_registered,event_url&end_date=gte.${today}&order=start_date.asc`;
    const r = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Accept-Profile": "tourneyscan" },
    });
    if (!r.ok) throw new Error(`${r.status} from Supabase`);
    const rows = await r.json();

    const picked = [];
    for (const e of rows) {
      if (!e.start_date) continue;
      const evAges = (e.divisions || []).filter((d) => wantAges.includes(d));
      if (!evAges.length) continue;
      if (orgs.length && !orgs.includes(String(e.org).toUpperCase())) continue;
      let dist = null;
      if (here) {
        if (e.lat == null || e.lng == null) continue;
        dist = miles(here, { lat: +e.lat, lng: +e.lng });
        if (dist > maxMiles) continue;
      }
      const counts = e.division_counts || {};
      const best = Math.max(...evAges.map((a) => counts[a] ?? e.total_registered ?? 0));
      if (best < minTeams) continue;
      picked.push({ ...e, dist, evAges, counts });
      if (picked.length >= MAX_EVENTS) break;
    }

    const now = stamp(new Date());
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Baseball Time in TX//EN",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      `X-WR-CALNAME:${esc("Baseball Time — " + wantAges.join("/"))}`,
      "X-PUBLISHED-TTL:PT12H", "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    ];
    for (const e of picked) {
      const where = [e.venue, [e.city, e.state].filter(Boolean).join(", ")].filter(Boolean).join(" — ");
      // PAC and friends publish no per-age split, only a total; mark those.
      const counts = e.evAges
        .map((a) => (e.counts[a] != null ? `${a}: ${e.counts[a]}` : `${a}: ~${e.total_registered ?? 0} all ages`))
        .join(", ");
      const desc = [
        `${e.org} — ${counts} teams registered`,
        e.dist != null ? `${Math.round(e.dist * 10) / 10} mi away` : null,
        e.event_url,
      ].filter(Boolean).join("\n");
      lines.push(
        "BEGIN:VEVENT",
        `UID:${e.id}@youthbaseballtime.com`,
        `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${dateOnly(e.start_date)}`,
        `DTEND;VALUE=DATE:${dayAfter(e.end_date || e.start_date)}`,
        fold(`SUMMARY:${esc(`${e.name} (${e.evAges.join("/")})`)}`),
        fold(`LOCATION:${esc(where)}`),
        fold(`DESCRIPTION:${esc(desc)}`),
        e.event_url ? fold(`URL:${esc(e.event_url)}`) : null,
        "END:VEVENT"
      );
    }
    lines.push("END:VCALENDAR");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="baseball-time.ics"');
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");
    res.status(200).send(lines.filter(Boolean).join("\r\n") + "\r\n");
  } catch (err) {
    res.status(502).send(`Calendar unavailable: ${err.message}`);
  }
}
