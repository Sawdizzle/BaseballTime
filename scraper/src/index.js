import { createClient } from "@supabase/supabase-js";
import { scrapeNCS } from "./ncs.js";
import { scrapePAC } from "./pac.js";
import { scrapePPS } from "./pps.js";
import { geocodeCity, haversineMiles, SANGER, sleep, TRACKED_DIVISIONS } from "./util.js";

const DRY = process.env.DRY_RUN === "1";
const log = console.error;

const supabase = DRY
  ? null
  : createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      db: { schema: "tourneyscan" },
      auth: { persistSession: false },
    });

async function main() {
  const results = await Promise.allSettled([
    scrapeNCS({ log }),
    scrapePAC({ log }),
    scrapePPS({ log }),
  ]);
  const events = [];
  for (const [i, r] of results.entries()) {
    const org = ["NCS", "PAC", "PPS"][i];
    if (r.status === "fulfilled") events.push(...r.value);
    else log(`${org} scrape FAILED: ${r.reason?.message || r.reason}`);
  }
  if (!events.length) throw new Error("No events scraped from any source — aborting.");

  // Geocode + distance, cached per city
  const cache = new Map();
  if (!DRY) {
    const { data } = await supabase.from("city_geocache").select("*");
    for (const row of data || []) cache.set(`${row.city}|${row.state}`, { lat: row.lat, lng: row.lng });
  }
  for (const ev of events) {
    if (!ev.city) continue;
    const key = `${ev.city}|${ev.state}`;
    if (!cache.has(key)) {
      const geo = await geocodeCity(ev.city, ev.state);
      cache.set(key, geo);
      if (geo && !DRY) await supabase.from("city_geocache").upsert({ city: ev.city, state: ev.state, ...geo });
      await sleep(250);
    }
    const geo = cache.get(key);
    if (geo) {
      ev.lat = geo.lat;
      ev.lng = geo.lng;
      ev.distance_miles = haversineMiles(SANGER, geo);
    }
  }

  const rows = events.map(({ slug, ...e }) => e);
  const countFor = (e, div) => e.division_counts[div] ?? e.total_registered;
  const qualifying = {};
  for (const div of TRACKED_DIVISIONS) {
    qualifying[div] = rows.filter(
      (e) => e.divisions.includes(div) && countFor(e, div) >= 3 && e.distance_miles != null && e.distance_miles <= 80
    );
  }
  const summary = TRACKED_DIVISIONS.map((d) => `${d}: ${qualifying[d].length}`).join(", ");
  log(`Total: ${rows.length} events | qualifying (3+, ≤80mi) — ${summary}`);

  if (DRY) {
    console.log(JSON.stringify({ events: rows, qualifying }, null, 2));
    return;
  }

  // Upsert events
  const { error: upErr } = await supabase
    .from("events")
    .upsert(rows.map((e) => ({ ...e, last_seen: new Date().toISOString() })), { onConflict: "org,source_event_id" });
  if (upErr) throw upErr;

  // Snapshot today's counts
  const { data: dbEvents, error: selErr } = await supabase.from("events").select("id, org, source_event_id");
  if (selErr) throw selErr;
  const idMap = new Map(dbEvents.map((r) => [`${r.org}|${r.source_event_id}`, r.id]));
  const snaps = rows
    .map((e) => ({
      event_id: idMap.get(`${e.org}|${e.source_event_id}`),
      total_registered: e.total_registered,
      teams_14u: e.teams_14u ?? 0,
      division_counts: e.division_counts,
    }))
    .filter((s) => s.event_id);
  const { error: snapErr } = await supabase
    .from("registration_snapshots")
    .upsert(snaps, { onConflict: "event_id,snapshot_date" });
  if (snapErr) throw snapErr;

  log(`Upserted ${rows.length} events, ${snaps.length} snapshots. Done.`);
}

main().catch((err) => {
  console.error("FATAL:", err.message || err);
  process.exit(1);
});
