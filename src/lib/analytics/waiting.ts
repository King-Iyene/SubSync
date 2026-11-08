// Which conversations are "waiting for a reply", and how they are described. Pure (no database, no network), so it is unit tested.
// The definition lives in docs/METRICS.md ("Waiting past the reply target"); the SQL in queries.ts says the same thing and a database
// test checks the two agree. One window and one target are used on every screen.

import { isInternalComment } from "./message-kinds.ts";

/** A conversation whose last message from the customer is older than this is dead, not waiting: nobody is still expecting a reply. */
export const WAITING_WINDOW_DAYS = 30;

export type ConvLike = { direction: string | null; at: number | null; type: string | null; locationId?: string | null };

/**
 * waiting  the customer wrote last and the reply target has passed (inside the window)
 * pending  the customer wrote last and the target has not passed yet
 * stale    the customer wrote last, longer ago than the window
 * answered the last message is ours or is not from the customer (a reply, an auto-reply, an internal note, a call we placed)
 * none     there is nothing to judge: no time, or the latest entry is an internal comment (a team note is not a reply and says nothing about whether the
 *          customer was answered, so SubSync does not judge this conversation until the next customer message or reply)
 */
export type WaitingState = "waiting" | "pending" | "stale" | "answered" | "none";

export function waitingState(c: ConvLike, now: number, slaHours: number): WaitingState {
  if (c.at === null || !Number.isFinite(c.at)) return "none";
  if (isInternalComment(c.type)) return "none";
  if (c.direction !== "inbound") return "answered";
  const age = now - c.at;
  if (age > WAITING_WINDOW_DAYS * 86_400_000) return "stale";
  return age > slaHours * 3_600_000 ? "waiting" : "pending";
}

const NAMES: Record<string, string> = {
  sms: "Text message", email: "Email", whatsapp: "WhatsApp", fb: "Facebook", facebook: "Facebook", ig: "Instagram", instagram: "Instagram",
  gmb: "Google Business", live_chat: "Live chat", livechat: "Live chat", call: "Call", webchat: "Live chat", custom: "Other", sms_review: "Review",
};

/** A channel in words, from the platform's message type ("TYPE_SMS" is "Text message"). */
export function channelLabel(type: string | null | undefined): string {
  const key = (type ?? "").replace(/^TYPE_/i, "").toLowerCase();
  if (!key) return "Message";
  return NAMES[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** How many conversations per channel, most first. */
export function channelCounts(types: Array<string | null | undefined>): Array<{ channel: string; count: number }> {
  const by = new Map<string, number>();
  for (const t of types) by.set(channelLabel(t), (by.get(channelLabel(t)) ?? 0) + 1);
  return [...by.entries()].map(([channel, count]) => ({ channel, count })).sort((a, b) => b.count - a.count || a.channel.localeCompare(b.channel));
}

// ---------------- how much of an inbox is read (N15) ----------------

/** SubSync reads the newest conversations of each account, up to this many. An account at the limit has older conversations that are not read. */
export const CONVERSATIONS_READ_PER_ACCOUNT = 500;
export const CONVERSATION_PAGE_SIZE = 100;

/** The sentence for a number that counts conversations (waiting, unread). Null when every account is below the limit, so nothing is hidden. */
export function readLimitNote(cappedAccounts: number, totalAccounts: number): string | null {
  if (cappedAccounts <= 0) return null;
  return `SubSync reads the newest ${CONVERSATIONS_READ_PER_ACCOUNT} conversations of each account. ${cappedAccounts} of ${totalAccounts} ${totalAccounts === 1 ? "account" : "accounts"} ${cappedAccounts === 1 ? "has" : "have"} more than that, so older conversations are not counted here.`;
}

/**
 * Unread is not the same as waiting. Unread: the platform says there is something nobody opened. Waiting: the customer wrote last and the reply
 * target has passed. A conversation can be both, and the screens say so instead of adding or subtracting silently.
 */
export function unreadSummary(rows: Array<{ unreadCount: number; overSla: boolean }>) {
  const unread = rows.filter((r) => r.unreadCount > 0);
  return { unread: unread.length, unreadAndWaiting: unread.filter((r) => r.overSla).length, unreadNotWaiting: unread.filter((r) => !r.overSla).length };
}
