import * as cheerio from "cheerio";
import { fetchHtml, parseSlashDates, normDivisions, sleep } from "./util.js";

const BASE = "https://baseball.playpps.com";

// PPS (Playbook365): cards are .list-container[data-event-id] with schema.org
// microdata (name, startDate, endDate, addressLocality/Region) plus a hidden
// <select class="division"> listing age divisions. Each event's public /teams
// page shows an exact per-division count pill — that's our 14U number.
export async function scrapePPS({ drillDown = true, log = console.error } = {}) {
  const landing = await fetchHtml(BASE);
  const $l = cheerio.load(landing);
  const seasonUrls = new Set();
  $l("a[href*='/season/']").each((_, a) => {
    const href = $l(a).attr("href");
    if (href && !/high-school/i.test(href)) seasonUrls.add(href.startsWith("http") ? href : `${BASE}${href}`);
  });

  const pages = [landing];
  for (const url of seasonUrls) {
    try {
      pages.push(await fetchHtml(url));
    } catch (err) {
      log(`PPS season fetch failed ${url}: ${err.message}`);
    }
  }

  const byId = new Map();
  for (const html of pages) parseCards(html, byId, log);
  const events = [...byId.values()];

  if (drillDown) {
    const targets = events.filter((e) => e.divisions.includes("14U") && e.slug);
    log(`PPS: ${events.length} events, drilling into ${targets.length} with 14U`);
    for (const ev of targets) {
      try {
        ev.teams_14u = await pps14uCount(ev.slug);
      } catch (err) {
        log(`PPS drill-down failed for ${ev.slug}: ${err.message}`);
      }
      await sleep(400);
    }
  }
  return events;
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
      city: meta("addressLocality").trim() || null,
      state: meta("addressRegion").trim() || "TX",
      venue: $c.find("[itemprop='location'] [itemprop='name']").first().attr("content") || null,
      divisions,
      total_registered: regMatch ? parseInt(regMatch[1], 10) : 0,
      teams_14u: null,
      cost: costMatch ? `$${costMatch[1]}` : null,
      event_url: slug ? `${BASE}/events/${slug}` : BASE,
      event_status: "Tournament",
    });
  });
}

async function pps14uCount(slug) {
  const html = await fetchHtml(`${BASE}/events/${slug}/teams`);
  const $ = cheerio.load(html);
  let count = 0;
  $(".panel-heading").each((_, el) => {
    const heading = $(el).clone().children().remove().end().text().trim();
    if (!/^14U$/i.test(heading)) return;
    const pill = $(el).find(".division-count-pill").first().text().trim();
    count += parseInt(pill, 10) || 0;
  });
  return count;
}
