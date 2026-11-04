import assert from "node:assert/strict";
import { test } from "node:test";
import { bookOf, signalsOf, type AccountIn, type BookIn, type ProfileIn } from "../analytics/clients-v2-book.ts";
import { selectClients, summarize } from "../analytics/clients-v2.ts";
import { withinTargetShare } from "../analytics/today-queue.ts";

// The book is built from the facts the other pages already use: people waiting, no-shows and quiet deals from the Account audit's rows, replies in time from the lead ledger
// by Today's own function, the score, churn warning and lead-flow drop of the derived account. These fixtures hold each client's figure equal to its source, and prove that a
// small number of leads is never judged.

const NOW = Date.parse("2026-11-05T09:00:00Z");
const D = 86_400_000, M = 60_000;
const acct = (id: string, over: Partial<AccountIn> = {}): AccountIn => ({ locationId: id, name: `Client ${id}`, score: 70, churn: { level: "low", reasons: [] }, dormant: false, daysInactive: 1, leadFlowDropPct: null, contactsSyncedAt: "2026-11-05T08:00:00Z", ...over });
const prof = (over: Partial<ProfileIn> = {}): ProfileIn => ({ installedAt: NOW - 200 * D, monthlyFee: null, renewalDate: null, industry: null, lastContactedAt: null, ...over });
const lead = (loc: string, minsAfter: number | null, daysAgo = 3) => ({ locationId: loc, leadAt: NOW - daysAgo * D, touchAt: minsAfter === null ? null : NOW - daysAgo * D + minsAfter * M });
function input(over: Partial<BookIn> = {}): BookIn {
  return { now: NOW, targetMinutes: 15, accounts: [acct("a")], profiles: new Map(), lastConversationOn: new Map(), audit: new Map(), replies: [], ...over };
}

test("waiting, no-shows and quiet deals are the Account audit's counts for that client, and a client with nothing to fix has none", () => {
  const sig = signalsOf(input({ accounts: [acct("a"), acct("b")], audit: new Map([["a", { replies: 12, noshows: 4, stale: 6, staleDollars: 41_250.4 }]]) }));
  assert.deepEqual([sig[0].waiting, sig[0].noShows, sig[0].quietDeals, sig[0].quietDealValue], [12, 4, 6, 41_250]);
  assert.deepEqual([sig[1].waiting, sig[1].noShows, sig[1].quietDeals], [0, 0, 0]);
});

test("replies in time are Today's own share for that client over 14 days, claimed only from 5 judged leads", () => {
  // 6 judged leads for client a: 2 answered inside 15 minutes, 4 late or unanswered; 3 for client b (too few).
  const replies = [lead("a", 5), lead("a", 10), lead("a", 40), lead("a", 90), lead("a", null), lead("a", null), lead("b", 5), lead("b", null), lead("b", 50),
    // older than 14 days: never counted
    lead("a", 1, 20), lead("a", 1, 30)];
  const sig = signalsOf(input({ accounts: [acct("a"), acct("b")], replies }));
  const own = withinTargetShare(replies.filter((r) => r.locationId === "a"), 15, NOW, 14);
  assert.equal(sig[0].replyJudged, own.judged);
  assert.equal(sig[0].replyJudged, 6);
  assert.equal(sig[0].replyShare, own.share);
  assert.equal(Math.round((sig[0].replyShare as number) * 100), 33);
  assert.equal(sig[1].replyJudged, 3);
  assert.equal(sig[1].replyShare, null);
  const rows = bookOf(input({ accounts: [acct("a"), acct("b")], replies }));
  assert.equal(rows[0].level, "watch");
  assert.match(rows[0].line, /Only 33% of the last 6 new leads got a reply in time\./);
  assert.equal(rows[1].level, "healthy");
});

test("a lead that has not yet passed the reply target is not judged late", () => {
  // Three leads that arrived two minutes ago with no reply yet are not judged; the five answered in time are.
  const fresh = [1, 2, 3].map(() => ({ locationId: "a", leadAt: NOW - 2 * M, touchAt: null }));
  const answered = [1, 2, 3, 4, 5].map((n) => lead("a", n));
  const sig = signalsOf(input({ replies: [...fresh, ...answered] }));
  assert.equal(sig[0].replyJudged, 5);
  assert.equal(sig[0].replyShare, 1);
});

test("the typed profile: fee, renewal, industry and days since added; last spoken is the later of the press and the newest logged conversation", () => {
  const profiles = new Map([["a", prof({ monthlyFee: 2500, renewalDate: "2026-11-20", industry: "Real estate", installedAt: NOW - 9 * D, lastContactedAt: NOW - 30 * D })]]);
  const logged = new Map<string, string | null>([["a", "2026-11-03"]]);
  const [s] = signalsOf(input({ profiles, lastConversationOn: logged }));
  assert.deepEqual([s.fee, s.renewalDate, s.industry, s.daysSinceAdded], [2500, "2026-11-20", "Real estate", 9]);
  assert.equal(s.lastSpokenDays, 1); // 3 Nov noon to 5 Nov 09:00 is 1 whole day
  const [none] = signalsOf(input());
  assert.deepEqual([none.fee, none.renewalDate, none.industry, none.daysSinceAdded, none.lastSpokenDays], [null, null, null, null, null]);
});

test("an account not yet read is 'Not read yet', and its blank numbers are never shown as a problem", () => {
  const [row] = bookOf(input({ accounts: [acct("a", { contactsSyncedAt: null, score: 0, dormant: true, daysInactive: null })] }));
  assert.equal(row.level, "not_read");
  assert.deepEqual(row.reasons, []);
});

test("the demo-shaped book: fees and renewals typed, the counts equal the lists, money at stake is the fees of the clients at risk", () => {
  const accounts = [acct("a", { dormant: true, daysInactive: 60, score: 15, churn: { level: "high", reasons: [] } }), acct("b"), acct("c", { score: 45 })];
  const profiles = new Map([["a", prof({ monthlyFee: 2000, renewalDate: "2026-11-25" })], ["b", prof({ monthlyFee: 3000 })], ["c", prof({ monthlyFee: 1000, renewalDate: "2026-12-30" })]]);
  const rows = bookOf(input({ accounts, profiles }));
  const s = summarize(rows);
  assert.equal(s.atRisk, 1);
  assert.equal(s.atRiskFee, 2000);
  assert.equal(s.feeTotal, 6000);
  assert.equal(s.renewalsDue, 1);
  assert.equal(s.renewals60, 2);
  assert.deepEqual(selectClients(rows, { filter: "renewing", sort: "renewal" }).map((r) => r.id), ["a", "c"]);
  assert.deepEqual(selectClients(rows, { filter: "needs" }).map((r) => r.id), ["a", "c"]);
});
