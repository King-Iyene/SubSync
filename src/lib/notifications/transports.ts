// The real transports the dispatcher sends through (stage F9). Every email and every Slack post goes through `outward()` (src/lib/live-flags.ts): with
// SEND_EMAIL_LIVE or SEND_SLACK_LIVE off, the request is built, a "WOULD SEND" line (ids only, never the words of the message) is written to the log and the
// audit table, and nothing leaves the server. The bell is our own database, so it is not outward and is always live.

import { emailConfigured, sendEmailResult, unsubscribeHeaders } from "../email";
import { outward } from "../live-flags";
import { sql } from "../db";
import type { Mail } from "./compose";
import type { Row, SendResult, Transports } from "./dispatcher";
import { insertNotification, markDestination, webhookOf } from "./store";
import { postSlackWebhook, type Destination } from "./slack";
import { assertAllowlisted, TEST_EMAIL_CAP, type SendResult as TestSendResult, type TestSendDeps } from "./test-send";

type StopUrl = (email: string) => string | null;

/** One email, through the switch. `rows` are only used for the ids in the log line. */
async function sendMail(installationId: string, to: string, mail: Mail, stopUrl: StopUrl, what: string, ids: Record<string, string | null>): Promise<SendResult> {
  const stop = stopUrl(to);
  const out = await outward({ flag: "SEND_EMAIL_LIVE", verb: "SEND", what, installationId, ids }, async (): Promise<SendResult> => {
    if (!emailConfigured()) return { ok: false, permanent: false, code: "email_not_configured" };
    const r = await sendEmailResult(to, { ...mail, ...(stop ? { headers: unsubscribeHeaders(stop) } : {}) });
    return r.ok ? { ok: true } : { ok: false, permanent: r.permanent, code: `http_${r.status}` };
  });
  return out.live ? out.result : { ok: true, dryRun: true };
}

export function realTransports(installationId: string, stopUrl: StopUrl): Transports {
  return {
    async inApp(row: Row): Promise<SendResult> {
      await insertNotification({ installationId, locationId: row.locationId, type: row.type, severity: row.severity, item: row.payload, alertId: row.alertId, dedupeKey: row.dedupeKey });
      return { ok: true };
    },
    email: (to: string, mail: Mail, rows: Row[]) => sendMail(installationId, to, mail, stopUrl, "notify.email", { notification: rows[0]?.id ?? null, type: rows[0]?.type ?? null }),
    async slack(destination: Destination, text: string, rows: Row[]): Promise<SendResult> {
      const out = await outward({ flag: "SEND_SLACK_LIVE", verb: "SEND", what: "notify.slack", installationId, ids: { destination: destination.id, notification: rows[0]?.id ?? null, type: rows[0]?.type ?? null } }, async (): Promise<SendResult> => {
        const url = await webhookOf(installationId, destination.id);
        if (!url) return { ok: false, permanent: true, code: "no_address", needsReconnect: true };
        const r = await postSlackWebhook(url, text);
        if (r.ok) { await markDestination(installationId, destination.id, "connected", null); return { ok: true }; }
        if (r.needsReconnect) await markDestination(installationId, destination.id, "needs_reconnect", r.code);
        return { ok: false, permanent: r.permanent, code: r.code, needsReconnect: r.needsReconnect };
      });
      return out.live ? out.result : { ok: true, dryRun: true };
    },
  };
}

/** A single Slack test message to one channel, through the switch. */
export async function testSlackDestination(installationId: string, destination: Destination, text: string): Promise<{ ok: true; dryRun: boolean } | { ok: false; code: string; message: string; needsReconnect: boolean }> {
  const out = await outward({ flag: "SEND_SLACK_LIVE", verb: "SEND", what: "notify.slack_test", installationId, ids: { destination: destination.id } }, async () => {
    const url = await webhookOf(installationId, destination.id);
    if (!url) return { ok: false as const, code: "no_address", permanent: true, needsReconnect: true, message: "This channel has no saved address. Connect it again." };
    const r = await postSlackWebhook(url, text);
    if (r.ok) await markDestination(installationId, destination.id, "connected", null);
    else if (r.needsReconnect) await markDestination(installationId, destination.id, "needs_reconnect", r.code);
    return r;
  });
  if (!out.live) return { ok: true, dryRun: true };
  return out.result.ok ? { ok: true, dryRun: false } : { ok: false, code: out.result.code, message: out.result.message, needsReconnect: out.result.needsReconnect };
}

/** The dependencies of the allowlisted "send me a test" path (src/lib/notifications/test-send.ts), wired to the real sender and the audit table. */
export function testSendDeps(installationId: string, stopUrl: StopUrl, switchOn: () => boolean): TestSendDeps {
  return {
    switchOn,
    liveReady: emailConfigured,
    // The only real send outside the dispatcher. It asserts the allowlist again itself, so a bug in the caller cannot send to anyone else.
    async liveSend(to, mail): Promise<TestSendResult> {
      assertAllowlisted(to);
      if (!emailConfigured()) return { ok: false, permanent: false, code: "email_not_configured" };
      const stop = stopUrl(to);
      const r = await sendEmailResult(to, { ...mail, ...(stop ? { headers: unsubscribeHeaders(stop) } : {}) });
      return r.ok ? { ok: true } : { ok: false, permanent: r.permanent, code: `http_${r.status}` };
    },
    async gatedSend(to, mail): Promise<TestSendResult> {
      const r = await sendMail(installationId, to, mail, stopUrl, "notify.test_email", {});
      return r.ok ? { ok: true, dryRun: "dryRun" in r && r.dryRun === true } : { ok: false, permanent: r.permanent, code: r.code };
    },
    async usedInLast24h(): Promise<number> {
      const [r] = await sql()`select count(*)::int n from audit_log where action = 'notify.test_email_live' and at > now() - interval '24 hours'`;
      return (r?.n as number) ?? 0;
    },
    async recordUse(): Promise<void> {
      const db = sql();
      await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, 'notifications', 'notify.test_email_live', ${db.json({ cap: TEST_EMAIL_CAP } as never)})`;
    },
  };
}
