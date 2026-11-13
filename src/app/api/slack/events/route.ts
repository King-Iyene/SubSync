import { after, NextResponse } from "next/server";
import { askData } from "@/lib/ai/data/ask";
import { JOB_FLAG } from "@/lib/ai/data/flags";
import { realDeps } from "@/lib/ai/brief";
import { killedGlobally } from "@/lib/ai/gateway";
import { sql } from "@/lib/db";
import { featureOn, resolveEntitlements } from "@/lib/flags";
import { handleSlackRequest, type ChatDeps } from "@/lib/slack-chat/handler";
import { claimEvent, findLink, postReply, recentCount } from "@/lib/slack-chat/store";
import { safeError } from "@/lib/safe-log";
import { companyDomain } from "@/lib/analytics/queries";
import { deepLinks } from "@/lib/links";

// Slack's Events API address (docs/SLACK_CHAT_SETUP.md). Behind the slack_chat flag, default off. Every request is checked against Slack's signature first; the rules
// are in src/lib/slack-chat/handler.ts. We answer at once and work after the response, because Slack waits three seconds.
export const maxDuration = 60;

const crmUrl = async (link: { installationId: string; locationId: string | null }) => { if (!link.locationId) return null; const d = await companyDomain(link.installationId).catch(() => null); return deepLinks(d?.appDomain).account(link.locationId); };

const deps = (): ChatDeps => ({
  enabled: async () => !killedGlobally() && (await featureOn("slack_chat")),
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  now: () => Date.now(),
  claimEvent, findLink, recentCount,
  ask: async (link, question, userKey) => {
    // The company must still have AI, Ask your data and chat switched on; the customer's own AI key and caps are enforced by the gateway.
    const [inst] = await sql()`select plan from installations where id = ${link.installationId} and uninstalled_at is null and not is_demo`.catch(() => []);
    if (!inst) return { ok: false, code: "job_off", message: "This account is not active." };
    const ent = await resolveEntitlements((inst.plan as never) ?? "pro", link.installationId);
    if (ent.features.slack_chat !== true || ent.features.ai_byo !== true || ent.features[JOB_FLAG.ask_data as never] !== true) return { ok: false, code: "job_off", message: "AI answers are not switched on for this account yet." };
    // The tenant comes from the linked workspace only. A Slack person is not matched to an app role, so answers are account-level totals and no names go to the AI.
    const tenant = { installationId: link.installationId, locationId: link.locationId, allowed: link.locationId ? [link.locationId] : null };
    return askData({ tenant, userKey, question, deps: realDeps(), anonymous: true });
  },
  post: (link, channel, thread, text) => postReply(link, channel, thread, text),
  crmUrl,
  later: (fn) => after(fn),
  log: (code, detail) => console.log(code, JSON.stringify(detail ?? {})),
});

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 100_000) return NextResponse.json({ error: "Too large" }, { status: 413 });
    const r = await handleSlackRequest(raw, { timestamp: request.headers.get("x-slack-request-timestamp"), signature: request.headers.get("x-slack-signature") }, deps());
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    console.error("Slack chat request failed", safeError(error));
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}
