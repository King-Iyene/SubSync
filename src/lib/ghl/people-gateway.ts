import { outward } from "../live-flags.ts";
import { GHL_API } from "./client.ts";
import { recordWrite, SPACING_MS, type GatewayDeps } from "./crm-gateway.ts";
import { ghlFetch } from "./http.ts";
import { LIMITS, takeSlot } from "./workbench.ts";

// The one door for moving a lead to another owner from the Team module (slice PB). Same switches as the other gateways: WRITE_GHL_LIVE off unless exactly "true", the account's own
// opt-in, a preview first (the route), a typed confirmation or a tick where the route asks for one, one audit line per write with ids and field names only, calls spaced under the
// platform's limit. Off or not allowed: the request is built, "WOULD WRITE crm.contact.reassign" is recorded and NOTHING is sent. Needs the optional permission contacts.write; without
// it the answer is needs_permission ("Needs permission: reconnect"). This changes ONE field (the owner) of ONE contact. It sends no message, changes no deal, never removes
// anything. Request shape (PUT /contacts/{id} with assignedTo) follows the platform's published API description and is NOT VERIFIED LIVE.

export const REASSIGN_SCOPE = "contacts.write";
const VERSION = "2021-07-28";

export type ReassignResult =
  | { outcome: "dry_run"; line: string; reason: "switch" | "account" }
  | { outcome: "done" }
  | { outcome: "needs_permission" }
  | { outcome: "rate_limited"; retryInSeconds: number }
  | { outcome: "failed"; status: number };

export type ReassignWrite = {
  installationId: string; locationId: string; actor: string | null; contactId: string; toUserId: string;
  /** The account's own opt-in to changes from SubSync (Settings). */
  optedIn: boolean; token: () => Promise<string>;
};

/** The request body. Pure, so the tests can read it. Only the owner. */
export const reassignBody = (toUserId: string): Record<string, unknown> => ({ assignedTo: toUserId });

export async function writeOwner(a: ReassignWrite, deps: GatewayDeps = {}): Promise<ReassignResult> {
  const wait = takeSlot(`acct:${a.installationId}`, LIMITS.perAccountPerMinute, 60_000);
  if (wait) return { outcome: "rate_limited", retryInSeconds: wait };
  // Not allowed for this account: the same dry run as the switch being off (an empty environment can never be live).
  const env = a.optedIn ? deps.env : {};
  const fields = Object.keys(reassignBody(a.toUserId));
  const done = await outward(
    { flag: "WRITE_GHL_LIVE", verb: "WRITE", what: "crm.contact.reassign", installationId: a.installationId, ids: { locationId: a.locationId, contactId: a.contactId }, fields },
    async (): Promise<ReassignResult> => {
      await (deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(SPACING_MS);
      const headers = { Authorization: `Bearer ${await a.token()}`, Version: VERSION, Accept: "application/json", "Content-Type": "application/json" };
      const opts = { ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.sleep ? { sleep: deps.sleep } : {}) };
      const res = await ghlFetch(`${GHL_API}/contacts/${encodeURIComponent(a.contactId)}`, { method: "PUT", headers, body: JSON.stringify(reassignBody(a.toUserId)), cache: "no-store" }, opts);
      const result: ReassignResult = res.status === 401 || res.status === 403 ? { outcome: "needs_permission" } : res.ok ? { outcome: "done" } : { outcome: "failed", status: res.status };
      await recordWrite({ installationId: a.installationId, actor: a.actor, locationId: a.locationId, contactId: a.contactId, op: "contact.reassign", fields, result: result.outcome }, deps);
      return result;
    },
    { ...deps, ...(env ? { env } : {}) },
  );
  return done.live ? done.result : { outcome: "dry_run", line: done.line, reason: a.optedIn ? "switch" : "account" };
}
