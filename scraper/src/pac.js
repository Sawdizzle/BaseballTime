import * as cheerio from "cheerio";
import { fetchHtml, parseSlashDates, splitCityState, normDivisions } from "./util.js";

// The grid defaults to 5 rows; limit=1000 is the "All" option in its page-size
// selector. Without it we only ever saw the first page.
const GRID_URL = "https://playpacsports.com/cmsportevents/index/grid/?limit=1000";

// PAC grid: ul.list-item rows with classed li columns. No public per-division
// team list, so per-division counts stay empty (dashboard shows total with a flag).
export async function scrapePAC({ log = console.error } = {}) {
  const html = await fetchHtml(GRID_URL);
  const $ = cheerio.load(html);
  const events = [];

  $("ul.list-item").each((_, ul) => {
    const $ul = $(ul);
    const col = (name) => $ul.find(`li[class*='col-${name}']`).first();
    // Sport column is populated for every real row; a blank one is a
    // cheer/football row with no sport tag, not a baseball event.
    const sport = col("sport_id").text().trim();
    if (!/baseball/i.test(sport)) return;

    const nameLink = col("event_name").find("a").first();
    if (!nameLink.length) return;
    const href = (nameLink.attr("href") || "").trim();
    const idMatch = href.match(/event_id=(\d+)/);
    if (!idMatch) return;

    const { city, state } = splitCityState(col("location").text().trim());
    const { start, end } = parseSlashDates(col("start_date").text());
    const registered = parseInt(col("total_team").find("span.number").text().trim(), 10) || 0;
    const divisions = normDivisions(col("age").text().split("|").filter((s) => /\d+U/i.test(s)));

    events.push({
      org: "PAC",
      source_event_id: idMatch[1],
      name: nameLink.text().trim(),
      start_date: start,
      end_date: end,
      city,
      state,
      venue: (col("location").text().split("|")[1] || "").trim() || null,
      divisions,
      total_registered: registered,
      teams_14u: null,
      division_counts: {},
      cost: null,
      event_url: href.startsWith("http") ? href : `https://playpacsports.com${href}`,
      event_status: col("stature").text().trim() || "Tournament",
    });
  });

  log(`PAC: ${events.length} baseball events`);
  return events;
}
