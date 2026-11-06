import { GHL_API } from "../ghl/client";
import { ghlFetch } from "../ghl/http";
import { fetchConversationsPage, mapContact, type ContactRow } from "../sync/ghl-data";
import { cacheContacts, cacheConversations } from "./live-cache";

// The near-real-time safety net: while somebody has an account open (a lead panel is polling it), read ONLY what changed lately (the 100 most recently updated contacts and the 100
// most recent conversations, two requests) at most every 45 seconds per account, and keep them in the copy. A missed webhook therefore heals within a minute. It never re-reads
// the whole account and never deletes anything (the full sync still does that). Runs after the response is sent.
export const DELTA_EVERY_MS = 45_000;
const last = new Map<string, number>();

export function deltaDue(key: string, now = Date.now(), every = DELTA_EVERY_MS): boolean {
  const at = last.get(key);
  if (at !== undefined && now - at < every) return false;
  last.set(key, now);
  if (last.size > 1000) for (const k of last.keys()) { last.delete(k); if (last.size < 800) break; }
  return true;
}

export type DeltaDeps = { contacts: () => Promise<ContactRow[]>; conversations: () => Promise<Awaited<ReturnType<typeof fetchConversationsPage>>["conversations"]> };

export function crmDeltaDeps(token: string, locationId: string): DeltaDeps {
  return {
    contacts: async () => {
      const res = await ghlFetch(`${GHL_API}/contacts/search`, {
        method: "POST", cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, pageLimit: 100, page: 1, sort: [{ field: "dateUpdated", direction: "desc" }] }),
      });
      if (!res.ok) return [];
      const body = (await res.json().catch(() => ({}))) as { contacts?: unknown[] };
      return (Array.isArray(body.contacts) ? body.contacts : []).map(mapContact).filter((c): c is ContactRow => c !== null);
    },
    conversations: async () => (await fetchConversationsPage(token, locationId, null, 100)).conversations,
  };
}

/** One bounded delta for one account. Never throws. Returns what it stored. */
export async function runDelta(installationId: string, locationId: string, deps: DeltaDeps): Promise<{ contacts: number; conversations: number }> {
  let contacts = 0, conversations = 0;
  try { const c = await deps.contacts(); await cacheContacts(installationId, locationId, c); contacts = c.length; } catch { /* the next pass tries again */ }
  try { const v = await deps.conversations(); await cacheConversations(installationId, locationId, v); conversations = v.length; } catch { /* same */ }
  return { contacts, conversations };
}
