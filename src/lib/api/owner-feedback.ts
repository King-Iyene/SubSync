// The platform owner's Feedback inbox (docs/FEEDBACK.md). Four routes under /api/app/owner/feedback; every one answers 404 unless the signed session is the platform owner
// (authenticate() already does this before any rule runs; each handler checks again, so a mistake in one place cannot open the inbox). Read and change only: replying to a sender is a follow-up.
import { isTriageStatus, parseOwnerSettings } from "../feedback-alert.ts";
import { inbox, lastAlertRecords, newCount, ownerSettings, parseInboxFilters, saveOwnerSettings, setStatus, voteCounts } from "../feedback-owner-queries";
import { json, ownerSession, type AuthContext } from "./auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => json({ error: "Not found" }, 404);
const actorOf = (ctx: AuthContext) => ctx.session.userName ?? ctx.session.userId ?? "owner";

/** Which delivery is set up, as yes or no only. The addresses themselves are never sent anywhere. */
export function deliveryStatus(env: Record<string, string | undefined> = process.env) {
  return {
    emailSet: Boolean((env.FEEDBACK_NOTIFY_EMAIL ?? "").trim()), slackSet: Boolean((env.FEEDBACK_SLACK_WEBHOOK ?? "").trim()),
    emailLive: env.SEND_EMAIL_LIVE === "true", slackLive: env.SEND_SLACK_LIVE === "true", includeText: env.FEEDBACK_NOTIFY_INCLUDE_TEXT === "true", digestEnv: env.FEEDBACK_DIGEST === "daily",
  };
}

export async function handleOwnerFeedback(ctx: AuthContext, request: Request, segments: string[]): Promise<Response> {
  if (!ownerSession(ctx.session)) return notFound();
  const [, b, c] = segments;
  if (b !== "feedback") return notFound();
  const method = request.method;
  if (method === "GET" && !c) {
    const filters = parseInboxFilters(new URL(request.url));
    const [list, settings, votes, records] = await Promise.all([inbox(filters), ownerSettings(), voteCounts(), lastAlertRecords()]);
    return json({ ...list, filters, settings, votes, records, delivery: deliveryStatus() });
  }
  if (method === "GET" && c === "count") return json({ count: await newCount() });
  if (method === "POST" && c === "status") {
    const body = (await request.json().catch(() => null)) as { itemKind?: unknown; id?: unknown; status?: unknown } | null;
    if (!body || (body.itemKind !== "feedback" && body.itemKind !== "suggestion") || typeof body.id !== "string" || !UUID.test(body.id) || !isTriageStatus(body.status)) return json({ error: "Choose an item and a status." }, 400);
    const ok = await setStatus(body.itemKind, body.id, body.status, actorOf(ctx));
    return ok ? json({ ok: true }) : notFound();
  }
  if (method === "POST" && c === "settings") {
    const parsed = parseOwnerSettings(await request.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    return json({ ok: true, settings: await saveOwnerSettings(parsed.value, actorOf(ctx)) });
  }
  return notFound();
}
