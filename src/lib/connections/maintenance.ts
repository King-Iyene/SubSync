import { installationHasScope } from "../analytics/cleanup-queries";
import { sql } from "../db";
import { GHL_API } from "../ghl/client";
import { ghlFetch } from "../ghl/http";
import { getCompanyAccessToken } from "../ghl/installations";
import { safeError } from "../safe-log";
import { expireInbox, removeDeactivatedPeople } from "./cleanup";

// The small daily clean-up of meeting data (roadmap E2a items 5 and E0 leftovers). Called by the cron route /api/cron/meeting-expiry.
//   1. A call nobody was matched to leaves the person's private Meeting inbox when its time is up (the account rules' shortest retention, default 14 days).
//   2. Calls already handled keep their summary for 90 days (INTEGRATIONS_SPEC section 9), then the row is removed; the write log (ids and times) stays.
//   3. The ids of delivered Fathom webhooks are kept for 30 days, far longer than any retry.
//   4. A person who is no longer in the CRM loses their connection, choices and calls (E0 `removeDeactivatedPeople`). The CRM's list of people is read
//      ONLY when the app holds the users permission; without it this step is skipped and says so. The list is refused when it is empty, cut short, or would
//      remove most people at once, so a failed or partial read can never wipe anyone out.

export const KEEP_HANDLED_DAYS = 90;
export const KEEP_DELIVERY_DAYS = 30;
/** A list that would remove more than this share of the people who have a connection (when there are more than 2) is treated as a bad read. */
export const MAX_REMOVAL_SHARE = 0.5;

export type UserList = { ok: true; ids: string[] } | { ok: false; reason: "no_permission" | "failed" | "incomplete" };

/** Reads every user of the company. NOT VERIFIED LIVE: `GET /users/search?companyId=` with the company token; the answer is checked against its own count. */
export async function fetchCompanyUserIds(companyKey: string, f: typeof fetch = fetch): Promise<UserList> {
  try {
    const token = await getCompanyAccessToken(companyKey);
    const ids = new Set<string>();
    let total: number | null = null;
    for (let page = 0; page < 20; page++) {
      const res = await ghlFetch(`${GHL_API}/users/search?${new URLSearchParams({ companyId: companyKey, skip: String(page * 100), limit: "100" })}`, {
        headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" }, cache: "no-store",
      }, { fetchImpl: f });
      if (res.status === 401 || res.status === 403) return { ok: false, reason: "no_permission" };
      if (!res.ok) return { ok: false, reason: "failed" };
      const body = (await res.json()) as Record<string, unknown>;
      const users = Array.isArray(body.users) ? body.users : [];
      if (typeof body.count === "number") total = body.count;
      for (const u of users) { const id = (u as Record<string, unknown>)?.id; if (typeof id === "string" && id) ids.add(id); }
      if (users.length < 100) break;
    }
    // A list that is shorter than the count the platform itself gave is incomplete: never act on it.
    if (ids.size === 0 || (total !== null && ids.size < total)) return { ok: false, reason: "incomplete" };
    return { ok: true, ids: [...ids] };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export type RemovalDecision = { act: true; ids: string[] } | { act: false; reason: "empty_list" | "would_remove_most" };

/** Decides whether a list of current people may be used to remove the others. Pure. */
export function decideRemoval(known: string[], current: string[]): RemovalDecision {
  if (current.length === 0) return { act: false, reason: "empty_list" };
  const active = new Set(current);
  const gone = known.filter((id) => !active.has(id));
  if (known.length > 2 && gone.length / known.length > MAX_REMOVAL_SHARE) return { act: false, reason: "would_remove_most" };
  return { act: true, ids: current };
}

export type MaintenanceResult = {
  inboxExpired: number; handledRemoved: number; deliveriesRemoved: number;
  people: { installations: number; removed: number; skipped: Array<{ reason: string; count: number }> };
};

export async function runMeetingMaintenance(f: typeof fetch = fetch, now = Date.now()): Promise<MaintenanceResult> {
  const db = sql();
  const inboxExpired = await expireInbox(now);
  const handled = await db`
    delete from meetings where status in ('saved', 'dry_run', 'failed', 'skipped') and created_at < ${new Date(now - KEEP_HANDLED_DAYS * 86_400_000)} returning id`;
  const deliveries = await db`delete from meeting_deliveries where created_at < ${new Date(now - KEEP_DELIVERY_DAYS * 86_400_000)} returning id`;

  // Removed people: only company installs that have a personal connection, and only with the users permission.
  const installs = await db`
    select distinct i.id, i.company_id from installations i join user_connections u on u.installation_id = i.id
    where i.uninstalled_at is null and not i.is_demo and i.mode = 'agency'`;
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  let removed = 0;
  for (const inst of installs) {
    try {
      if (!(await installationHasScope(inst.id as string, "users.readonly"))) { skip("no_users_permission"); continue; }
      const list = await fetchCompanyUserIds(inst.company_id as string, f);
      if (!list.ok) { skip(`users_list_${list.reason}`); continue; }
      const known = (await db`select distinct ghl_user_id from user_connections where installation_id = ${inst.id as string}`).map((r) => r.ghl_user_id as string);
      const decision = decideRemoval(known, list.ids);
      if (!decision.act) { skip(decision.reason); continue; }
      removed += (await removeDeactivatedPeople(inst.id as string, decision.ids, f)).removed;
    } catch (error) {
      console.error("Meeting clean-up failed for one company", safeError(error));
      skip("error");
    }
  }
  return { inboxExpired, handledRemoved: handled.length, deliveriesRemoved: deliveries.length, people: { installations: installs.length, removed, skipped: [...skipped].map(([reason, count]) => ({ reason, count })) } };
}
