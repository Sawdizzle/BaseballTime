import { createClient } from "@supabase/supabase-js";
import { haversineMiles } from "./util.js";

// Emails people a digest of tournaments that are NEW since we last wrote to
// them and that match the search they saved. Runs after each scrape.
//
// Deliberately quiet: nothing new means no email. Confirmation is double
// opt-in, and every message carries a one-click unsubscribe.
const SITE = process.env.ALERT_SITE || "https://www.youthbaseballtimeintx.com";
const FROM = process.env.ALERT_FROM || "Baseball Time in TX <alerts@youthbaseballtime.com>";
const REPLY_TO = process.env.ALERT_REPLY_TO || "info@youthbaseballtime.com";
const KEY = process.env.RESEND_API_KEY;
const MAX_ROWS = 12;
const log = console.error;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const day = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

async function sendEmail({ to, subject, html, text }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text, reply_to: REPLY_TO }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
}

const shell = (heading, inner, unsubUrl) => `<div style="font:16px/1.5 system-ui,sans-serif;color:#0b1220;max-width:560px;margin:0 auto;padding:20px">
<h1 style="font-size:20px;margin:0 0 14px">${heading}</h1>
${inner}
<p style="margin-top:26px;font-size:12px;color:#4a5f76;border-top:1px solid #b7d0e4;padding-top:12px">
Baseball Time in TX — free, run by a dad in Sanger.
<a href="${unsubUrl}" style="color:#4a5f76">Unsubscribe</a>
</p></div>`;

function matches(ev, f) {
  const ages = Array.isArray(f.ages) && f.ages.length ? f.ages : ["10U", "11U", "12U", "13U", "14U"];
  const mine = (ev.divisions || []).filter((d) => ages.includes(d));
  if (!mine.length) return null;
  if (Array.isArray(f.orgs) && f.orgs.length && !f.orgs.includes(ev.org)) return null;
  let dist = null;
  if (Number.isFinite(f.lat) && Number.isFinite(f.lng)) {
    if (ev.lat == null || ev.lng == null) return null;
    dist = haversineMiles({ lat: f.lat, lng: f.lng }, { lat: +ev.lat, lng: +ev.lng });
    if (dist > (f.miles ?? 80)) return null;
  }
  const counts = ev.division_counts || {};
  const best = Math.max(...mine.map((a) => counts[a] ?? ev.total_registered ?? 0));
  if (best < (f.min ?? 0)) return null;
  return { mine, dist, counts };
}

async function main() {
  if (!KEY) {
    log("alerts: RESEND_API_KEY not set — skipping (nothing sent).");
    return;
  }
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "tourneyscan" },
    auth: { persistSession: false },
  });

  // 1. Confirmations for anyone who signed up since the last run.
  const { data: pending, error: pErr } = await db
    .from("alert_subscriptions")
    .select("id,email,token")
    .eq("status", "pending")
    .is("confirm_sent_at", null);
  if (pErr) throw pErr;
  for (const sub of pending || []) {
    const url = `${SITE}/confirm?t=${sub.token}`;
    try {
      await sendEmail({
        to: sub.email,
        subject: "Confirm your Baseball Time alerts",
        text: `Confirm your alerts: ${url}\n\nIf you didn't ask for this, ignore this email and nothing will be sent.`,
        html: shell("One tap to start", `<p>Confirm and we'll email you when new tournaments match your search.</p>
<p><a href="${url}" style="display:inline-block;background:#1f6fb8;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:6px">Confirm my alerts</a></p>
<p style="font-size:13px;color:#4a5f76">If you didn't ask for this, ignore this email and nothing will be sent.</p>`,
          `${SITE}/unsubscribe?t=${sub.token}`),
      });
      await db.from("alert_subscriptions").update({ confirm_sent_at: new Date().toISOString() }).eq("id", sub.id);
      log(`alerts: confirmation sent to ${sub.email}`);
    } catch (err) {
      log(`alerts: confirmation FAILED for ${sub.email}: ${err.message}`);
    }
  }

  // 2. Digests for confirmed subscribers who are due.
  const { data: active, error: aErr } = await db
    .from("alert_subscriptions")
    .select("id,email,token,filters,frequency,last_sent_at,verified_at")
    .eq("status", "active");
  if (aErr) throw aErr;
  if (!active?.length) { log("alerts: no active subscribers."); return; }

  const today = new Date().toISOString().slice(0, 10);
  const { data: events, error: eErr } = await db
    .from("events")
    .select("id,org,name,city,state,lat,lng,start_date,end_date,divisions,division_counts,total_registered,event_url,first_seen")
    .gte("end_date", today)
    .order("start_date");
  if (eErr) throw eErr;

  for (const sub of active) {
    const gapHours = sub.frequency === "daily" ? 20 : 24 * 6.5;
    const since = sub.last_sent_at || sub.verified_at;
    if (since && Date.now() - Date.parse(since) < gapHours * 3600e3) continue;

    const f = sub.filters || {};
    const fresh = [];
    for (const ev of events) {
      if (since && Date.parse(ev.first_seen) <= Date.parse(since)) continue;
      const m = matches(ev, f);
      if (m) fresh.push({ ev, ...m });
    }
    if (!fresh.length) continue;

    const rows = fresh.slice(0, MAX_ROWS);
    const unsub = `${SITE}/unsubscribe?t=${sub.token}`;
    const li = rows.map(({ ev, mine, dist, counts }) => {
      const when = ev.end_date && ev.end_date !== ev.start_date ? `${day(ev.start_date)}–${day(ev.end_date)}` : day(ev.start_date);
      const teams = mine.map((a) => `${a}: ${counts[a] ?? "~" + (ev.total_registered ?? 0)}`).join(", ");
      const where = [ev.city, ev.state].filter(Boolean).join(", ");
      return `<li style="margin:0 0 12px"><a href="${esc(ev.event_url)}" style="color:#1f6fb8;font-weight:700;text-decoration:none">${esc(ev.name)}</a><br>
<span style="color:#4a5f76;font-size:14px">${when} — ${esc(where)}${dist != null ? ` (${Math.round(dist)} mi)` : ""} — ${esc(ev.org)}<br>${esc(teams)} teams registered</span></li>`;
    }).join("");
    const textRows = rows.map(({ ev, mine, dist, counts }) =>
      `- ${ev.name} — ${day(ev.start_date)} — ${[ev.city, ev.state].filter(Boolean).join(", ")}${dist != null ? ` (${Math.round(dist)} mi)` : ""}\n  ${mine.map((a) => `${a}: ${counts[a] ?? "~" + (ev.total_registered ?? 0)}`).join(", ")} teams — ${ev.event_url}`
    ).join("\n");
    const more = fresh.length > rows.length ? `<p style="font-size:14px"><a href="${SITE}" style="color:#1f6fb8">and ${fresh.length - rows.length} more</a></p>` : "";
    const label = f.label ? ` near ${f.label}` : "";
    const subject = `${fresh.length} new tournament${fresh.length === 1 ? "" : "s"}${label}`;

    try {
      await sendEmail({
        to: sub.email,
        subject,
        text: `New tournaments matching your search${label}:\n\n${textRows}\n\nUnsubscribe: ${unsub}`,
        html: shell(subject, `<ul style="padding-left:18px;margin:0">${li}</ul>${more}`, unsub),
      });
      await db.from("alert_subscriptions").update({ last_sent_at: new Date().toISOString() }).eq("id", sub.id);
      log(`alerts: digest of ${fresh.length} sent to ${sub.email}`);
    } catch (err) {
      log(`alerts: digest FAILED for ${sub.email}: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error("ALERTS FATAL:", err.message || err);
  process.exit(1);
});
