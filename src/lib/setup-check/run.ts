import { sql } from "../db";
import { locationAccessToken } from "../sync/engine";
import { grantedFor } from "../workflows-setup/run";
import { ttlCache } from "../ttl-cache";
import { finish, type Reads, type SetupCheckResult } from "./model";
import { readAccountSetup } from "./read";

// Account setup, one account at a time. Read only. Every account id arriving here has passed ownedLocation in the route, and every query also filters by installation_id.
// What is kept: the finished checklist (COUNTS and plain sentences only: no names, text or numbers, phone numbers only as "ending 1234") in this server's memory for five minutes,
// so opening the tab twice does not read the account twice. Nothing is written to the database.

type Held = { at: number; result: SetupCheckResult };

const TTL = 5 * 60_000;
const MIN_REFRESH = 20_000;
const held = ttlCache<Held>(TTL, 300);
export const forgetSetupChecks = (installationId: string) => held.clear(`${installationId}:`);

/** Our own DNS look-ups of the sending domains found on this account (SubSync's table, counts only). */
async function dnsFacts(installationId: string, locationId: string): Promise<Reads["domains"]> {
  try {
    const rows = await sql()`select status from domain_checks where installation_id = ${installationId} and location_id = ${locationId}`;
    const ok = rows.filter((r) => r.status === "ok").length;
    const bad = rows.filter((r) => r.status === "warning" || r.status === "critical").length;
    return { total: ok + bad, passing: ok, attention: bad };
  } catch { return null; }
}

/** Read one account now (or serve the five-minute copy). `fresh` asks for a new read, but never more often than every 20 seconds. */
export async function runSetupCheck(installationId: string, locationId: string, opts: { fresh?: boolean; now?: number } = {}): Promise<SetupCheckResult> {
  const now = opts.now ?? Date.now();
  const key = `${installationId}:${locationId}`;
  const hit = held.get(key);
  if (hit && (!opts.fresh || now - hit.at < MIN_REFRESH)) return { ...hit.result, cached: true };
  const [inst] = await sql()`select company_id from installations where id = ${installationId}`;
  const domains = await dnsFacts(installationId, locationId);
  let token: string | null = null;
  if (inst) { try { token = await locationAccessToken(inst.company_id as string, locationId); } catch { token = null; } }
  if (!token) {
    // Not stored: a failed read must not hide the answer that comes a minute later.
    const none = { state: "error" } as const;
    const reads: Reads = { pipelines: none, objects: none, records: null, customValues: none, templates: none, tasks: none, files: none, emailBuilder: none, emailSchedule: none, numbers: none, pools: none, resources: none, domains };
    return finish(reads, now, false, "SubSync could not reach this account just now. Press Check again in a minute.");
  }
  const granted = await grantedFor(installationId);
  const live = await readAccountSetup({ token, locationId, granted, now });
  const result = finish({ ...live, domains }, now);
  held.set(key, { at: now, result });
  return result;
}
