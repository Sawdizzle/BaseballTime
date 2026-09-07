import * as cheerio from "cheerio";
import { fetchHtml, parseNcsDates, splitCityState, normDivisions, sleep, hasTrackedDivision, normClass, addClassCount, totalsByAge } from "./util.js";

const BASE = "https://www.playncs.com";
// NCS files events under a per-state region page; there is no combined listing.
// Only the states NCS actually runs are here — a region it does not serve 404s.
const REGIONS = {
  TX: "texas", OK: "oklahoma", LA: "louisiana", NM: "new-mexico",
  AZ: "arizona", AL: "alabama", CA: "california", CO: "colorado", FL: "florida",
  GA: "georgia", HI: "hawaii", ID: "idaho", IN: "indiana", KY: "kentucky",
  MS: "mississippi", NV: "nevada", OR: "oregon", TN: "tennessee", UT: "utah",
  WA: "washington",
};
const listUrl = (region) => `${BASE}/baseball/Regions/${region}/Events`;

export async function scrapeNCS({ states = ["TX"], drillDown = true, log = console.error } = {}) {
  const regions = states.map((st) => [st, REGIONS[st]]).filter(([, r]) => r);
  const events = [];
  const seen = new Set();
  for (const [st, region] of regions) {
    let found = 0;
    try {
      // An event can be listed under more than one region, so dedupe on the id
      // rather than trusting one page per event.
      for (const ev of parseRegion(await fetchHtml(listUrl(region)), st)) {
        if (seen.has(ev.source_event_id)) continue;
        seen.add(ev.source_event_id);
        events.push(ev);
        found++;
      }
    } catch (err) {
      // One region going down must not cost us the others.
      log(`NCS ${st} FAILED: ${err.message}`);
      continue;
    }
    log(`NCS: ${st} → ${found} events`);
    await sleep(250);
  }
  if (!events.length) throw new Error("NCS: no events parsed from any region — listing layout changed?");


  if (drillDown) {
    const targets = events.filter((e) => hasTrackedDivision(e.divisions) && e.total_registered > 0);
    log(`NCS: ${events.length} events, drilling into ${targets.length} with tracked divisions`);
    const queue = [...targets];
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (queue.length) {
          const ev = queue.shift();
          try {
            ev.class_counts = await ncsDivisionCounts(ev.source_event_id, ev.slug);
            ev.division_counts = totalsByAge(ev.class_counts);
            // An empty result means the team list isn't published; leave the
            // 14U count null so the dashboard shows the ≈ all-ages total.
            if (ev.divisions.includes("14U") && Object.keys(ev.division_counts).length) {
              ev.teams_14u = ev.division_counts["14U"] ?? 0;
            }
          } catch (err) {
            log(`NCS drill-down failed for ${ev.source_event_id}: ${err.message}`);
          }
          await sleep(250);
        }
      })
    );
  }
  return events;
}


// One region listing page -> events. `defaultState` is the region's own state,
// used only when a row omits the ", ST" suffix.
function parseRegion(html, defaultState) {
  const $ = cheerio.load(html);
  const events = [];
  $(".media-list-events > .media").each((_, el) => {
    const $el = $(el);
    const link = $el.find(".media-body .h4 a[href*='/Events/Details/']").first();
    if (!link.length) return;
    const href = link.attr("href") || "";
    const m = href.match(/\/Events\/Details\/(\d+)\/([a-z0-9-]+)/i);
    if (!m) return;

    const locRaw = $el.find(".media-body .h6").first().find("span").first().text().trim();
    // splitCityState falls back to Texas when a row omits ", ST"; on a
    // non-Texas region page the region's own state is the right default.
    const { city, state } = splitCityState(locRaw, defaultState);
    const dateText = $el
      .find(".media-body .h4")
      .filter((_, d) => !$(d).find("a").length)
      .first()
      .text()
      .trim();
    const registered = parseInt($el.find(".media-body .h5 strong").first().text().trim(), 10) || 0;
    const divText = $el.find(".media-body .h6").last().text().trim();
    const divisions = normDivisions(divText.split(/[·|,]/).filter((s) => /\d+U/i.test(s)));
    const { start, end } = parseNcsDates(dateText);

    events.push({
      org: "NCS",
      source_event_id: m[1],
      slug: m[2],
      name: link.text().trim(),
      start_date: start,
      end_date: end,
      city,
      state,
      venue: null,
      divisions,
      total_registered: registered,
      teams_14u: null,
      division_counts: {},
      class_counts: {},
      cost: null,
      event_url: `${BASE}${href}`,
      event_status: $el.find(".stature").first().text().trim() || "Tournament",
    });
  });
  return events;
}

// Per-division team counts from the Who's Coming page, keyed "10U", "12U", ...
// Sub-brackets ("14U Open", "14U AAA") roll up into their age key.
async function ncsDivisionCounts(id, slug) {
  const html = await fetchHtml(`${BASE}/baseball/Events/WhosComing/${id}/${slug}`);
  const $ = cheerio.load(html);
  const classCounts = {};
  $(".panel").each((_, panel) => {
    const division = $(panel).find(".division").first().text().trim();
    const m = division.match(/^(\d{1,2})U\b\s*(.*)$/i);
    if (!m) return;
    const key = `${m[1]}U`;
    const cls = normClass(m[2]);
    let count = 0;
    $(panel)
      .find("table tbody tr")
      .each((_, tr) => {
        const cell = $(tr).find("td").eq(1);
        const isOpen = cell.find("em").length && /open/i.test(cell.text());
        if (cell.text().trim() && !isOpen) count += 1;
      });
    addClassCount(classCounts, key, cls, count);
  });
  return classCounts;
}
