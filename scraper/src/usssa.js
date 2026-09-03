import { normDivisions, sleep, hasTrackedDivision, UA, normClass, addClassCount, totalsByAge } from "./util.js";

// USSSA via usssa.com's public JSON API. (The per-state WordPress sites,
// txbaseball.usssa.com etc., return 403 to GitHub Actions' IP range, but the
// main site's API answers fine — and it can search by zip + radius, which is
// exactly the question this app asks.)
//
//   eventSearchSimpleV11  — events for a season in a state; needs the static
//                           page token below (window.apiAccessToken on
//                           usssa.com/baseball/eventSearch/).
//   getEventSearchSeasons — season IDs per sport; we pick the current one.
//   getEventTeams         — every division of an event with its team list,
//                           which is where the exact per-age counts come from.
const API = "https://www.usssa.com/api/";
const TOKEN = "eventSearchV4!!!Get";
const SPORT_ID = 11; // baseball
// USSSA StateIDs (from getStatesNoSplit). The dashboard lets people pick any
// location, so we take whole states rather than a radius around Sanger.
const STATES = { TX: 77, OK: 73 };
const HEADERS = { "User-Agent": UA, Accept: "*/*" };

async function api(params) {
  const res = await fetch(`${API}?${new URLSearchParams(params)}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} from USSSA API (${params.action})`);
  const json = await res.json();
  if (json && json.Error) throw new Error(`USSSA API ${params.action}: ${json.Message || "error"}`);
  return json;
}

// USSSA seasons run Aug → Jul and are named by the year they end in.
async function currentSeasonId() {
  const now = new Date();
  const endYear = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
  const data = await api({ action: "getEventSearchSeasons", sportID: SPORT_ID });
  const seasons = data?.[SPORT_ID] || [];
  const hit = seasons.find((s) => s.name === `${endYear} Season`) || seasons[0];
  if (!hit) throw new Error("USSSA: no seasons returned");
  return hit.value;
}

// "10U%Open|AA#11U%Open|AA#14U%Open" → ["10U","11U","14U"]
const parseDivisions = (s) => normDivisions(String(s || "").split("#").map((x) => x.split("%")[0]));

export async function scrapeUSSSA({ drillDown = true, log = console.error } = {}) {
  const seasonID = await currentSeasonId();
  const byId = new Map();
  for (const [abbr, stateID] of Object.entries(STATES)) {
    const data = await api({ action: "eventSearchSimpleV11", sportID: SPORT_ID, seasonID, stateID, token: TOKEN });
    const rows = Array.isArray(data?.results) ? data.results : [];
    log(`USSSA: ${abbr} → ${rows.length} events`);
    for (const r of rows) if (!byId.has(r.ID)) byId.set(r.ID, r);
    await sleep(200);
  }
  const results = [...byId.values()];
  if (!results.length) throw new Error("USSSA: search returned no events — token or API changed?");

  const events = results.map((r) => ({
    org: "USSSA",
    source_event_id: String(r.ID),
    name: String(r.event_name || "").trim(),
    start_date: (r.start_date || "").slice(0, 10) || null,
    end_date: (r.end_date || r.start_date || "").slice(0, 10) || null,
    city: r.city || null,
    state: r.stateABR || "TX",
    venue: r.eventLocation && r.eventLocation !== r.city ? r.eventLocation : null,
    divisions: parseDivisions(r.eventDivisionsAll),
    total_registered: parseInt(r.teamCount, 10) || 0,
    teams_14u: null,
    division_counts: {},
    class_counts: {},
    cost: null,
    event_url: `https://www.usssa.com/baseball/event_home/?eventID=${r.ID}`,
    event_status: r.stature || "Tournament",
  }));
  log(`USSSA: ${events.length} events across ${Object.keys(STATES).join("+")}`);

  if (drillDown) {
    const targets = events.filter((e) => hasTrackedDivision(e.divisions) && e.total_registered > 0);
    log(`USSSA: drilling into ${targets.length} with tracked divisions`);
    const queue = [...targets];
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (queue.length) {
          const ev = queue.shift();
          try {
            ev.class_counts = await divisionCounts(ev.source_event_id);
            ev.division_counts = totalsByAge(ev.class_counts);
            if (ev.divisions.includes("14U") && Object.keys(ev.division_counts).length) {
              ev.teams_14u = ev.division_counts["14U"] ?? 0;
            }
          } catch (err) {
            log(`USSSA drill-down failed for ${ev.source_event_id}: ${err.message}`);
          }
          await sleep(200);
        }
      })
    );
  }
  return events;
}

// Per-age, per-class team counts: divisions carry an age code like "14Op", "12AA",
// "10Maj"; classes within an age roll up into one key.
async function divisionCounts(eventID) {
  const data = await api({ action: "getEventTeams", eventID });
  const classCounts = {};
  for (const d of Array.isArray(data?.divisions) ? data.divisions : []) {
    // "12AA", "14Op", "10Maj" — digits are the age, the rest is the class.
    const m = String(d.age || "").match(/^(\d{1,2})\s*(.*)$/);
    if (!m) continue;
    addClassCount(classCounts, `${m[1]}U`, normClass(m[2]), Array.isArray(d.teams) ? d.teams.length : 0);
  }
  return classCounts;
}
