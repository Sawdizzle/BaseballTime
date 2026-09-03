import * as cheerio from "cheerio";
import { fetchHtml, parseSlashDates, normDivisions, sleep, hasTrackedDivision, UA } from "./util.js";

const BASE = "https://baseball.playpps.com";

// PPS (Playbook365): the landing page only embeds a few featured cards. The
// real list is appended by an infinite-scroll POST to /ajax-events (20 per
// page, Laravel CSRF-protected) — so we take the page's csrf token + session
// cookie and page through that endpoint until it returns no HTML. Cards are
// .list-container[data-event-id] with schema.org microdata (name, startDate,
// endDate, addressLocality/Region) plus a hidden <select class="division">
// listing age divisions. Each event's public /teams page shows an exact
// per-division count pill — that's our per-age number.
const MAX_PAGES = 20;

export async function scrapePPS({ drillDown = true, log = console.error } = {}) {
  const res = await fetch(BASE, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${BASE}`);
  const landing = await res.text();
  const cookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const token = cheerio.load(landing)("meta[name='csrf-token']").attr("content");
  if (!token) throw new Error("PPS: csrf-token meta tag not found — page layout changed?");

  const byId = new Map();
  parseCards(landing, byId, log); // featured cards, in case ajax paging breaks
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchEventsPage(page, token, cookie);
    if (!html) break;
    const before = byId.size;
    parseCards(html, byId, log);
    if (byId.size === before) break; // page repeated itself; don't loop forever
    await sleep(300);
  }
  const events = [...byId.values()];
  if (!events.length) throw new Error("PPS: zero event cards parsed — page layout changed?");

  if (drillDown) {
    const targets = events.filter((e) => hasTrackedDivision(e.divisions) && e.slug);
    log(`PPS: ${events.length} events, drilling into ${targets.length} with tracked divisions`);
    for (const ev of targets) {
      try {
        ev.division_counts = await ppsDivisionCounts(ev.slug);
        // Some events say "Team list is unavailable"; keep those approximate.
        if (ev.divisions.includes("14U") && Object.keys(ev.division_counts).length) {
          ev.teams_14u = ev.division_counts["14U"] ?? 0;
        }
      } catch (err) {
        log(`PPS drill-down failed for ${ev.slug}: ${err.message}`);
      }
      await sleep(400);
    }
  }
  return events;
}

// PPS runs multi-venue metro events with no city on the card — just "DFW" or
// nothing, with "dallas-fort-worth" / "dfw-locations" in the slug. Label those
// "DFW area" so geocoding (which has a DFW alias) gives them a distance.
function ppsCity(city, slug) {
  if (/^dfw$/i.test(city) || (!city && /dfw|dallas-fort-worth/i.test(slug || ""))) return "DFW area";
  return city || null;
}

// One page of the infinite-scroll list. Returns the card HTML, or "" when the
// server says there's nothing more.
async function fetchEventsPage(page, token, cookie) {
  const body = new URLSearchParams({ page, layout: "medium", past_events: "false", events_exits: "", organization_id: "", _token: token });
  const res = await fetch(`${BASE}/ajax-events`, {
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
  if (!res.ok) throw new Error(`${res.status} ${BASE}/ajax-events page ${page}`);
  const json = await res.json();
  return typeof json.html === "string" ? json.html : "";
}

function parseCards(html, byId) {
  const $ = cheerio.load(html);
  $(".list-container[data-event-id]").each((_, card) => {
    const $c = $(card);
    const id = $c.attr("data-event-id");
    if (!id || byId.has(id)) return;

    const meta = (prop) => $c.find(`[itemprop='${prop}']`).first().attr("content") || "";
    const name = meta("name").trim();
    if (!name || /fastpitch/i.test(name)) return;

    // Slug from the baseball-subdomain details link (softball cross-posts excluded)
    let slug = null;
    $c.find("a[href*='/events/']").each((_, a) => {
      const href = $(a).attr("href") || "";
      if (/softball\.playpps\.com/.test(href)) return;
      const m = href.match(/\/events\/([a-z0-9-]+?)(?:\/teams|\/schedule|\/leaderboard)?$/i);
      if (m && !slug) slug = m[1];
    });

    const divisions = normDivisions(
      $c.find("select.division option")
        .map((_, o) => $(o).text())
        .get()
        .filter((t) => /\d+U/i.test(t))
        .map((t) => t.replace(/\s+/g, ""))
    );
    const text = $c.text();
    const regMatch = text.match(/(\d+)\s+Registered/);
    const costMatch = text.match(/COST:\s*\$\s*([\d,.]+)/);
    const start = parseSlashDates(meta("startDate")).start;
    const end = parseSlashDates(meta("endDate")).start;

    byId.set(id, {
      org: "PPS",
      source_event_id: id,
      slug,
      name,
      start_date: start,
      end_date: end,
      city: ppsCity(meta("addressLocality").trim(), slug),
      state: meta("addressRegion").trim() || "TX",
      venue: $c.find("[itemprop='location'] [itemprop='name']").first().attr("content") || null,
      divisions,
      total_registered: regMatch ? parseInt(regMatch[1], 10) : 0,
      teams_14u: null,
      division_counts: {},
      cost: costMatch ? `$${costMatch[1]}` : null,
      event_url: slug ? `${BASE}/events/${slug}` : BASE,
      event_status: "Tournament",
    });
  });
}

// Per-division counts from the /teams page pills, keyed "10U", "12U", ...
async function ppsDivisionCounts(slug) {
  const html = await fetchHtml(`${BASE}/events/${slug}/teams`);
  const $ = cheerio.load(html);
  const counts = {};
  $(".panel-heading").each((_, el) => {
    const heading = $(el).clone().children().remove().end().text().trim();
    const m = heading.match(/^(\d{1,2})U$/i);
    if (!m) return;
    const key = `${m[1]}U`;
    const pill = $(el).find(".division-count-pill").first().text().trim();
    counts[key] = (counts[key] || 0) + (parseInt(pill, 10) || 0);
  });
  return counts;
}
