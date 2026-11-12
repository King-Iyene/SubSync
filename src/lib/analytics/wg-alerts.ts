import { sql } from "../db";
import type { Intent } from "../notifications/dispatcher";
import { dispatchIntents, loadContext } from "../notifications/service";
import { createPrivateAlert, type PrivateAlertInput } from "./inbox-breach-alerts";
import { boardRows, getPrefs } from "./wg-queries";
import { dayKey, planAlerts, type Spike } from "./wg-core";

// Wallet alerts (flag wg_alerts), checked by the hourly job: the credit balance is empty, low (under the limit or about to run out at the usual spend), or spending jumped far above the
// account's own normal. They go through the SAME alert engine as every other alert (createPrivateAlert, then the notification dispatcher): one per episode (a low balance alerts once until the
// account is topped up, a spike once a day), held in quiet hours, shown in the bell, and email or Slack go through the one outward gate (nothing leaves the server until its live switch is on).
// They go to the owners and admins who chose "Alert me" (wg_watchers), never to a client. A paused account is skipped. When a balance recovers its open alerts are closed. Nothing here
// messages a lead and nothing changes the CRM.

export const WALLET_ALERTS_PER_RUN = 20;

export async function runWalletAlerts(inst: string, now = Date.now()): Promise<number> {
  const db = sql();
  const prefs = await getPrefs(inst);
  if (!prefs.alertsOn) return 0;
  const { rows } = await boardRows({ inst, allowed: null }, { account: () => "" }, now);
  const st = await db`select location_id, last_topup_at, spike_day::text sd from wg_state where installation_id = ${inst}`.catch(() => []);
  const meta = new Map(st.map((r) => [r.location_id as string, r]));
  const watchers = (await db`select user_key from wg_watchers where installation_id = ${inst}`.catch(() => [])).map((r) => r.user_key as string);
  const day = dayKey(now);
  const created: Array<{ id: string; input: PrivateAlertInput; severity: "warning" | "critical" }> = [];

  // A balance that recovered closes its open alerts (the bell shows them as resolved).
  const healthy = rows.filter((r) => r.balance !== null && (r.level === "ok" || r.level === "spike")).map((r) => r.locationId);
  if (healthy.length) await db`update alerts set resolved_at = now() where installation_id = ${inst} and kind in ('wg_low', 'wg_empty') and resolved_at is null and location_id = any(${healthy}::text[])`;

  for (const r of rows) {
    if (created.length >= WALLET_ALERTS_PER_RUN) break;
    if (r.pausedUntil || r.balance === null) continue;
    const m = meta.get(r.locationId);
    const spike: Spike = { enough: r.spike, spike: r.spike, day: (m?.sd as string | null) ?? null, spent: r.spikeSpent, baseline: r.spikeBaseline };
    const lastTopup = m?.last_topup_at ? dayKey((m.last_topup_at as Date).getTime()) : null;
    const plans = planAlerts({ name: r.name, balance: r.balance, daysLeft: r.daysLeft, spike, lastTopup }, { lowAmount: r.lowAmount, lowDays: prefs.lowDays }, day);
    for (const p of plans) {
      if (p.kind === "wg_spike" && !prefs.spikeOn) continue;
      // Our own record first: the same episode is never raised twice, even if the alert was marked done.
      const ev = await db`insert into wg_events (installation_id, location_id, kind, episode, balance, amount, detail, at) values (${inst}, ${r.locationId}, ${p.event}, ${p.episode}, ${r.balance}, ${p.kind === "wg_spike" ? r.spikeSpent : null},
        ${db.json({ daysLeft: r.daysLeft, burnPerDay: r.burnPerDay } as never)}, ${new Date(now)}) on conflict (installation_id, location_id, kind, episode) do nothing returning id`;
      if (!ev.length) continue;
      for (const user of watchers) {
        if (created.length >= WALLET_ALERTS_PER_RUN) break;
        const input: PrivateAlertInput = { locationId: r.locationId, recipientUserKey: user, accountName: r.name, kind: p.kind, dedupeKey: `wg:${p.event}:${r.locationId}:${p.episode}:${user}`, title: p.title, detail: { balance: r.balance, daysLeft: r.daysLeft, estimate: true } };
        const id = await createPrivateAlert(inst, input, now);
        if (id) created.push({ id, input, severity: p.kind === "wg_empty" ? "critical" : "warning" });
      }
    }
  }
  if (created.length) {
    const loaded = await loadContext(inst);
    const intents: Intent[] = created.map(({ id, input, severity }) => ({
      type: "other_alerts", locationId: input.locationId, severity, recipientUserKey: input.recipientUserKey, respectQuietHours: true, emailDryRunOnly: false,
      dedupeKey: `alert:${id}`, alertId: id, values: { account: input.accountName ?? "A client account", problem: input.title }, link: { view: "clients", locationId: input.locationId },
    }));
    await dispatchIntents(inst, intents, now, loaded);
  }
  return created.length;
}
