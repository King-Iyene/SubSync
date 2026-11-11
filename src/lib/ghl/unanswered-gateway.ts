import { outward } from "../live-flags.ts";
import { GHL_API } from "./client.ts";
import { recordWrite, SPACING_MS, type GatewayDeps } from "./crm-gateway.ts";
import { ghlFetch } from "./http.ts";
import { LIMITS, takeSlot } from "./workbench.ts";

// The one door for the Unanswered messages clean-up delete (round 3, slice B). It sits on the same switches as the other gateways: WRITE_GHL_LIVE off unless exactly "true", the
// account's own opt-in, a preview first, a typed count before anything is sent (checked by the caller with clearConfirmed), one audit line per write with ids only, calls spaced
// under the platform's limit. With the switch off or the account not allowed, the request is built and "WOULD DELETE crm.conversation.delete" is recorded and NOTHING is sent.
// It deletes ONE conversation (the thread), never the contact, so a real customer record is never lost by this route; the caller has already refused do-not-disturb contacts,
// open deals, customers and upcoming appointments (protectionBlockers). The CRM has no way to bring a deleted conversation back, so this cannot be undone.
// Request shape (DELETE /conversations/{id}, scope conversations.write) follows the platform's published API description and is NOT VERIFIED LIVE.

export const DELETE_CONVERSATION_SCOPE = "conversations.write";

export type DeleteResult =
  | { outcome: "dry_run"; line: string; reason: "switch" | "account" }
  | { outcome: "done" }
  | { outcome: "needs_permission" }
  | { outcome: "rate_limited"; retryInSeconds: number }
  | { outcome: "failed"; status: number };

export type DeleteArgs = {
  installationId: string; locationId: string; conversationId: string; contactId: string | null; actor: string | null;
  /** The account's own opt-in to changes from SubSync (Settings). */
  optedIn: boolean;
  token: () => Promise<string>;
};

export async function deleteConversation(a: DeleteArgs, deps: GatewayDeps = {}): Promise<DeleteResult> {
  const wait = takeSlot(`acct:${a.installationId}`, LIMITS.perAccountPerMinute, 60_000);
  if (wait) return { outcome: "rate_limited", retryInSeconds: wait };
  // Not allowed for this account: the same dry run as the switch being off (an empty environment can never be live).
  const env = a.optedIn ? deps.env : {};
  const done = await outward(
    { flag: "WRITE_GHL_LIVE", verb: "DELETE", what: "crm.conversation.delete", installationId: a.installationId, ids: { locationId: a.locationId, conversationId: a.conversationId, contactId: a.contactId }, fields: ["conversation"] },
    async (): Promise<DeleteResult> => {
      await (deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(SPACING_MS);
      const res = await ghlFetch(
        `${GHL_API}/conversations/${encodeURIComponent(a.conversationId)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${await a.token()}`, Version: "2021-04-15", Accept: "application/json" }, cache: "no-store" },
        { ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.sleep ? { sleep: deps.sleep } : {}) },
      );
      // A conversation already gone (404) is the result the person wanted.
      const result: DeleteResult = res.status === 401 || res.status === 403 ? { outcome: "needs_permission" } : res.ok || res.status === 404 ? { outcome: "done" } : { outcome: "failed", status: res.status };
      await recordWrite({ installationId: a.installationId, actor: a.actor, locationId: a.locationId, contactId: a.contactId ?? a.conversationId, op: "unanswered.conversation.delete", fields: ["conversation"], result: result.outcome }, deps);
      return result;
    },
    { ...deps, ...(env ? { env } : {}) },
  );
  return done.live ? done.result : { outcome: "dry_run", line: done.line, reason: a.optedIn ? "switch" : "account" };
}
