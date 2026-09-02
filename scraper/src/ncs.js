import * as cheerio from "cheerio";
import { fetchHtml, parseNcsDates, splitCityState, normDivisions, sleep } from "./util.js";

const BASE = "https://www.playncs.com";
const LIST_URL = `${BASE}/baseball/Regions/texas/Events`;

export async function scrapeNCS({ drillDown = true, log = console.error } = {}) {
  const html = await fetchHtml(LIST_URL);
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
    const { city, state } = splitCityState(locRaw);
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
      cost: null,
      event_url: `${BASE}${href}`,
      event_status: $el.find(".stature").first().text().trim() || "Tournament",
    });
  });

  if (drillDown) {
    const targets = events.filter((e) => e.divisions.includes("14U") && e.total_registered > 0);
    log(`NCS: ${events.length} events, drilling into ${targets.length} with 14U`);
    const queue = [...targets];
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (queue.length) {
          const ev = queue.shift();
          try {
            ev.teams_14u = await ncs14uCount(ev.source_event_id, ev.slug);
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

async function ncs14uCount(id, slug) {
  const html = await fetchHtml(`${BASE}/baseball/Events/WhosComing/${id}/${slug}`);
  const $ = cheerio.load(html);
  let count = 0;
  $(".panel").each((_, panel) => {
    const division = $(panel).find(".division").first().text().trim();
    if (!/^14U\b/i.test(division)) return;
    $(panel)
      .find("table tbody tr")
      .each((_, tr) => {
        const cell = $(tr).find("td").eq(1);
        const isOpen = cell.find("em").length && /open/i.test(cell.text());
        if (cell.text().trim() && !isOpen) count += 1;
      });
  });
  return count;
}
