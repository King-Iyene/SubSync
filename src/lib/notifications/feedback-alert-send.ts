// The owner alert flow, with every outside thing handed in (settings, state, log, clock, the two senders), so the whole flow is tested with stubs and can never send
// during a test. The real senders are in transports.ts (behind SEND_EMAIL_LIVE and SEND_SLACK_LIVE); this file names no sender.
//
// Rules: instant alerts only at the level the owner chose (default: stuck only); one alert per severity per ten minutes, the rest counted into the next; the same item
// never twice; with a live switch off the record of exactly what would be sent is written and nothing leaves; a failure here is logged and never reaches the person who sent feedback.

import { buildAlert, buildDigest, digestOn, rateDecision, raisesInstantAlert, type Alert, type AlertEvent, type AlertState, type DigestRow, type InstantLevel } from "../feedback-alert.ts";

type Env = Record<string, string | undefined>;
export type SendResult = { ok: boolean };
export type OwnerSettings = { digestOn: boolean | null; instantLevel: InstantLevel };

export type AlertDeps = {
  env: Env;
  now: () => Date;
  appUrl: string;
  settings: () => Promise<OwnerSettings>;
  getState: (key: string) => Promise<AlertState>;
  saveState: (key: string, s: { lastAlertAt: Date | null; suppressed: number; lastRef: string | null; detail: Record<string, unknown> | null }) => Promise<void>;
  /** A line in the audit table for the company that sent it (ids and kinds only unless the owner asked for text). */
  audit: (installationId: string, action: string, detail: Record<string, unknown>) => Promise<void>;
  email: (to: string, mail: { subject: string; text: string; html: string }) => Promise<SendResult>;
  slack: (url: string, text: string) => Promise<SendResult>;
  digestRows: (since: Date) => Promise<DigestRow[]>;
  log: (...a: unknown[]) => void;
};

export type Outcome = { status: "skipped" | "held" | "duplicate" | "dry_run" | "sent" | "failed"; channels: string[] };

const live = (env: Env, flag: "SEND_EMAIL_LIVE" | "SEND_SLACK_LIVE") => env[flag] === "true";

/** Deliver one prepared message to the configured channels. Dry run for a channel whose live switch is off. */
async function deliver(d: AlertDeps, m: { subject: string; text: string; html: string }): Promise<{ attempted: string[]; sent: string[]; dry: string[]; failed: string[] }> {
  const out = { attempted: [] as string[], sent: [] as string[], dry: [] as string[], failed: [] as string[] };
  const to = (d.env.FEEDBACK_NOTIFY_EMAIL ?? "").trim();
  const hook = (d.env.FEEDBACK_SLACK_WEBHOOK ?? "").trim();
  const run = async (channel: "email" | "slack", on: boolean, send: () => Promise<SendResult>) => {
    out.attempted.push(channel);
    if (!on) { out.dry.push(channel); return; }
    try { if ((await send()).ok) out.sent.push(channel); else out.failed.push(channel); } catch { out.failed.push(channel); }
  };
  if (to) await run("email", live(d.env, "SEND_EMAIL_LIVE"), () => d.email(to, m));
  if (hook) await run("slack", live(d.env, "SEND_SLACK_LIVE"), () => d.slack(hook, m.text));
  return out;
}

/** One new item. Never throws. */
export async function alertOwner(ev: AlertEvent, d: AlertDeps): Promise<Outcome> {
  try {
    const { instantLevel } = await d.settings();
    if (!raisesInstantAlert(instantLevel, ev)) return { status: "skipped", channels: [] };
    const key = `severity:${ev.severity}`;
    const state = await d.getState(key);
    const now = d.now();
    const decision = rateDecision(state, ev.ref, now);
    if (!decision.send) {
      if (decision.reason === "held") await d.saveState(key, { lastAlertAt: state.lastAlertAt, suppressed: state.suppressed + 1, lastRef: state.lastRef, detail: null });
      await d.audit(ev.installationId, "notify.king.held", { ref: ev.ref, severity: ev.severity, reason: decision.reason });
      return { status: decision.reason === "held" ? "held" : "duplicate", channels: [] };
    }
    const alert: Alert = buildAlert(ev, { env: d.env, appUrl: d.appUrl, more: state.suppressed });
    const r = await deliver(d, alert);
    if (r.attempted.length === 0) {
      await d.audit(ev.installationId, "notify.king.skipped", { ref: ev.ref, severity: ev.severity, reason: "FEEDBACK_NOTIFY_EMAIL and FEEDBACK_SLACK_WEBHOOK are not set" });
      return { status: "skipped", channels: [] };
    }
    const action = r.sent.length > 0 ? "notify.king.sent" : r.failed.length > 0 ? "notify.king.failed" : "notify.king.alert_dry_run";
    await d.audit(ev.installationId, action, { ...alert.record, channels: r.attempted, dryRun: r.sent.length === 0 && r.failed.length === 0, ...(r.failed.length ? { failed: r.failed } : {}) });
    if (r.failed.length > 0 && r.sent.length === 0) return { status: "failed", channels: r.failed };
    await d.saveState(key, { lastAlertAt: now, suppressed: 0, lastRef: ev.ref, detail: alert.record });
    return { status: r.sent.length > 0 ? "sent" : "dry_run", channels: r.attempted };
  } catch (e) {
    d.log("feedback alert failed", e instanceof Error ? e.name : "error");
    return { status: "failed", channels: [] };
  }
}

/** The optional daily summary. Safe to call more than once a day: it only goes when 20 hours have passed since the last one. Never throws. */
export async function sendDigest(d: AlertDeps): Promise<Outcome & { total: number }> {
  try {
    const { digestOn: setting } = await d.settings();
    if (!digestOn(d.env, setting)) return { status: "skipped", channels: [], total: 0 };
    const state = await d.getState("digest");
    const now = d.now();
    if (state.lastAlertAt && now.getTime() - state.lastAlertAt.getTime() < 20 * 3600 * 1000) return { status: "held", channels: [], total: 0 };
    const rows = await d.digestRows(state.lastAlertAt ?? new Date(now.getTime() - 24 * 3600 * 1000));
    const digest = buildDigest(rows, { env: d.env, appUrl: d.appUrl });
    if (digest.empty) { await d.saveState("digest", { lastAlertAt: now, suppressed: 0, lastRef: null, detail: { total: 0 } }); return { status: "skipped", channels: [], total: 0 }; }
    const r = await deliver(d, digest);
    if (r.attempted.length === 0) return { status: "skipped", channels: [], total: rows.length };
    if (r.sent.length === 0 && r.failed.length > 0) return { status: "failed", channels: r.failed, total: rows.length };
    await d.saveState("digest", { lastAlertAt: now, suppressed: 0, lastRef: null, detail: { ...digest.record, channels: r.attempted, dryRun: r.sent.length === 0 } });
    return { status: r.sent.length > 0 ? "sent" : "dry_run", channels: r.attempted, total: rows.length };
  } catch (e) {
    d.log("feedback digest failed", e instanceof Error ? e.name : "error");
    return { status: "failed", channels: [], total: 0 };
  }
}
