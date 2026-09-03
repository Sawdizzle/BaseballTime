// GET /confirm?t=<token>  and  /unsubscribe?t=<token>
//
// The links that appear in alert emails. Both call a SECURITY DEFINER function
// in Postgres, so the public key can act on a token it holds without being able
// to read anyone's address back out of the table.
const SUPABASE_URL = "https://yeykyutsbeqjcgdxlucn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_SLM96UPQ3Rgrf6MTpXRZUQ_LklkFhPH";
const SITE = "https://www.youthbaseballtimeintx.com";

async function rpc(fn, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Content-Profile": "tourneyscan",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

const page = (title, body) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Baseball Time in TX</title>
<link rel="icon" type="image/png" href="/icon-192.png">
<style>
  body{margin:0;min-height:100svh;display:grid;place-items:center;background:#eaf2f9;color:#0b1220;
       font:16px/1.5 "Barlow Semi Condensed",system-ui,sans-serif;padding:24px}
  .card{max-width:440px;text-align:center;background:#f6fafd;border:1.5px solid #b7d0e4;border-radius:8px;padding:28px 24px}
  img{width:64px;height:64px;border-radius:14px;margin-bottom:12px}
  h1{font-size:22px;margin:0 0 10px}
  p{margin:0 0 16px;color:#4a5f76}
  a.btn{display:inline-block;background:#1f6fb8;color:#fff;text-decoration:none;font-weight:700;
        padding:10px 18px;border-radius:6px}
</style></head><body><div class="card">
<img src="/icon-192.png" alt=""><h1>${title}</h1>${body}
<a class="btn" href="${SITE}">Back to Baseball Time</a></div></body></html>`;

export default async function handler(req, res) {
  const send = (code, html) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(code).send(html);
  };
  const token = String((req.query || {}).t || "");
  const action = String((req.query || {}).action || "confirm");
  if (!/^[a-f0-9]{32,64}$/.test(token)) {
    return send(400, page("That link looks wrong", "<p>The link was incomplete. Try copying the whole thing from the email.</p>"));
  }
  try {
    if (action === "unsubscribe") {
      const email = await rpc("stop_alerts", { p_token: token });
      return send(200, page(
        email ? "You're unsubscribed" : "Already unsubscribed",
        `<p>${email ? `No more alerts will go to ${email}.` : "That address is already off the list."} You can sign up again any time.</p>`
      ));
    }
    const email = await rpc("confirm_alerts", { p_token: token });
    if (!email) {
      return send(404, page("Link expired", "<p>That confirmation link is no longer valid. Sign up again and we'll send a fresh one.</p>"));
    }
    return send(200, page("You're all set", `<p>We'll email ${email} when new tournaments match your search. Every alert has an unsubscribe link.</p>`));
  } catch (err) {
    return send(502, page("Something went wrong", `<p>${String(err.message).slice(0, 200)}</p>`));
  }
}
