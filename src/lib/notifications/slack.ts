// Slack destinations (N79, N98): which channels may receive a message, what a failed post means, and how a post is made. Pure apart from the fetch that is
// passed in, so the whole flow is tested against a fake Slack.
//
// Method: Slack's "incoming webhook" scope (the smallest scope set). Each "Add to Slack" sign-in is ONE channel, chosen on Slack's own page, and Slack
// hands back a channel address. Several channels are several sign-ins, each saved as a destination. The address is a secret (anyone holding it can post),
// so it is encrypted at rest and never sent to a browser.

import { isSlackWebhook } from "../analytics/derive.ts";
import { MESSAGE, shownStatus, type Shown } from "../connections/messages.ts";

export type Destination = {
  id: string;
  label: string | null;
  /** Null: the whole company. A client account id: only that account's messages. */
  locationId: string | null;
  status: string;
  pendingSince: number | null;
};

/**
 * The connected channels a message may go to. `chosen` is what the preference for this kind of message lists. A channel made for ONE client account only ever
 * receives that account's own messages: another client's alert, or a message about all accounts, never reaches it. In a single-business install the whole
 * install is one account, so every channel is usable.
 */
export function eligibleDestinations(all: Destination[], chosen: readonly string[], item: { locationId: string | null }, mode: "agency" | "business"): Destination[] {
  const want = new Set(chosen);
  return all.filter((d) => {
    if (!want.has(d.id) || d.status !== "connected") return false;
    if (mode === "business" || d.locationId === null) return true;
    return item.locationId !== null && item.locationId === d.locationId;
  });
}

/** What a destination shows as: a connection that never finished stops waiting after two minutes (N92), through the same rule as the personal connections. */
export const shownDestination = (d: Pick<Destination, "status" | "pendingSince">, now = Date.now()): Shown => shownStatus(d.status, d.pendingSince, now);

export type SlackFailure = {
  /** A short machine code for the log and for "send us this code". Never Slack's free text. */
  code: string;
  /** True when trying again cannot help (the channel is gone, a permission is missing): the ledger stops retrying. */
  permanent: boolean;
  /** True when the person has to connect the channel again. */
  needsReconnect: boolean;
  /** What the person reads. */
  message: string;
};

const RECONNECT = new Set(["no_service", "no_service_id", "no_team", "no_team_id", "invalid_token", "token_revoked", "account_inactive", "channel_not_found", "channel_is_archived", "action_prohibited", "posting_to_general_channel_denied", "team_disabled"]);
const SCOPE = new Set(["missing_scope", "invalid_scope", "not_allowed_token_type", "no_permission"]);

/** Reads Slack's answer to a post. Null means it worked. A 200 with the text "ok" is success; everything else is explained. */
export function classifySlackPost(status: number, text: string): SlackFailure | null {
  const body = text.trim().toLowerCase().slice(0, 80);
  if (status >= 200 && status < 300 && body === "ok") return null;
  if (status === 429) return { code: "rate_limited", permanent: false, needsReconnect: false, message: "Slack is asking us to slow down. We will try again shortly." };
  if (status >= 500 || status === 0) return { code: status === 0 ? "network" : `http_${status}`, permanent: false, needsReconnect: false, message: "We could not reach Slack. We will try again shortly." };
  const key = /^[a-z_]{2,40}$/.test(body) ? body : `http_${status}`;
  if (SCOPE.has(key)) return { code: "missing_scope", permanent: true, needsReconnect: true, message: MESSAGE.needsPermission };
  if (RECONNECT.has(key)) return { code: key, permanent: true, needsReconnect: true, message: "Slack no longer accepts messages for this channel (it may have been removed or archived). Connect it again." };
  return { code: key, permanent: true, needsReconnect: false, message: "Slack did not accept the message. If it happens again, send us this code: " + key + "." };
}

type Fetch = typeof fetch;
export type SlackPost = { ok: true } | ({ ok: false } & SlackFailure);

/** Post one message to a channel address. Only hooks.slack.com addresses are called, so a saved value can never make the server call an arbitrary address. */
export async function postSlackWebhook(url: string, text: string, f: Fetch = fetch): Promise<SlackPost> {
  if (!isSlackWebhook(url)) return { ok: false, code: "bad_address", permanent: true, needsReconnect: true, message: "The saved Slack address is not valid. Connect the channel again." };
  try {
    const r = await f(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(8000) });
    const failure = classifySlackPost(r.status, await r.text().catch(() => ""));
    return failure ? { ok: false, ...failure } : { ok: true };
  } catch {
    return { ok: false, code: "network", permanent: false, needsReconnect: false, message: "We could not reach Slack. We will try again shortly." };
  }
}

/** The label a destination is shown with: "Team · #channel", or a fallback. */
export const destinationLabel = (team: string | null, channel: string | null): string => [team, channel].filter(Boolean).join(" · ") || "Slack channel";
