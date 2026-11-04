import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountSpeeds, comingLeads, fastestSlowest, forecastLine, forecastOf, hourStats, insightAfterHours, insightIdleOwner, insightNoShows, insightSource, leadsInHour, nextAction, nextVisit,
  pickInsights, sinceVisitOf, sourceStats, whyOf, workload, VISIT_GAP_MS, type LeadRow,
} from "../analytics/today-smart.ts";
import { buildQueue, emptyTotals, KINDS, type AccountFacts, type AlertFact, type Kind, type Proof, type TodayItem, type Totals } from "../analytics/today-queue.ts";
import { applyView } from "../analytics/today-state.ts";
import { specAccount, specAlerts, specClients, specComing, specDollars, specHour, specInsight, specKind, specRow, specSince, specSource, specThings, specReplies, pointEnd, type SpecEnv } from "../analytics/today-specs.ts";

// The smart rules of Today (insights, coverage, sources, workload, accounts compared, next step, why, forecast) and the records behind every mark.
const NOW = Date.parse("2026-11-04T15:00:00Z"); // Wednesday 15:00 UTC
const M = 60_000, H = 3_600_000, D = 86_400_000;
let n = 0;
const lead = (over: Partial<LeadRow> & { replyMin?: number | null; hour?: number; daysAgo?: number } = {}): LeadRow => {
  const day = NOW - (over.daysAgo ?? 1) * D;
  const base = new Date(day); base.setUTCHours(over.hour ?? 10, 0, 0, 0);
  const leadAt = over.leadAt ?? base.getTime();
  const reply = over.replyMin === undefined ? 5 : over.replyMin;
  const { replyMin: _r, hour: _h, daysAgo: _d, ...rest } = over; void _r; void _h; void _d;
  return { id: `lead:${n}`, locationId: "aaa", accountName: "Maple Dental", contactId: `c${n++}`, name: `Lead ${n}`, source: "Google", ownerName: "Priya", touchBy: "Priya", leadAt, touchAt: reply === null ? null : leadAt + reply * M, url: "u", zone: "UTC", ...rest };
};
const many = (k: number, o: Parameters<typeof lead>[0] = {}) => Array.from({ length: k }, () => lead(o));

test("after-hours insight: 2x slower after 6 pm, only with 5 answered in each group and a real gap", () => {
  const day = many(6, { hour: 10, replyMin: 5 });
  const night = many(7, { hour: 20, replyMin: 15 });
  const i = insightAfterHours([...day, ...night])!;
  assert.equal(i.key, "slow_after_hours");
  assert.equal(i.estimate, true);
  assert.equal(i.sample, 7);
  assert.match(i.text, /3x slower than usual/);
  assert.equal(i.leads!.length, 7);
  assert.equal(insightAfterHours([...day, ...many(4, { hour: 20, replyMin: 15 })]), null, "four is under the minimum");
  assert.equal(insightAfterHours([...day, ...many(7, { hour: 20, replyMin: 7 })]), null, "under 2x");
  assert.equal(insightAfterHours([...many(6, { hour: 10, replyMin: 0.2 }), ...many(7, { hour: 20, replyMin: 0.3 })]), null, "a gap under a minute is not a finding");
});

test("after-hours uses each account's own time zone", () => {
  const lagosNight = many(6, { hour: 20, zone: "UTC", replyMin: 20 });  // 20:00 UTC is 21:00 in Lagos: still night
  const tokyoDay = many(6, { hour: 20, zone: "Asia/Tokyo", replyMin: 20 });    // 20:00 UTC is 05:00 in Tokyo: night too
  const day = many(6, { hour: 10, replyMin: 5 });
  assert.equal(insightAfterHours([...day, ...lagosNight])!.sample, 6);
  // 08:00 UTC is 09:00 in Lagos (UTC+1): that is the day, so it joins the day group and the night group stays at 12.
  const lagosMorning = many(6, { hour: 8, zone: "Africa/Lagos", replyMin: 5 });
  assert.equal(insightAfterHours([...day, ...lagosMorning, ...lagosNight, ...tokyoDay])!.sample, 12);
});

test("source insight: slowest against fastest, each with 5 answered, at least 2x and a minute apart; 'no source' never counts", () => {
  const rows = [...many(5, { source: "Facebook", replyMin: 30 }), ...many(5, { source: "Google", replyMin: 10 }), ...many(9, { source: null, replyMin: 90 })];
  const i = insightSource(rows)!;
  assert.match(i.text, /^Facebook leads wait 3x longer than Google leads/);
  assert.equal(i.sample, 5);
  assert.equal(i.estimate, true);
  assert.equal(insightSource([...many(5, { source: "Facebook", replyMin: 15 }), ...many(5, { source: "Google", replyMin: 10 })]), null);
  assert.equal(insightSource(many(5, { source: "Facebook", replyMin: 30 })), null, "one source cannot be compared");
  assert.equal(insightSource([...many(4, { source: "Facebook", replyMin: 30 }), ...many(5, { source: "Google", replyMin: 10 })]), null);
});

test("idle owner insight: a person with 5 or more leads nobody replied to for 3 days is named, a count and a fact", () => {
  const stuck = many(6, { ownerName: "Marcus", replyMin: null, daysAgo: 4 });
  const fresh = many(9, { ownerName: "Dana", replyMin: null, daysAgo: 1 });
  const i = insightIdleOwner([...stuck, ...fresh, ...many(3, { ownerName: "Lee", replyMin: null, daysAgo: 5 })], NOW)!;
  assert.equal(i.key, "idle_owner");
  assert.equal(i.estimate, false);
  assert.equal(i.sample, 6);
  assert.match(i.text, /^Marcus has 6 leads with no reply for 3 days or more\.$/);
  assert.equal(insightIdleOwner(fresh, NOW), null);
});

test("no-show insight reads the items on screen, so a row set aside is not counted", () => {
  const items: TodayItem[] = Array.from({ length: 4 }, (_, k) => ({ id: `noshows:${k}`, kind: "noshows" as const, locationId: "aaa", accountName: "Bright Smile Dental", name: "x", detail: "", at: NOW, value: null, contactId: null, url: "u" }));
  assert.match(insightNoShows(items)!.text, /^Bright Smile Dental has 4 no-shows nobody rebooked\.$/);
  assert.equal(insightNoShows(items.slice(0, 2)), null);
});

test("at most three cards, facts before estimates", () => {
  const rows = [...many(6, { hour: 10, replyMin: 5 }), ...many(7, { hour: 20, replyMin: 20 }), ...many(6, { ownerName: "Marcus", replyMin: null, daysAgo: 4 }), ...many(5, { source: "Facebook", replyMin: 40 }), ...many(5, { source: "Yelp", replyMin: 4 })];
  const noshows: TodayItem[] = Array.from({ length: 3 }, (_, k) => ({ id: `noshows:${k}`, kind: "noshows" as const, locationId: "aaa", accountName: "A", name: "x", detail: "", at: NOW, value: null, contactId: null, url: "u" }));
  const lead = [insightIdleOwner(rows, NOW), insightAfterHours(rows), insightSource(rows)].filter((x) => x) as NonNullable<ReturnType<typeof insightSource>>[];
  const picked = pickInsights(lead, noshows);
  assert.equal(picked.length, 3);
  assert.deepEqual(picked.map((p) => p.key), ["idle_owner", "noshows", "slow_after_hours"]);
  assert.deepEqual(pickInsights([], []), []);
});

test("coverage strip: an hour is a gap with 5 leads and under half answered in time; the hour's list equals its count", () => {
  const rows = [...many(6, { hour: 9, replyMin: 5 }), ...many(6, { hour: 22, replyMin: 40 }), ...many(3, { hour: 3, replyMin: 40 })];
  const s = hourStats(rows, 15, NOW);
  assert.equal(s[9].leads, 6); assert.equal(s[9].gap, false);
  assert.equal(s[22].gap, true);
  assert.equal(s[3].gap, false, "only 3 leads: not enough to call a gap");
  for (const h of [3, 9, 22]) assert.equal(leadsInHour(rows, h, 15, NOW).length, s[h].leads);
  assert.equal(s.reduce((a, x) => a + x.leads, 0), rows.length);
});

test("sources: per source typical reply from 5 answered; the list equals the count", () => {
  const rows = [...many(6, { source: "facebook", replyMin: 20 }), ...many(5, { source: "Facebook", replyMin: 25 }), ...many(3, { source: "Google", replyMin: 5 }), ...many(2, { source: null, replyMin: 5 })];
  const s = sourceStats(rows, 15, NOW);
  const fb = s.find((x) => x.name === "Facebook")!;
  assert.equal(fb.leads, 11, "upper and lower case are one source");
  assert.ok(fb.medianSeconds !== null);
  assert.equal(s.find((x) => x.name === "Google")!.medianSeconds, null);
  assert.equal(s.reduce((a, x) => a + x.leads, 0), rows.length);
});

test("workload: waiting by owner, overloaded needs 3 people and twice the middle, quiet needs real data elsewhere", () => {
  const w = (owner: string | null, k: number): TodayItem[] => Array.from({ length: k }, () => ({ id: `leads:${n++}`, kind: "leads" as const, locationId: "aaa", accountName: "A", name: "x", detail: "", at: NOW - 2 * H, value: null, contactId: "c", url: "u", owner }));
  const waiting = [...w("Marcus", 9), ...w("Dana", 2), ...w("Priya", 3), ...w(null, 4)];
  const ledger = [...many(6, { touchBy: "Dana", replyMin: 5 }), ...many(3, { touchBy: "Priya", replyMin: 9 })];
  const p = workload(waiting, ledger, NOW);
  assert.equal(p.find((x) => x.name === "Marcus")!.flag, "overloaded");
  assert.equal(p.find((x) => x.name === "Marcus")!.replies, 0);
  assert.equal(p.find((x) => x.name === "Dana")!.medianSeconds, 300);
  assert.equal(p.find((x) => x.name === "Dana")!.flag, null);
  assert.equal(p.find((x) => x.name === "Nobody assigned")!.waiting, 4);
  assert.equal(p.find((x) => x.name === "Nobody assigned")!.flag, null);
  assert.equal(p.reduce((a, x) => a + x.waiting, 0), waiting.length);
  const two = workload([...w("Marcus", 9), ...w("Dana", 2)], ledger, NOW);
  assert.equal(two.find((x) => x.name === "Marcus")!.flag, "quiet", "no replies from Marcus while the ledger has 9: quiet, and 2 people are too few to call overloaded");
  const few = workload(w("Marcus", 9), many(2, { touchBy: "Dana" }), NOW);
  assert.equal(few.find((x) => x.name === "Marcus")!.flag, null, "2 replies in all: silence means nothing");
});

test("accounts compared: needs 5 answered, fastest and slowest are the two ends, never overlapping", () => {
  const acct = (id: string, name: string, k: number, min: number) => many(k, { locationId: id, accountName: name, replyMin: min });
  const rows = [...acct("a", "A", 6, 2), ...acct("b", "B", 6, 9), ...acct("c", "C", 6, 30), ...acct("d", "D", 6, 60), ...acct("e", "E", 5, 5), ...acct("f", "F", 4, 1)];
  const { ranked, tooFew } = accountSpeeds(rows);
  assert.equal(tooFew, 1);
  assert.deepEqual(ranked.map((r) => r.name), ["A", "E", "B", "C", "D"]);
  const fs = fastestSlowest(ranked);
  assert.deepEqual(fs.fastest.map((r) => r.name), ["A", "E"]);
  assert.deepEqual(fs.slowest.map((r) => r.name), ["D", "C"]);
  assert.deepEqual(fastestSlowest([]).fastest, []);
});

const ACCOUNTS: AccountFacts[] = [{ id: "aaa", name: "Maple Dental", followUpEstimate: null, url: "https://crm.example.com/a" }, { id: "bbb", name: "Harbor Realty", followUpEstimate: null, url: "https://crm.example.com/b" }];
const item = (kind: Kind, loc: string, over: Partial<TodayItem> = {}): TodayItem => ({ id: `${kind}:${n++}`, kind, locationId: loc, accountName: loc === "aaa" ? "Maple Dental" : "Harbor Realty", name: `P${n}`, detail: "", at: NOW - 2 * H, value: null, contactId: `c${n}`, url: "u", ...over });
const totalsOf = (items: TodayItem[]): Totals => { const t = emptyTotals(); for (const k of KINDS) { const m = items.filter((x) => x.kind === k); t[k] = { count: m.length, dollars: k === "stale" && m.length ? m.reduce((s, x) => s + (x.value ?? 0), 0) : null, shown: m.length }; } return t; };

test("best next action: fixed rules per kind, the effect is arithmetic on the count", () => {
  const items = [...Array.from({ length: 8 }, (_, k) => item("leads", "aaa", { at: NOW - (k + 1) * H })), ...Array.from({ length: 4 }, () => item("stale", "bbb", { value: 1000, at: NOW - 40 * D }))];
  const q = buildQueue({ items, totals: totalsOf(items), accounts: new Map(ACCOUNTS.map((a) => [a.id, a])), staleDays: 30, now: NOW });
  const a = nextAction(q, items, "aaa")!;
  assert.equal(a.kind, "leads"); assert.equal(a.n, 5); assert.equal(a.of, 8);
  assert.equal(a.text, "Answer the 5 longest-waiting leads first");
  assert.match(a.effect, /3 leads would still be waiting after that/);
  assert.equal(a.itemIds.length, 5);
  assert.equal(items.find((i) => i.id === a.itemIds[0])!.at, NOW - 8 * H, "the longest wait comes first");
  const b = nextAction(q, items, "bbb")!;
  assert.equal(b.text, "Review the 3 biggest stale deals");
  assert.equal(nextAction(q, items, "zzz"), null);
  const one = nextAction(buildQueue({ items: [items[0]], totals: totalsOf([items[0]]), accounts: new Map(ACCOUNTS.map((x) => [x.id, x])), staleDays: 30, now: NOW }), [items[0]], "aaa")!;
  assert.equal(one.text, "Answer the longest-waiting lead first");
  assert.match(one.effect, /clear/);
});

test("why: only measurable shared facts that cover at least half of a leads row, never a cause", () => {
  const l = (o: Partial<TodayItem>) => item("leads", "aaa", { at: NOW - 3 * H, ...o });
  const items = [l({ owner: null, source: "Facebook" }), l({ owner: null, source: "Facebook" }), l({ owner: null, source: "Facebook" }), l({ owner: "Priya", source: "Google" })];
  const row = buildQueue({ items, totals: totalsOf(items), accounts: new Map(ACCOUNTS.map((a) => [a.id, a])), staleDays: 30, now: NOW })[0];
  const w = whyOf(row, items, "UTC");
  assert.deepEqual(w.map((x) => x.key), ["no_owner", "source"]);
  assert.equal(w[0].n, 3); assert.equal(w[0].itemIds.length, 3);
  assert.match(w[0].text, /3 of 4 have no owner in the CRM/);
  assert.match(w[1].text, /3 of 4 came from Facebook/);
  const late = [l({ at: new Date("2026-11-04T01:00:00Z").getTime() }), l({ at: new Date("2026-11-04T02:00:00Z").getTime() }), l({ at: new Date("2026-11-04T11:00:00Z").getTime(), owner: "x", source: "a" })];
  const r2 = buildQueue({ items: late, totals: totalsOf(late), accounts: new Map(ACCOUNTS.map((a) => [a.id, a])), staleDays: 30, now: NOW })[0];
  assert.ok(whyOf(r2, late, "UTC").some((x) => x.key === "after_hours" && x.n === 2));
  const stale = [item("stale", "aaa", { value: 5 }), item("stale", "aaa", { value: 5 })];
  assert.deepEqual(whyOf(buildQueue({ items: stale, totals: totalsOf(stale), accounts: new Map(ACCOUNTS.map((a) => [a.id, a])), staleDays: 30, now: NOW })[0], stale, "UTC"), []);
});

test("forecast: leads inside their reply window pass the target at arrival plus target, in order; the line says it in words", () => {
  const rows = [lead({ leadAt: NOW - 3 * M, replyMin: null, name: "Soon" }), lead({ leadAt: NOW - 10 * M, replyMin: null, name: "Soonest" }), lead({ leadAt: NOW - 30 * M, replyMin: null, name: "Already late" }), lead({ leadAt: NOW - 2 * M, replyMin: 1, name: "Answered" })];
  const c = comingLeads(rows, 15, NOW);
  assert.deepEqual(c.map((x) => x.name), ["Soonest", "Soon"]);
  assert.equal(c[0].at, NOW + 5 * M);
  const f = forecastOf(c, [{ id: "d", kind: "stale", locationId: "aaa", accountName: "A", name: "D", at: NOW + H, value: 2500, contactId: null, url: "u" }], []);
  assert.equal(f.next!.name, "Soonest");
  assert.equal(f.dealDollars, 2500);
  assert.equal(forecastLine(f, 15), "If nobody acts today: 2 leads will pass the 15-minute reply target, 1 deal ($2,500) will turn stale.");
  assert.equal(forecastLine(forecastOf([], [], []), 15), "Nothing is about to go wrong today.");
});

test("since your last visit: a new visit starts after a 30 minute gap; the numbers are the leads and alerts since", () => {
  assert.deepEqual(nextVisit(null, NOW), { seen: NOW, since: null });
  assert.deepEqual(nextVisit({ seen: NOW - 10 * M, since: 5 }, NOW), { seen: NOW, since: 5 });
  assert.deepEqual(nextVisit({ seen: NOW - VISIT_GAP_MS - 1, since: 5 }, NOW), { seen: NOW, since: NOW - VISIT_GAP_MS - 1 });
  const since = NOW - 5 * H;
  const rows = [lead({ leadAt: NOW - 4 * H, replyMin: 5, name: "New, fast" }), lead({ leadAt: NOW - 3 * H, replyMin: 60, name: "New, late" }), lead({ leadAt: NOW - 2 * H, replyMin: null, name: "New, waiting" }), lead({ leadAt: NOW - 9 * H, replyMin: 600, name: "Old, answered now" })];
  const alerts: AlertFact[] = [{ id: "a", locationId: "aaa", accountName: "A", title: "t", severity: "warning", createdAt: NOW - D, resolvedAt: NOW - H }, { id: "b", locationId: "aaa", accountName: "A", title: "t", severity: "warning", createdAt: NOW - D, resolvedAt: NOW - 8 * H }];
  const s = sinceVisitOf({ since, ledger: rows, alerts, targetMinutes: 15, now: NOW })!;
  assert.equal(s.newLeads.length, 3);
  assert.equal(s.breached.length, 2, "late and waiting passed the target since");
  assert.equal(s.answered.length, 2, "fast and the old one answered after the visit... the old one at -9h+10h");
  assert.equal(s.clearedAlerts.length, 1);
  assert.equal(sinceVisitOf({ since: null, ledger: rows, alerts, targetMinutes: 15, now: NOW }), null);
  assert.equal(sinceVisitOf({ since: NOW - 40 * D, ledger: rows, alerts, targetMinutes: 15, now: NOW })!.since, NOW - 14 * D);
});

// ---------- the records behind every mark: the number pressed equals the rows listed ----------

function env(items: TodayItem[], ledger: LeadRow[] = [], excludeJunk = false, holds: Record<string, never> = {}, extra: Partial<Totals> = {}): SpecEnv {
  const view = applyView({ items, totals: { ...totalsOf(items), ...extra }, accounts: ACCOUNTS, staleDays: 30, now: NOW }, { holds, excludeJunk });
  return { now: NOW, view, accounts: ACCOUNTS, staleDays: 30, targetMinutes: 15, ledger, scope: "all", excluded: excludeJunk };
}

test("every mark opens exactly the rows it counts", () => {
  const items = [
    ...Array.from({ length: 7 }, () => item("leads", "aaa", { owner: "Marcus", source: "Facebook" })), ...Array.from({ length: 3 }, () => item("leads", "bbb")),
    ...Array.from({ length: 2 }, () => item("appointments", "aaa")), ...Array.from({ length: 4 }, (_, k) => item("stale", "bbb", { value: 1000 + k, at: NOW - 40 * D })),
    ...Array.from({ length: 3 }, () => item("noshows", "aaa")), item("unanswered", "bbb"),
  ];
  const e = env(items);
  for (const k of KINDS) { const s = specKind(k, e); assert.equal(s.rows.length, e.view.totals[k].count, k); assert.equal(s.count, e.view.totals[k].count, k); }
  for (const r of e.view.queue) { const s = specRow(r, e); assert.equal(s.rows.length, r.count, r.key); assert.equal(s.count, r.count); }
  for (const a of ACCOUNTS) { const s = specAccount(a.id, e); assert.equal(s.rows.length, e.view.queue.filter((r) => r.locationId === a.id).reduce((x, r) => x + r.count, 0)); }
  assert.equal(specClients(e).count, 2); assert.equal(specClients(e).rows.length, 2);
  const d = specDollars(e);
  assert.equal(d.rows.length, 4);
  assert.equal(d.rows.reduce((s, r) => s + (r.cells.value as number), 0), e.view.totals.stale.dollars);
  assert.equal(specThings(e).rows.length, items.length);
  assert.equal(specThings(e).count, items.length);
  // A kind of which the server sent only some rows: the count stays the true number, and the list says it was cut.
  const cut = env(items, [], false, {}, { leads: { count: 50, dollars: null, shown: 10 } });
  assert.equal(specKind("leads", cut).count, 50);
  assert.equal(specKind("leads", cut).rows.length, 10);
  assert.ok(specKind("leads", cut).note);
});

test("holds and the junk control change the number and the list together", () => {
  const items = [item("stale", "aaa", { value: 5000, at: NOW - 40 * D }), item("stale", "aaa", { value: 7000, at: NOW - 120 * D }), item("leads", "aaa"), item("leads", "aaa")];
  const hold = { eventId: 1, action: "snooze" as const, until: NOW + D, by: "Dana", at: NOW, rowKey: "aaa|leads" } as never;
  const e = env(items, [], true, { [items[2].id]: hold });
  assert.equal(specKind("stale", e).count, 1);
  assert.equal(specKind("stale", e).rows.length, 1);
  assert.match(specKind("stale", e).note ?? "", /Left out: 1 test or very old deal worth \$7,000/);
  assert.equal(specKind("leads", e).count, 1);
  assert.equal(specKind("leads", e).rows.length, 1);
});

test("leads, alerts, days, hours, sources and insights lists equal their counts", () => {
  const rows = [...many(6, { hour: 9, replyMin: 5, source: "Google" }), ...many(7, { hour: 20, replyMin: 40, source: "Facebook" })];
  const e = env([], rows);
  const hs = hourStats(rows, 15, NOW);
  for (const h of [9, 20]) { const s = specHour(rows, h, 15, NOW); assert.equal(s.count, hs[h].leads); assert.equal(s.rows.length, hs[h].leads); }
  for (const st of sourceStats(rows, 15, NOW)) { const s = specSource(rows, st.name, 15, NOW); assert.equal(s.count, st.leads); assert.equal(s.rows.length, st.leads); }
  const ins = insightAfterHours(rows)!;
  assert.equal(specInsight(ins, e).count, ins.sample); assert.equal(specInsight(ins, e).rows.length, ins.sample);
  const rep = specReplies(e, NOW, 14, "Typical first reply");
  assert.equal(rep.rows.length, rows.length);
  const proof: Proof = {
    raised: 3, cleared: 1, open: 2,
    days: [{ day: "2026-11-03", label: "Tue", raised: [{ id: "a", locationId: "aaa", accountName: "A", title: "t", severity: "warning", createdAt: NOW - D, resolvedAt: null }, { id: "b", locationId: "aaa", accountName: "A", title: "t", severity: "critical", createdAt: NOW - D, resolvedAt: NOW - H }], cleared: [{ id: "b", locationId: "aaa", accountName: "A", title: "t", severity: "critical", createdAt: NOW - D, resolvedAt: NOW - H }] }, { day: "2026-11-04", label: "Wed", raised: [{ id: "c", locationId: "aaa", accountName: "A", title: "t", severity: "info", createdAt: NOW, resolvedAt: null }], cleared: [] }],
    openAlerts: [{ id: "a", locationId: "aaa", accountName: "A", title: "t", severity: "warning", createdAt: NOW - D, resolvedAt: null }, { id: "c", locationId: "aaa", accountName: "A", title: "t", severity: "info", createdAt: NOW, resolvedAt: null }],
  };
  assert.equal(specAlerts(proof, "raised").rows.length, proof.raised);
  assert.equal(specAlerts(proof, "cleared").rows.length, proof.cleared);
  assert.equal(specAlerts(proof, "open").rows.length, proof.open);
  assert.equal(specAlerts(proof, { day: 0 }).rows.length, proof.days[0].raised.length + proof.days[0].cleared.length);
  const sv = sinceVisitOf({ since: NOW - 30 * H, ledger: rows, alerts: [], targetMinutes: 15, now: NOW })!;
  for (const k of ["new", "breached", "answered"] as const) assert.equal(specSince(k, sv, e).rows.length, specSince(k, sv, e).count);
  const c = comingLeads([lead({ leadAt: NOW - 2 * M, replyMin: null })], 15, NOW);
  assert.equal(specComing("leads", c, 15).rows.length, c.length);
  assert.equal(pointEnd("2026-11-04", NOW), NOW);
  assert.equal(pointEnd("2026-11-01", NOW), NOW - 3 * D);
});
