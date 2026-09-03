// GET /api/player?first=Elliott&last=Walther[&state=TX][&id=202943]
//
// Looks a youth player up on NCS's public player search and returns the
// matches plus, when there's exactly one match (or an id is given), that
// player's roster history. The dashboard can't call playncs.com directly
// (no CORS), so this function relays it. Read-only; nothing is stored.
import * as cheerio from "cheerio";

const BASE = "https://www.playncs.com";
const UA = "Mozilla/5.0 (compatible; BaseballTimeTX/1.0)";
const NAME = /^[A-Za-z][A-Za-z' .-]{0,39}$/;
const text = (el) => el.text().replace(/\s+/g, " ").trim();

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} from NCS`);
  return res.text();
}

async function search(first, last, state) {
  const q = new URLSearchParams({ firstName: first, lastName: last, country: "US" });
  if (state) q.set("usState", state);
  const $ = cheerio.load(await fetchHtml(`${BASE}/baseball/Players?${q}`));
  const rows = [];
  $("table tbody tr").each((_, tr) => {
    const cells = $(tr).find("td");
    const href = $(tr).find("a[href*='/Players/Details/']").attr("href") || "";
    const m = href.match(/\/Players\/Details\/(\d+)\//);
    if (!m) return;
    rows.push({
      id: m[1],
      name: text($(tr).find("a").first()),
      state: text(cells.eq(1)),
      age: text(cells.eq(2)),
      url: `${BASE}${href}`,
    });
  });
  return rows;
}

async function roster(id) {
  const $ = cheerio.load(await fetchHtml(`${BASE}/baseball/Players/Details/${id}/p`));
  const out = [];
  $("table tbody tr").each((_, tr) => {
    const c = $(tr).find("td");
    if (c.length < 5) return;
    // Columns: Team Name / Location | City / State | Division | Season | Status
    const teamCell = text(c.eq(0));
    const city = text(c.eq(1));
    out.push({
      team: teamCell.replace(city, "").trim() || teamCell,
      city,
      division: text(c.eq(2)),
      season: text(c.eq(3)),
      status: text(c.eq(4)),
    });
  });
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");
  try {
    const { first = "", last = "", state = "", id = "" } = req.query || {};
    if (id) {
      if (!/^\d{1,9}$/.test(id)) return res.status(400).json({ error: "bad id" });
      return res.status(200).json({ id, roster: await roster(id) });
    }
    if (!NAME.test(first) || !NAME.test(last)) return res.status(400).json({ error: "first and last name required (letters only)" });
    if (state && !/^[A-Z]{2}$/.test(state)) return res.status(400).json({ error: "bad state" });
    const matches = await search(first.trim(), last.trim(), state);
    const body = { matches };
    if (matches.length === 1) body.roster = await roster(matches[0].id);
    return res.status(200).json(body);
  } catch (err) {
    return res.status(502).json({ error: err.message || String(err) });
  }
}
