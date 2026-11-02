import { sql } from "@/lib/db";
import { matchesEmail, readUnsubscribe } from "@/lib/unsubscribe";
import { removeRecipientByMatch } from "@/lib/notifications/store";

// The "stop these emails" link. A GET only shows a button (mail scanners open links without anyone asking them to, so a GET must never
// change anything); the POST, from that button or from a mail app's one-click unsubscribe, removes the address from the installation's
// settings. The token is signed and names the installation and the address it was sent to; nothing else is accepted, and the page says
// the same thing whether or not the address was still there.
const page = (title: string, body: string, status = 200) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${title}</title></head>` +
  `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:12vh auto;padding:0 20px;color:#111"><h1 style="font-size:20px">${title}</h1>${body}</body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" } },
);

const tokenOf = (request: Request) => new URL(request.url).searchParams.get("t");

export async function GET(request: Request) {
  const t = tokenOf(request);
  if (!readUnsubscribe(t)) return page("This link does not work", "<p>It is damaged or it was not made for this address. Open the app and use Settings to change where emails go.</p>", 400);
  return page("Stop these emails?", `<p>You will no longer get the weekly summary or alert emails at this address. You can add an address again in Settings.</p><form method="post" action="?t=${encodeURIComponent(t as string)}"><button type="submit" style="padding:10px 16px;border:0;border-radius:8px;background:#0f766e;color:#fff;font-size:15px;cursor:pointer">Stop these emails</button></form>`);
}

export async function POST(request: Request) {
  const u = readUnsubscribe(tokenOf(request));
  if (!u) return page("This link does not work", "<p>It is damaged or it was not made for this address.</p>", 400);
  const [row] = await sql()`select digest_email from settings where installation_id = ${u.installationId}`;
  const wasSet = Boolean(row && matchesEmail(u, row.digest_email as string | null));
  if (wasSet) await sql()`update settings set digest_email = null where installation_id = ${u.installationId}`;
  // The address is also taken out of every kind of message in Notifications (F9), so one click stops all of them; a held or waiting message to it is skipped.
  const removed = await removeRecipientByMatch(u.installationId, (e) => matchesEmail(u, e));
  if (wasSet || removed > 0) await sql()`insert into audit_log (installation_id, actor, action, detail) values (${u.installationId}, 'email-link', 'email.unsubscribed', ${sql().json({} as never)})`;
  return page("Done", "<p>These emails have stopped. You can add an address again in Settings whenever you like.</p>");
}
