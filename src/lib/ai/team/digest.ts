import { sql } from "../../db";
import { resolveEntitlements } from "../../flags";
import type { Plan } from "../../entitlements";
import { publicConnection } from "../store";
import { oneThingCandidates, weakestAccounts } from "./data";
import { oneThing } from "./run";

// The weekly "one thing to fix" lines for the weekly summary email. Up to three accounts (the weakest answered-in-time share over 14 days). Our code picks the item and its figures; the AI only words
// it. Only when the company has the feature on, an AI connection with this job switched on, and the account's own choice allows it. Never throws and never blocks the email: on any problem it returns nothing.
export async function oneThingLines(inst: string, now = Date.now()): Promise<string[]> {
  try {
    const [row] = await sql()`select plan from installations where id = ${inst}`;
    const ent = await resolveEntitlements((row?.plan ?? "free") as Plan, inst, false);
    if (!ent.features.ai_byo || !ent.features.ai_one_thing) return [];
    const conn = await publicConnection(inst, "");
    if (!conn || conn.paused || conn.status !== "connected" || conn.jobs.one_thing !== true) return [];
    const out: string[] = [];
    for (const a of await weakestAccounts(inst, 3, now)) {
      const r = await oneThing({ installationId: inst, locationId: a.locationId, userKey: null, trigger: "scheduled" }, await oneThingCandidates(inst, a.locationId));
      if (r.ok) out.push(`One thing to fix for ${a.name}: ${r.text}`);
      else if (r.code === "cap" || r.code === "rate" || r.code === "killed") break;
    }
    return out;
  } catch { return []; }
}
