// Builds the Clients book from the facts the server gathers: one Signals per client account, from the account as derived everywhere else, the typed profile, the log, the
// Account audit's rows (people waiting, no-shows, quiet deals: Today's rules) and the lead ledger (replies in time: Speed to lead's rows). Pure, so a fixture can prove that
// each number is the one the other pages use (src/lib/__tests__/clients-v2-book.test.ts).

import { lastSpokenMs } from "./client-success.ts";
import { withinTargetShare } from "./today-queue.ts";
import { REPLY_WINDOW_DAYS, rowOf, MIN_REPLY_LEADS, type BookRow, type Signals } from "./clients-v2.ts";

const DAY = 86_400_000;

export type AccountIn = {
  locationId: string; name: string | null; score: number; churn: { level: "low" | "medium" | "high"; reasons: string[] };
  dormant: boolean; daysInactive: number | null; leadFlowDropPct: number | null; contactsSyncedAt: string | null;
};
export type ProfileIn = { installedAt: number | null; monthlyFee: number | null; renewalDate: string | null; industry: string | null; lastContactedAt: number | null };
/** The Account audit's per-client counts (audit-clients.ts ClientRow). A client with nothing to fix has no entry. */
export type AuditCounts = { replies: number; noshows: number; stale: number; staleDollars: number };
export type ReplyRowIn = { locationId: string; leadAt: number; touchAt: number | null };

export type BookIn = {
  now: number; targetMinutes: number; accounts: readonly AccountIn[];
  profiles: ReadonlyMap<string, ProfileIn>; lastConversationOn: ReadonlyMap<string, string | null>;
  audit: ReadonlyMap<string, AuditCounts>; replies: readonly ReplyRowIn[];
};

export function signalsOf(i: BookIn): Signals[] {
  const byLoc = new Map<string, ReplyRowIn[]>();
  for (const r of i.replies) { const l = byLoc.get(r.locationId); if (l) l.push(r); else byLoc.set(r.locationId, [r]); }
  return i.accounts.map((a) => {
    const p = i.profiles.get(a.locationId);
    const c = i.audit.get(a.locationId);
    const share = withinTargetShare(byLoc.get(a.locationId) ?? [], i.targetMinutes, i.now, REPLY_WINDOW_DAYS);
    const conv = i.lastConversationOn.get(a.locationId) ?? null;
    const spoken = lastSpokenMs(p?.lastContactedAt ?? null, conv ? [conv] : []);
    return {
      id: a.locationId, name: a.name ?? "Unnamed account", read: a.contactsSyncedAt !== null,
      score: a.score, churn: a.churn.level, churnReasons: a.churn.reasons, dormant: a.dormant, daysInactive: a.daysInactive,
      waiting: c?.replies ?? 0, noShows: c?.noshows ?? 0, quietDeals: c?.stale ?? 0, quietDealValue: Math.round(c?.staleDollars ?? 0),
      // A share is claimed only from the minimum number of judged leads (withinTargetShare already returns null under it); the count is kept for the sentence.
      replyShare: share.judged >= MIN_REPLY_LEADS ? share.share : null, replyJudged: share.judged, targetMinutes: i.targetMinutes,
      leadDropPct: a.leadFlowDropPct,
      daysSinceAdded: p?.installedAt == null ? null : Math.max(0, Math.floor((i.now - p.installedAt) / DAY)),
      fee: p?.monthlyFee ?? null, renewalDate: p?.renewalDate ?? null, industry: p?.industry ?? null,
      lastSpokenDays: spoken === null ? null : Math.max(0, Math.floor((i.now - spoken) / DAY)),
    };
  });
}

export const bookOf = (i: BookIn): BookRow[] => signalsOf(i).map((s) => rowOf(s, i.now));
