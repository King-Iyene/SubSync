// The real wiring of the owner alert flow (src/lib/notifications/feedback-alert-send.ts): the database, the clock and the gated senders. Best effort: nothing here throws.
import { sql } from "../db";
import { referenceOf, type Severity } from "../feedback.ts";
import { alertOwner, sendDigest, type AlertDeps, type Outcome } from "./feedback-alert-send.ts";
import { alertState, digestRows, ownerSettings, saveAlertState } from "../feedback-owner-queries";
import { feedbackSenders } from "./transports";
import type { AlertEvent } from "../feedback-alert.ts";

export function realDeps(): AlertDeps {
  return {
    env: process.env, now: () => new Date(), appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, ""),
    settings: ownerSettings, getState: alertState, saveState: saveAlertState, digestRows,
    audit: async (installationId, action, detail) => {
      const db = sql();
      await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, 'feedback', ${action}, ${db.json(detail as never)})`;
    },
    email: feedbackSenders.email, slack: feedbackSenders.slack, log: (...a) => console.error(...a),
  };
}

export type NewItem = { kind: "feedback" | "problem" | "suggestion"; severity: Severity; installationId: string; page: string | null; id: string; text: string | null };

/** Called after a person's feedback is saved. Looks up only the company's name, then follows the owner's rules. Never throws, so it can never break the submission. */
export async function notifyOwnerOfFeedback(item: NewItem, deps: AlertDeps = realDeps()): Promise<Outcome> {
  let company: string | null = null;
  try { const [r] = await sql()`select company_name from installations where id = ${item.installationId}`; company = (r?.company_name as string | null) ?? null; } catch { /* the short id is enough */ }
  const ev: AlertEvent = { kind: item.kind, severity: item.severity, installationId: item.installationId, company, page: item.page, ref: referenceOf(item.id), text: item.text };
  return alertOwner(ev, deps);
}

export const runFeedbackDigest = (deps: AlertDeps = realDeps()) => sendDigest(deps);
