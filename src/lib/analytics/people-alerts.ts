import { sql } from "../db";
import { resolveEntitlements } from "../flags";
import { safeError } from "../safe-log";
import { dispatchIntents, loadContext } from "../notifications/service";
import type { Intent } from "../notifications/dispatcher";
import { createPrivateAlert, type PrivateAlertInput } from "./inbox-breach-alerts";
import { alertFacts, weekTeamFacts } from "./people-actions-queries";
import { idleAlert, overloadAlerts, teamWeekLines, type PeopleAlert } from "./people-actions";

// Team alerts (slice PB), checked by the hourly job when the flag pp_idle is on: a quiet person (leads waiting, no activity recorded in your CRM for a few hours) and an overloaded
// person (far more leads waiting than the team's usual). They go through the SAME alert engine as every other alert (createPrivateAlert, then the notification dispatcher), so they
// are deduped (one per person, account and day), held in quiet hours, and email stays in dry run until the live switch is on. They go to the account's administrator only; an account
// the agency has quieted for replies is skipped; a person marked away or snoozed is skipped. Nothing here messages a lead, and nothing says anyone is "not working".

/** Most team alerts one company gets in one hourly run. */
export const PEOPLE_ALERTS_PER_RUN = 10;

export async function runPeopleAlerts(installationId: string, now: number): Promise<number> {
  const accounts = await alertFacts(installationId, now);
  const day = new Date(now).toISOString().slice(0, 10);
  const created: Array<{ id: string; input: PrivateAlertInput }> = [];
  for (const a of accounts) {
    if (a.muted || !a.adminId || created.length >= PEOPLE_ALERTS_PER_RUN) continue;
    const fire: PeopleAlert[] = [];
    for (const p of a.people) {
      const al = p.idle ? idleAlert(p.idle, now) : null;
      if (al) fire.push(al);
    }
    fire.push(...overloadAlerts(a.accountName, a.locationId, a.people));
    for (const al of fire) {
      if (created.length >= PEOPLE_ALERTS_PER_RUN) break;
      const dedupeKey = `${al.kind}:${a.locationId}:${String(al.detail.userId)}:${day}`;
      // One per person per account per day, even if the first was already marked done.
      const [seen] = await sql()`select 1 from alerts where installation_id = ${installationId} and dedupe_key = ${dedupeKey} limit 1`;
      if (seen) continue;
      const input: PrivateAlertInput = { locationId: a.locationId, recipientUserKey: a.adminId, accountName: a.accountName, kind: al.kind, dedupeKey, title: al.title, detail: al.detail };
      const id = await createPrivateAlert(installationId, input, now);
      if (id) created.push({ id, input });
    }
  }
  if (created.length) {
    const loaded = await loadContext(installationId);
    const intents: Intent[] = created.map(({ id, input }) => ({
      type: "other_alerts", locationId: input.locationId, severity: "warning", recipientUserKey: input.recipientUserKey, respectQuietHours: true, emailDryRunOnly: true,
      dedupeKey: `alert:${id}`, alertId: id, values: { account: input.accountName ?? "A client account", problem: input.title }, link: { view: "team", locationId: input.locationId },
    }));
    await dispatchIntents(installationId, intents, now, loaded);
  }
  return created.length;
}

/** The team lines for the weekly summary (and Monday's brief): empty unless the flag pp_scorecards is on and at least two people have enough leads. Never throws. */
export async function weeklyTeamLines(installationId: string, now: number): Promise<string[]> {
  try {
    const [inst] = await sql()`select plan from installations where id = ${installationId}`;
    const ent = await resolveEntitlements((inst?.plan as "free" | "starter" | "pro" | undefined) ?? "pro", installationId);
    if (!(ent.features.pp_scorecards && !ent.locked.includes("pp_scorecards"))) return [];
    const f = await weekTeamFacts(installationId, now);
    return teamWeekLines(f.people, f.noPersonReply);
  } catch (error) {
    console.error("Team lines could not be built; the summary goes out without them", safeError(error));
    return [];
  }
}
