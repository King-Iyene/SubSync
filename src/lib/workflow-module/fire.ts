import { outward, type Deps as LiveDeps } from "../live-flags";
import { localClock } from "../analytics/digest-intel";
import { ghlFetch } from "../ghl/http";
import { VERSION } from "../ghl/crm-gateway";
import { TRIGGERS, dedupeKey, heldForQuiet, roomLeft, triggerPayload, type Subject, type TriggerKey } from "./core";
import type { Target } from "./store";

// Fires the module's triggers (flag wf_module, default off). SubSync tells the customer's workflow that something needs attention; the workflow decides what to do.
// Rules, in this order, for every account and trigger: switched on for the account; the CRM has told us where to send it (a subscription); outside quiet hours; room under the
// per-hour, per-day and per-run caps; never a Do Not Disturb contact (the candidate lists leave them out); one send per episode (the dedupe record); and the master switch
// WORKFLOWS_WRITE_LIVE (off: one "WOULD WRITE" line per account and trigger, nothing sent, nothing recorded as sent so it can still fire later).
//
// CHECK (the docs describe the subscription call but not the firing call): the request below (POST to the address the CRM gave, the account's token, Version header, JSON body)
// is the best reading of the docs and must be proved on a test account before WORKFLOWS_WRITE_LIVE is switched on. No message text is ever in the body.

export type FireDeps = {
  candidates: (t: Target, key: TriggerKey, now: number, limit: number) => Promise<Subject[]>;
  counts: (t: Target, key: TriggerKey) => Promise<{ hour: number; day: number }>;
  alreadySent: (t: Target, dedupe: string) => Promise<boolean>;
  record: (t: Target, key: TriggerKey, dedupe: string, contactId: string | null, status: "sent" | "failed", http: number | null) => Promise<boolean>;
  token: (t: Target) => Promise<string>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  live?: LiveDeps;
};
export type FireReport = { accounts: number; sent: number; wouldSend: number; held: number; skipped: number; failed: number };
export const SPACING_MS = 400;

export async function fireTarget(t: Target, now: number, d: FireDeps, rep: FireReport): Promise<void> {
  const zone = t.tz ?? "UTC";
  const hour = localClock(new Date(now), zone)?.hour ?? null;
  for (const trig of TRIGGERS) {
    const key = trig.key;
    if (!t.enabled.has(key)) continue;
    const subs = [...new Map(t.subs.filter((s) => s.triggerKey === key).map((s) => [s.url, s])).values()]; // one send per address, however many workflows listen
    if (subs.length === 0) { rep.skipped++; continue; } // nothing in the customer's CRM listens for it yet
    if (heldForQuiet(hour, t.quiet)) { rep.held++; continue; }
    const c = await d.counts(t, key);
    const room = roomLeft(c.hour, c.day);
    if (room === 0) { rep.skipped++; continue; }
    const subjects = await d.candidates(t, key, now, room * 3);
    const fresh: Subject[] = [];
    for (const s of subjects) { if (fresh.length >= room) break; if (!(await d.alreadySent(t, dedupeKey(key, s.episode)))) fresh.push(s); }
    if (fresh.length === 0) continue;
    const out = await outward(
      { flag: "WORKFLOWS_WRITE_LIVE", verb: "WRITE", what: `workflow.trigger.${key}`, installationId: t.installationId, ids: { locationId: t.locationId, count: fresh.length }, fields: ["trigger"] },
      async () => {
        const token = await d.token(t);
        let sent = 0, failed = 0;
        for (const s of fresh) {
          for (const sub of subs) {
            await (d.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))))(SPACING_MS);
            const res = await ghlFetch(sub.url, { method: "POST", headers: { Authorization: `Bearer ${token}`, Version: VERSION, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(triggerPayload(key, s)), cache: "no-store" }, d.fetchImpl ? { fetchImpl: d.fetchImpl, ...(d.sleep ? { sleep: d.sleep } : {}) } : {});
            if (res.ok) { sent++; await d.record(t, key, dedupeKey(key, s.episode), s.contactId, "sent", res.status); }
            else { failed++; await d.record(t, key, dedupeKey(key, s.episode), s.contactId, "failed", res.status); if (res.status === 401 || res.status === 403 || res.status === 429) return { sent, failed, stop: true }; }
          }
        }
        return { sent, failed, stop: false };
      },
      d.live ?? {},
    );
    if (out.live) { rep.sent += out.result.sent; rep.failed += out.result.failed; } else rep.wouldSend += fresh.length;
  }
}

export async function runTriggers(now: number, d: FireDeps, targets: Target[]): Promise<FireReport> {
  const rep: FireReport = { accounts: 0, sent: 0, wouldSend: 0, held: 0, skipped: 0, failed: 0 };
  for (const t of targets) { rep.accounts++; try { await fireTarget(t, now, d, rep); } catch { rep.failed++; } }
  return rep;
}
