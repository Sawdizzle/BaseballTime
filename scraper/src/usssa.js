import * as cheerio from "cheerio";
import { fetchHtml, normDivisions, sleep, hasTrackedDivision, UA } from "./util.js";

// USSSA runs one WordPress site per state (txbaseball.usssa.com, okbaseball…),
// each listing events as .events-list-elem cards over ?paged=N pages. The card
// has the title, dates, entry fee, total team count, age range, and city. The
// event page's JSON-LD carries the numeric eventID that USSSA's public JSON API
// wants; getEventTeams then returns every division with its team list, which
// is where the exact per-age counts come from.
const SITES = ["https://txbaseball.usssa.com", "https://okbaseball.usssa.com"];
const API = "https://www.usssa.com/api/";
const MAX_PAGES = 20;
const text = (el) => el.text().replace(/\s+/g, " ").trim();

export async function scrapeUSSSA({ drillDown = true, log = console.error } = {}) {
  const byId = new Map(); // keyed by WP url until we learn the eventID
  for (const base of SITES) {
    let pages = 0;
    for (let p = 1; p <= MAX_PAGES; p++) {
      let html;
      try {
        html = await fetchHtml(`${base}/events/?paged=${p}`);
      } catch (err) {
        log(`USSSA list fetch failed ${base} page ${p}: ${err.message}`);
        break;
      }
      const $ = cheerio.load(html);
      const cards = $(".events-list-elem");
      if (!cards.length) break;
      pages++;
      cards.each((_, c) => {
        const $c = $(c);
        const href = $c.find(".events-list-elem-title a").attr("href");
        const name = text($c.find(".events-list-elem-title"));
        if (!href || !name || byId.has(href)) return;
        const info = $c.find(".events-list-elem-info li").map((_, li) => text($(li))).get();
        const list = $c.find(".events-list-elem-list li").map((_, li) => text($(li))).get();
        const ages = (list.find((s) => /\d+U\s*-\s*\d+U/.test(s)) || "").match(/(\d{1,2})U\s*-\s*(\d{1,2})U/);
        const loc = (list.find((s) => /,\s*[A-Z]{2}$/.test(s)) || "").match(/^(.+?),\s*([A-Z]{2})$/);
        const divisions = ages ? normDivisions(Array.from({ length: +ages[2] - +ages[1] + 1 }, (_, i) => `${+ages[1] + i}U`)) : [];
        const cost = info.find((s) => /^\$/.test(s));
        byId.set(href, {
          org: "USSSA",
          source_event_id: null, // filled from the event page
          slug: href,
          name,
          start_date: null,
          end_date: null,
          city: loc ? titleCase(loc[1]) : null,
          state: loc ? loc[2] : "TX",
          venue: null,
          divisions,
          total_registered: parseInt(text($c.find(".team-count")), 10) || 0,
          teams_14u: null,
          division_counts: {},
          cost: cost && cost !== "$0" ? cost : null,
          event_url: href,
          event_status: "Tournament",
        });
      });
      await sleep(200);
    }
    log(`USSSA: ${base.replace("https://", "")} → ${pages} pages`);
  }
  const events = [...byId.values()];
  if (!events.length) throw new Error("USSSA: zero event cards parsed — page layout changed?");

  // Every event needs its page for the eventID and exact dates; those with a
  // tracked age also get the API call for per-division counts.
  const queue = [...events];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const ev = queue.shift();
        try {
          await enrich(ev, drillDown);
        } catch (err) {
          log(`USSSA drill-down failed for ${ev.slug}: ${err.message}`);
        }
        await sleep(250);
      }
    })
  );
  const ready = events.filter((e) => e.source_event_id && e.start_date);
  log(`USSSA: ${events.length} events, ${ready.length} with ids/dates`);
  return ready;
}

async function enrich(ev, drillDown) {
  const html = await fetchHtml(ev.slug);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .find((j) => j && j["@type"] === "Event");
  if (!ld) throw new Error("no Event JSON-LD");
  const idMatch = String(ld.offers?.url || "").match(/eventID=(\d+)/);
  if (!idMatch) throw new Error("no eventID in JSON-LD");
  ev.source_event_id = idMatch[1];
  ev.start_date = ld.startDate || null;
  ev.end_date = ld.endDate || ld.startDate || null;
  ev.venue = ld.location?.name || null;
  const stature = text(cheerio.load(html)("body")).match(/Stature\s+(.+?)\s+Age Groups/);
  if (stature) ev.event_status = stature[1].trim();

  if (!drillDown || !hasTrackedDivision(ev.divisions)) return;
  const res = await fetch(`${API}?action=getEventTeams&eventID=${ev.source_event_id}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} from USSSA API`);
  const data = await res.json();
  const divisions = Array.isArray(data?.divisions) ? data.divisions : [];
  if (!divisions.length) return; // API had nothing; leave counts approximate
  const counts = {};
  for (const d of divisions) {
    const m = String(d.age || "").match(/^(\d{1,2})/); // "14Op", "12AA", "10Maj"
    if (!m) continue;
    const key = `${m[1]}U`;
    counts[key] = (counts[key] || 0) + (Array.isArray(d.teams) ? d.teams.length : 0);
  }
  ev.division_counts = counts;
  ev.divisions = normDivisions([...ev.divisions, ...Object.keys(counts)]);
  if (ev.divisions.includes("14U") && Object.keys(counts).length) ev.teams_14u = counts["14U"] ?? 0;
  if (data?.info?.city) ev.city = data.info.city;
  if (data?.info?.state) ev.state = data.info.state;
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
