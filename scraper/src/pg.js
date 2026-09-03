import * as cheerio from "cheerio";
import { normDivisions, sleep, UA, normClass, addClassCount, totalsByAge } from "./util.js";

// Perfect Game's tournament schedule is a Telerik RadGrid on ASP.NET WebForms.
// There is no JSON API and no working server-side state filter, so we walk the
// whole national grid (~300 rows a page) and keep the states we want. Paging is
// a __doPostBack that must carry the *previous* response's ViewState.
//
// Grid shape, in DOM order:
//   tr.rgGroupHeader      — ignored (a concatenated summary)
//   tr (3 cells)          — the event: name + GroupedEvents.aspx?gid, age range,
//                           total teams, "City, ST", director
//   tr.rgRow/.rgAltRow    — one per age division, carrying hidden fields with
//                           exact start/end dates, the age, cancelled flag, and
//                           a cell with that division's team count
const SCHEDULE = "https://www.perfectgame.org/Schedule/Default.aspx?Type=Tournaments";
const BASE = "https://www.perfectgame.org";
const MAX_PAGES = 40;
const text = (el) => el.text().replace(/\s+/g, " ").trim();
const iso = (s) => {
  const m = String(s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
};
const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export async function scrapePG({ states = ["TX"], log = console.error } = {}) {
  const keep = new Set(states);
  const byId = new Map();
  let html = await get(SCHEDULE);
  let cookies = html.cookies;
  let pages = 0;
  let totalPages = MAX_PAGES;
  let barren = 0;

  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
    const $ = cheerio.load(html.body);
    if (page === 1) {
      // "8045 items in 27 pages" — the arrow keeps responding past the last
      // page, so trust the pager's own count rather than looping forever.
      const declared = parseInt(text($(".rgInfoPart").first()).match(/in\s+(\d+)\s+pages/)?.[1] || "", 10);
      if (Number.isFinite(declared) && declared > 0) totalPages = declared;
      log(`PG: grid reports ${totalPages} pages`);
    }
    const before = byId.size;
    parsePage($, byId, keep);
    pages++;
    barren = byId.size === before ? barren + 1 : 0;
    if (barren >= 5) break; // nothing new for five straight pages
    if (page >= Math.min(totalPages, MAX_PAGES)) break;
    const next = nextTarget($, page);
    if (!next) break;
    const body = formFields($);
    body.set("__EVENTTARGET", next);
    body.set("__EVENTARGUMENT", "");
    const res = await post(SCHEDULE, body, cookies);
    if (!res) break;
    html = res;
    await sleep(250);
  }

  const events = [...byId.values()].filter((e) => e.divisions.length && e.start_date);
  log(`PG: ${pages} pages, ${events.length} events in ${[...keep].join("+")}`);
  if (!events.length) throw new Error("PG: no events parsed — grid layout changed?");
  return events;
}

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const cookies = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  return { body: await res.text(), cookies };
}

async function post(url, body, cookies) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies,
      Referer: url,
    },
    body: body.toString(),
  });
  if (!res.ok) return null;
  return { body: await res.text(), cookies };
}

function formFields($) {
  const body = new URLSearchParams();
  $("input[type=hidden]").each((_, i) => {
    const n = $(i).attr("name");
    if (n) body.set(n, $(i).attr("value") || "");
  });
  return body;
}

// Prefer the "Next Page" arrow: the numeric buttons only show a sliding window
// of ten, so matching on the page number stalls at page 10. Fall back to the
// numeric label if the arrow ever disappears.
function nextTarget($, currentPage) {
  const arrow = $("tr.rgPager button[title='Next Page'], tr.rgPager a[title='Next Page']").first();
  if (arrow.length && !/rgPageDisabled/.test(arrow.attr("class") || "")) {
    const name = arrow.attr("name");
    if (name) return name;
    const m = (arrow.attr("href") || "").match(/__doPostBack\('([^']+)'/);
    if (m) return m[1];
  }
  const want = String(currentPage + 1);
  let target = null;
  $("tr.rgPager button, tr.rgPager a").each((_, el) => {
    if (target || text($(el)) !== want) return;
    const name = $(el).attr("name");
    if (name) { target = name; return; }
    const m = ($(el).attr("href") || "").match(/__doPostBack\('([^']+)'/);
    if (m) target = m[1];
  });
  return target;
}

function parsePage($, byId, keep) {
  let group = null;
  $("table.rgMasterTable").first().find("tr").each((_, tr) => {
    const $tr = $(tr);
    const tds = $tr.find("> td");

    // Event row: carries the name and the GroupedEvents gid.
    const nameLink = $tr.find("a[href*='GroupedEvents.aspx?gid=']").first();
    if (nameLink.length && tds.length === 3) {
      const gid = (nameLink.attr("href") || "").match(/gid=(\d+)/)?.[1];
      if (!gid) { group = null; return; }
      const cell = tds.eq(2);
      const loc = cell.find(".col-md-2 span").first();
      const m = text(loc).match(/^(.*),\s*([A-Za-z]{2})$/);
      group = {
        gid,
        name: text(nameLink),
        city: m ? titleCase(m[1].trim()) : null,
        state: m ? m[2].toUpperCase() : null,
        total: parseInt(text(cell.find("a[href*='TournamentTeamsGroup.aspx']").first()), 10) || 0,
      };
      return;
    }

    // Division row: 5 cells with the hidden fields.
    if (!$tr.is(".rgRow, .rgAltRow") || tds.length < 5 || !group) return;
    const hidden = {};
    $tr.find("input[type=hidden]").each((_, i) => {
      const n = ($(i).attr("name") || "").split("$").pop();
      hidden[n] = $(i).attr("value") || "";
    });
    if (/^true$/i.test(hidden.hfEventCanceled || "")) return;
    const age = (hidden.hfAgeDivision || "").match(/^(\d{1,2})U/i)?.[0]?.toUpperCase();
    if (!age) return;

    // Location cell is "Venue<br>City, ST"; the division row is the reliable
    // source since the event row abbreviates some states.
    const locParts = tds.eq(4).html()?.split(/<br\s*\/?>/i).map((x) => text(cheerio.load(`<i>${x}</i>`)("i"))) || [];
    const cityState = (locParts[locParts.length - 1] || "").match(/^(.*),\s*([A-Za-z]{2})$/);
    const state = (cityState?.[2] || group.state || "").toUpperCase();
    if (!keep.has(state)) return;

    let ev = byId.get(group.gid);
    if (!ev) {
      ev = {
        org: "PG",
        source_event_id: group.gid,
        name: group.name,
        start_date: null,
        end_date: null,
        city: cityState ? titleCase(cityState[1].trim()) : group.city,
        state,
        venue: locParts.length > 1 ? locParts[0] || null : null,
        divisions: [],
        total_registered: group.total,
        teams_14u: null,
        division_counts: {},
        class_counts: {},
        cost: null,
        event_url: `${BASE}/Schedule/GroupedEvents.aspx?gid=${group.gid}`,
        event_status: "Tournament",
      };
      byId.set(group.gid, ev);
    }
    const start = iso(hidden.hfStartDate), end = iso(hidden.hfEndDate);
    if (start && (!ev.start_date || start < ev.start_date)) ev.start_date = start;
    if (end && (!ev.end_date || end > ev.end_date)) ev.end_date = end;
    ev.divisions = normDivisions([...ev.divisions, age]);
    // Link text is "12U (AAA) Event Info" or "7U (Open) (CP) Event Info"; the
    // first bracketed group is the skill class, any second is the pitch format.
    const cls = normClass(text(tds.eq(2)).match(/\(([^)]+)\)/)?.[1]);
    const n = parseInt(text(tds.eq(3)), 10);
    if (Number.isFinite(n)) {
      addClassCount(ev.class_counts, age, cls, n);
      ev.division_counts = totalsByAge(ev.class_counts);
    }
    if (age === "14U" && Object.keys(ev.division_counts).length) ev.teams_14u = ev.division_counts["14U"] ?? 0;
  });
}
