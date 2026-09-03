import * as cheerio from "cheerio";
import { normDivisions, sleep, UA } from "./util.js";

// Playbook365 powers a whole family of tournament sites. Every tenant answers
// the same POST /ajax-events with a Laravel CSRF token, and the response's
// `eventlist` array is structured JSON — including per-division team counts and
// the venue's lat/lng — so there is no HTML to parse and no drill-down needed.
//
// Adding an org here is a one-line change.
export const TENANTS = [
  { org: "PPS", host: "baseball.playpps.com", name: "Premier Prospects Sports" },
  { org: "24S", host: "go.play24sports.com", name: "24 Sports" },
  { org: "RBI", host: "events.playrbi.com", name: "Rec Baseball Innovations" },
  { org: "FT", host: "events.fivetool.org", name: "Five Tool" },
];

// Same platform, same code would work, but both refuse our servers. Verified
// from a GitHub Actions runner: 403 on every path regardless of user agent,
// while both answer normally from a home connection — so it's IP-based, not
// something a header can fix. Move these into TENANTS if they ever allowlist us.
//   play.fivetoolyouth.org  Five Tool Youth — the largest Texas dataset by far
//                           (~152 upcoming events, per-age counts), Cloudflare
//   youth.2dsports.org      2D Sports — small Texas footprint (Burleson, Winnie)
export const BLOCKED_TENANTS = [
  { org: "FTY", host: "play.fivetoolyouth.org", name: "Five Tool Youth" },
  { org: "2DS", host: "youth.2dsports.org", name: "2D Sports" },
];

const MAX_PAGES = 20;
const num = (v) => (Number.isFinite(+v) ? +v : null);

export async function scrapePlaybook365({ tenants = TENANTS, states = null, log = console.error } = {}) {
  const keep = states ? new Set(states) : null;
  const out = [];
  for (const t of tenants) {
    try {
      const rows = await tenant(t, keep);
      log(`${t.org}: ${rows.length} events${keep ? ` in ${[...keep].join("+")}` : ""}`);
      out.push(...rows);
    } catch (err) {
      // One tenant going down must not take the others with it.
      log(`${t.org} FAILED: ${err.message}`);
    }
    await sleep(250);
  }
  if (!out.length) throw new Error("Playbook365: no events from any tenant — platform changed?");
  return out;
}

async function tenant({ org, host }, keep) {
  const res = await fetch(`https://${host}/`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} loading ${host}`);
  const home = await res.text();
  const cookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const token = cheerio.load(home)("meta[name='csrf-token']").attr("content");
  if (!token) throw new Error(`${host}: no csrf-token meta tag`);

  const events = [];
  const seen = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = new URLSearchParams({ page, type: "full", searchParam: "", _token: token });
    const r = await fetch(`https://${host}/ajax-events`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRF-TOKEN": token,
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
    if (!r.ok) throw new Error(`${r.status} on ${host}/ajax-events page ${page}`);
    const json = await r.json();
    const list = Array.isArray(json?.eventlist) ? json.eventlist : [];
    if (!list.length) break;
    let added = 0;
    for (const e of list) {
      const id = String(e.event_id ?? e.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      added++;
      const state = String(e.state || "").toUpperCase();
      if (keep && !keep.has(state)) continue;
      if (/fastpitch|softball/i.test(e.name || "")) continue;

      // Per-age counts: several class rows can share an age (10U AA, 10U Major).
      const counts = {};
      for (const d of Array.isArray(e.divisions) ? e.divisions : []) {
        const age = String(d.label || "").match(/^(\d{1,2})U/i)?.[0]?.toUpperCase();
        if (!age) continue;
        counts[age] = (counts[age] || 0) + (num(d.teams_registered) ?? 0);
      }
      const divisions = normDivisions(Object.keys(counts));
      const venue = Array.isArray(e.venues) && e.venues.length ? e.venues[0].name || null : null;
      events.push({
        org,
        source_event_id: id,
        name: String(e.name || "").trim(),
        start_date: (e.start_date || "").slice(0, 10) || null,
        end_date: (e.end_date || e.start_date || "").slice(0, 10) || null,
        city: e.city || null,
        state: state || "TX",
        venue,
        divisions,
        total_registered: num(e.teams_registered) ?? 0,
        teams_14u: divisions.includes("14U") ? counts["14U"] ?? 0 : null,
        division_counts: counts,
        cost: e.cost_str || null,
        // The API gives venue coordinates, so these skip geocoding entirely.
        lat: num(e.latitude),
        lng: num(e.longitude),
        event_url: e.url_key ? `https://${host}/events/${e.url_key}` : `https://${host}/`,
        event_status: "Tournament",
      });
    }
    if (!added) break; // page repeated itself
    await sleep(250);
  }
  return events;
}
