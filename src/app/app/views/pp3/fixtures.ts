import type {
  PpAccessAccount, PpAccessPerson, PpAccountRef, PpBoardGroup, PpCoach, PpHandoff, PpListRow, PpLoadRow, PpMeta, PpMoneyRow, PpNextLead, PpNote, PpPage, PpPanel, PpPart, PpPerson, PpProof, PpRank, PpRate, PpReason, PpRole, PpToday,
} from "@/lib/analytics/people3-types-interim";

// SAMPLE DATA ONLY (open Team with ?ppfx=1, ?ppfx=empty or ?ppfx=error). No database, no real people; the screen says "Sample data" whenever this is used.
// Realistic on purpose: about 1 person in 9 is flagged, and the rest are fine. 12 client accounts and 44 people prove the lists page and scale.
export type FxParams = Record<string, string | number | undefined>;
const FIRST = ["Priya", "Marcus", "Elena", "Tomas", "Aisha", "Daniel", "Grace", "Hiro", "Lena", "Omar", "Sofia", "Victor", "Nia", "Caleb", "Ruth", "Ibrahim", "Maya", "Felix", "Zara", "Jonah", "Clara"];
const LAST = ["Shah", "Reed", "Costa", "Novak", "Bello", "Hart", "Okoye", "Tanaka", "Weber", "Haddad", "Rossi", "Lund", "Mensah", "Ellis", "Park", "Silva"];
const ACCT = ["Northside Roofing", "Bright Smiles Dental", "Lakeview Realty", "Harbor Med Spa", "Summit Solar", "Cedar Coaching", "Ironwood HVAC", "Maple Family Law", "Oak Street Dental", "Redline Auto", "Blue Fern Spa", "Granite Homes"];
export const ACCOUNTS: PpAccountRef[] = ACCT.map((name, i) => ({ locationId: `loc${i}`, name }));
const rnd = (i: number, k: number) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
const NOW = Date.parse("2026-11-11T08:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const rate = (n: number, of: number, min = 20): PpRate => ({ value: of >= min ? n / of : null, n, of, enough: of >= min });
const N = 44;

type Raw = PpPerson & { accts: number[]; staff: boolean; setter: boolean };
const RAW: Raw[] = Array.from({ length: N }, (_, i) => {
  const r = (k: number) => rnd(i, k);
  const role: PpRole = i === 0 ? "owner" : i < 3 ? "admin" : "staff";
  const accts = role === "staff" ? [...new Set([i % 12, ...(i % 3 === 0 ? [(i + 5) % 12] : [])])] : ACCOUNTS.map((_, k) => k);
  const unnamed = i >= N - 2, fresh = i % 11 === 10, idle = role === "staff" && i % 9 === 4;
  const leads = fresh ? 8 + Math.floor(r(1) * 10) : 60 + Math.floor(r(1) * 340), ofIn = Math.max(leads - 2, 0), inTime = Math.round(ofIn * (0.55 + r(2) * 0.4)), set = Math.round(leads * (0.1 + r(3) * 0.2)), held = Math.round(set * (0.6 + r(4) * 0.3));
  const wonCount = Math.round(leads * (0.03 + r(5) * 0.08)), enough = !fresh && !unnamed;
  const name = unnamed ? "Unnamed user" : `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
  const base = 45 + r(6) * 45;
  return {
    userId: `u${i}`, name, unnamed, email: role === "staff" ? null : `${FIRST[i % FIRST.length].toLowerCase()}@team.example`, role, deleted: false, awayUntil: i === 17 ? "2026-11-14" : null,
    accounts: accts.length, accountNames: accts.slice(0, 3).map((a) => ACCT[a]), leadsHandled: leads, firstReplyMinutes: enough ? Math.round((4 + r(7) * 40) * 10) / 10 : null, inTime: rate(inTime, ofIn), appointmentsSet: { current: set, previous: Math.round(set * (0.8 + r(8) * 0.4)), change: set > 5 ? (r(8) - 0.5) * 0.5 : null, enough: set >= 5, estimated: i % 2 === 0 },
    showed: rate(held, set, 8), wonCount, wonValue: { current: wonCount * (1800 + Math.round(r(9) * 3000)), previous: wonCount * 2400, change: enough ? (r(10) - 0.45) * 0.6 : null, enough },
    spark: [...Array(8)].map((_, k) => Math.round(Math.min(98, base + (rnd(i, 40 + k) - 0.5) * 24))), lastActivityAt: iso(NOW - (idle ? 31 : 0.3 + r(11) * 6) * 3_600_000), idle, enough, url: null, accts, staff: role === "staff", setter: i % 3 !== 0,
  };
});
export const PEOPLE: PpPerson[] = RAW.map((r) => { const { accts: _a, staff: _s, setter: _t, ...p } = r; void _a; void _s; void _t; return p; });

const META: PpMeta = { flags: {}, ownRowOnly: false, canSeeEveryone: true, needsUsersPermission: false, problem: null, historyStarts: "2026-09-14", generatedAt: iso(NOW - 600_000) };
export const withMeta = <T,>(x: T): T & PpMeta => ({ ...x, ...META });
const text = (p: FxParams, k: string) => String(p[k] ?? "");
const cursor = (p: FxParams) => Math.max(0, Number(p.cursor ?? 0) || 0);
function page<T>(all: T[], p: FxParams, size = 25): PpPage<T> { const at = cursor(p), rows = all.slice(at, at + size); return { rows, total: all.length, next: at + size < all.length ? String(at + size) : null, truncated: false }; }
const byName = <T extends { name: string }>(rows: T[], p: FxParams) => { const q = text(p, "q").toLowerCase(); return q ? rows.filter((x) => x.name.toLowerCase().includes(q)) : rows; };
const staffOnly = (rows: PpPerson[], p: FxParams) => (p.admins === "1" ? rows : rows.filter((x) => x.role === "staff"));

// ---- workload (per person per account) ----
const LOAD: PpLoadRow[] = RAW.filter((x) => x.staff).flatMap((x, n) => x.accts.map((a, k) => {
  const over = (n + a) % 13 === 0, under = !over && (n + a) % 17 === 0, med = 24 + (a % 5) * 4, idle = x.idle && k === 0;
  const openLeads = Math.round(over ? med * 1.9 : under ? med * 0.3 : med * (0.75 + rnd(n, a) * 0.5));
  const waiting = idle ? 9 + (n % 7) : over ? 6 : Math.floor(rnd(n, a + 3) * 3);
  return { userId: x.userId, name: x.name, locationId: `loc${a}`, accountName: ACCT[a], openLeads, waiting, openDeals: 4 + Math.floor(rnd(n, a + 5) * 18), upcoming: Math.floor(rnd(n, a + 7) * 7), level: over ? "over" : under ? "under" : "normal", median: med, why: over ? `${openLeads} open leads, the usual in this account is ${med}` : under ? `Only ${openLeads} open leads, the usual in this account is ${med}` : null, enough: !x.unnamed && x.enough } as PpLoadRow;
}));

function today(p: FxParams): PpToday {
  const mine = p.own === "1";
  const lines: PpToday["lines"] = LOAD.filter((l) => l.waiting >= 9).slice(0, 3).map((l) => ({ userId: l.userId, name: l.name, locationId: l.locationId, accountName: l.accountName, text: `${l.name} has ${l.waiting} leads waiting more than 2 hours in ${l.accountName}`, reason: "waiting" as PpReason, count: l.waiting }));
  const idleOne = RAW.find((x) => x.idle);
  if (idleOne && lines.length < 3) lines.push({ userId: idleOne.userId, name: idleOne.name, locationId: null, accountName: null, text: `No activity recorded in your CRM for ${idleOne.name} in the last 31 hours while leads wait`, reason: "idle", count: 1 });
  const first = lines[0];
  return { headline: mine ? "You have 6 leads waiting for a reply." : first ? first.text : "Nobody is waiting on a reply.", lines, ownQueue: mine, button: first ? { label: mine ? "Open my queue" : "See the leads", reason: first.reason, userId: first.userId, locationId: first.locationId, count: first.count } : null };
}

function ranks(a: number, board: string): PpRank[] {
  const pool = RAW.filter((x) => x.staff && x.accts.includes(a) && (board === "closers" ? !x.setter : x.setter));
  const scored = pool.map((x) => ({ x, v: board === "closers" ? x.wonValue.current : (x.inTime.value ?? 0) })).sort((m, n) => n.v - m.v);
  let rank = 0;
  return scored.map(({ x, v }) => {
    const ok = x.enough && x.leadsHandled >= 20;
    if (ok) rank++;
    return { userId: x.userId, name: x.name, rank: ok ? rank : null, leads: x.leadsHandled, value: ok ? v : null, enough: ok, you: false, why: ok ? (board === "closers" ? `${x.wonCount} deals won from ${x.leadsHandled} leads in this account` : `${Math.round((x.inTime.value ?? 0) * 100)}% of ${x.leadsHandled} first replies in time, same source mix as the others`) : `Not enough data: ${x.leadsHandled} leads, needs 20` };
  });
}
function board(p: FxParams) {
  const b = text(p, "board") === "closers" ? "closers" : "setters", loc = text(p, "location");
  const groups: PpBoardGroup[] = ACCOUNTS.map((a, i) => ({ a, i })).filter(({ a }) => !loc || a.locationId === loc).map(({ a, i }) => {
    const all = ranks(i, b), ranked = all.filter((x) => x.rank !== null), half = Math.max(1, Math.ceil(ranked.length / 2));
    return { locationId: a.locationId, accountName: a.name, mix: i % 2 ? "Website and ads" : "Ads and referrals", people: all.length, rows: [...ranked.slice(0, half), ...all.filter((x) => x.rank === null)], hidden: ranked.length - Math.min(half, ranked.length), note: all.length < 2 ? "Only one person works here, so there is no ranking." : null };
  }).filter((g) => g.people > 0);
  return { ...page(groups, p, 6), board: b, metric: b === "closers" ? "Deals won" : "Replied in time", minLeads: 20, minDays: 14 };
}

function money(p: FxParams) {
  const rows: PpMoneyRow[] = text(p, "by") === "account"
    ? ACCOUNTS.map((a, i) => { const ls = LOAD.filter((l) => l.locationId === a.locationId), w = ls.reduce((s, l) => s + l.waiting, 0); return { userId: "", name: a.name, locationId: a.locationId, accountName: a.name, wonValue: 9000 + Math.round(rnd(i, 1) * 60000), wonCount: 3 + Math.floor(rnd(i, 2) * 20), openValue: 40000 + Math.round(rnd(i, 3) * 200000), staleValue: Math.round(rnd(i, 4) * 40000), waitingCount: w, waitingValue: w * 1100 }; })
    : staffOnly(PEOPLE, { admins: "0" }).map((x, i) => { const w = LOAD.filter((l) => l.userId === x.userId).reduce((s, l) => s + l.waiting, 0); return { userId: x.userId, name: x.name, locationId: null, accountName: null, wonValue: x.wonValue.current, wonCount: x.wonCount, openValue: 6000 + Math.round(rnd(i, 21) * 90000), staleValue: Math.round(rnd(i, 22) * 18000), waitingCount: w, waitingValue: w * 1100 }; });
  const shown = byName(rows, p).sort((a, b) => b.wonValue - a.wonValue);
  const sum = (f: (r: PpMoneyRow) => number) => shown.reduce((s, r) => s + f(r), 0);
  return { ...page(shown, p), totals: { wonValue: sum((r) => r.wonValue), openValue: sum((r) => r.openValue), staleValue: sum((r) => r.staleValue), waitingValue: sum((r) => r.waitingValue) }, formulas: { won: "Value of deals marked won in the period, credited to the person who owned the deal at the time.", open: "Value of deals still open today, by current owner.", stale: "Open deals with no movement for longer than their stage allows. An estimate of what may slip.", waiting: "Leads waiting for a reply, times your average lead value. An estimate, not money lost." } };
}

const COACH_METRIC = ["How fast the first reply goes out", "Share of replies sent in time", "Appointments set", "Share who show up"];
const coach = (x: PpPerson, i: number): PpCoach => {
  const k = i % 4;
  return { userId: x.userId, name: x.name, enough: x.enough, lowest: x.enough ? { label: COACH_METRIC[k], now: k === 1 ? `${Math.round((x.inTime.value ?? 0) * 100)}%` : `${12 + k * 3} min`, before: k === 1 ? "81%" : `${9 + k * 3} min` } : null, focus: x.enough ? `Work on ${COACH_METRIC[k].toLowerCase()}.` : null, targets: [{ metric: "reply", label: "First reply", value: 10, unit: "min" }, { metric: "inTime", label: "In time", value: 85, unit: "%" }], notes: i % 5 === 0 ? 2 : i % 3 === 0 ? 1 : 0, lastNoteAt: i % 3 === 0 ? iso(NOW - (2 + i) * 86_400_000) : null, moves: x.enough ? [{ label: "First reply", from: "11 min", to: "8 min" }] : [] };
};

const accessP = (): PpAccessPerson[] => RAW.map((x, i) => ({ userId: x.userId, name: x.name, role: x.role, scope: x.role !== "staff" ? "all" : i === 31 ? "none" : "some", accountCount: i === 31 ? 0 : x.accts.length, accounts: i === 31 ? [] : x.accts.slice(0, 8).map((a) => ACCOUNTS[a]), connected: i % 6 !== 5, lastSeenAt: x.lastActivityAt, newPerson: x.unnamed }));
const accessA = (): PpAccessAccount[] => ACCOUNTS.map((a, i) => {
  const ps = RAW.filter((x) => x.staff && x.accts.includes(i)), act = ps.filter((x) => !x.idle).length, single = i === 7 || ps.length === 1;
  return { locationId: a.locationId, name: a.name, people: ps.length, active: act, topName: ps[0]?.name ?? null, topShare: rate(single ? 88 : 41, 100), flags: [...(act === 0 ? ["nobody_active" as const] : []), ...(single ? ["single_point" as const] : [])] };
});

function proof(p: FxParams): PpProof {
  const i = Math.max(0, ACCOUNTS.findIndex((a) => a.locationId === text(p, "location"))), ps = RAW.filter((x) => x.staff && x.accts.includes(i)), set = 22 + i, held = Math.round(set * 0.74);
  return { locationId: ACCOUNTS[i].locationId, accountName: ACCT[i], from: "2026-11-02", to: "2026-11-08", sentence: "Your team answered 94 of 101 new leads this week, half of them within 8 minutes.", answered: rate(94, 101), medianMinutes: 8.2, inTime: rate(86, 101), appointments: { booked: set, held, noShow: set - held }, showed: rate(held, set), naming: i % 4 === 0, staff: i % 4 === 0 ? ps.slice(0, 3).map((x) => ({ name: x.name, answered: 20 + Math.round(rnd(i, 9) * 30), medianMinutes: x.firstReplyMinutes })) : null, historyStarts: "2026-09-14" };
}

const notesFor = (id: string): PpNote[] => (Number(id.slice(1)) % 3 === 0 ? [{ id: `n${id}`, title: "Reply speed check-in", text: "Talked through the evening gap. Agreed to check the inbox at 5pm.", author: "Dana Whitfield", at: iso(NOW - 4 * 86_400_000), shared: true, mine: true }] : []);
function panel(p: FxParams): PpPanel {
  const x = RAW.find((r) => r.userId === text(p, "user")) ?? RAW[1], n = Number(x.userId.slice(1)), weeks = [...Array(8)].map((_, k) => iso(NOW - (7 - k) * 7 * 86_400_000).slice(5, 10));
  const g = (k: number, lo: number, hi: number) => [...Array(8)].map((_, w) => Math.round(lo + rnd(n + 3, k * 10 + w) * (hi - lo)));
  const wl = LOAD.filter((l) => l.userId === x.userId), me = PEOPLE[n], first = x.name.split(" ")[0];
  return {
    person: me, headline: x.enough ? `${first} replies to ${Math.round((x.inTime.value ?? 0) * 100)}% of new leads in time and has set ${x.appointmentsSet.current} appointments this period.` : `${first} has handled ${x.leadsHandled} leads. Not enough data to say more yet.`, weeks, trends: { response: g(1, 5, 30), booked: g(2, 2, 14), showed: g(3, 50, 95), won: g(4, 0, 6) },
    accounts: x.accts.slice(0, 5).map((a) => { const l = wl.find((m) => m.locationId === `loc${a}`); return { locationId: `loc${a}`, name: ACCT[a], role: x.role === "staff" ? "Staff" : x.role === "admin" ? "Admin" : "Owner", openLeads: l?.openLeads ?? 0, waiting: l?.waiting ?? 0, openDeals: l?.openDeals ?? 0, upcoming: l?.upcoming ?? 0, url: null }; }),
    focus: coach(me, n).focus, notes: notesFor(x.userId), nextLead: x.enough && x.staff ? { locationId: `loc${x.accts[0]}`, accountName: ACCT[x.accts[0]], because: "fewest waiting leads in this account and fastest on its main source" } : null, historyStarts: "2026-09-14",
  };
}

function list(p: FxParams): PpListRow[] {
  const n = Number(p.expect ?? 8), acct = text(p, "account") || ACCT[0], reason = text(p, "reason");
  return Array.from({ length: n }, (_, i) => ({ contactName: `${FIRST[(i * 3) % FIRST.length]} ${LAST[(i * 5) % LAST.length]}`, accountName: acct, locationId: "loc0", detail: reason === "idle" ? "Last reply 31 hours ago" : reason === "no_outcome" ? "Appointment time passed, no outcome" : "Waiting for a reply", value: i % 3 === 0 ? 1500 + i * 120 : null, at: iso(NOW - (3 + i * 2) * 3_600_000), url: null }));
}
const handoffs = (): PpHandoff[] => Array.from({ length: 30 }, (_, i) => ({ contactName: `${FIRST[i % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`, accountName: ACCT[i % 12], locationId: `loc${i % 12}`, bookedBy: RAW[3 + (i % 20)].name, closedBy: RAW[4 + ((i * 3) % 20)].name, days: 2 + (i % 9), value: 1800 + i * 150, estimated: i % 2 === 0, url: null }));
const nextlead = (p: FxParams): PpNextLead => {
  const i = Math.max(0, ACCOUNTS.findIndex((a) => a.locationId === text(p, "location"))), ls = LOAD.filter((l) => l.locationId === `loc${i}` && l.level !== "over" && l.enough).sort((a, b) => a.waiting - b.waiting), best = ls[0];
  return best
    ? { locationId: `loc${i}`, accountName: ACCT[i], userId: best.userId, name: best.name, because: `${best.name.split(" ")[0]} has the fewest waiting leads (${best.waiting}) and answers this source fastest.`, sample: 120 + i * 9, enough: true, waitingNow: LOAD.filter((l) => l.locationId === `loc${i}`).reduce((s, l) => s + l.waiting, 0) }
    : { locationId: `loc${i}`, accountName: ACCT[i], userId: null, name: null, because: null, sample: 0, enough: false, waitingNow: 0 };
};

const EMPTY_PAGE = { rows: [], total: 0, next: null, truncated: false };
/** One answer in the shape of the real part. `empty` returns the empty state of each part. */
export function sample(part: PpPart, p: FxParams, empty: boolean): unknown {
  if (empty && part !== "options") {
    if (part === "today") return withMeta({ headline: "", lines: [], button: null, ownQueue: false });
    if (part === "money") return withMeta({ ...EMPTY_PAGE, totals: { wonValue: 0, openValue: 0, staleValue: 0, waitingValue: 0 }, formulas: {} });
    if (part === "leaderboard") return withMeta({ ...EMPTY_PAGE, board: "setters", metric: "Replied in time", minLeads: 20, minDays: 14 });
    if (part === "access") return withMeta({ ...EMPTY_PAGE, by: "person" });
    if (part === "nextlead") return withMeta({ locationId: "", accountName: "", userId: null, name: null, because: null, sample: 0, enough: false, waitingNow: 0 });
    if (part === "proof" || part === "person") return withMeta({});
    return withMeta(EMPTY_PAGE);
  }
  switch (part) {
    case "options": return withMeta({ accounts: ACCOUNTS, minLeads: 20, minDays: 14, staff: RAW.filter((x) => x.staff).length, idleHours: 4 });
    case "today": return withMeta(today(p));
    case "scorecards": {
      const acct = text(p, "location"), k = text(p, "sort");
      const rows = byName(staffOnly(PEOPLE, p), p).filter((x) => !acct || RAW[Number(x.userId.slice(1))].accts.includes(Number(acct.slice(3))));
      rows.sort((a, b) => (k === "won" ? b.wonValue.current - a.wonValue.current : k === "leads" ? b.leadsHandled - a.leadsHandled : k === "reply" ? (a.firstReplyMinutes ?? 1e9) - (b.firstReplyMinutes ?? 1e9) : a.name.localeCompare(b.name)));
      return withMeta(page(rows, p));
    }
    case "handoffs": return withMeta(page(handoffs(), p));
    case "workload": return withMeta(page(byName(LOAD, p).filter((l) => !text(p, "location") || l.locationId === text(p, "location")).filter((l) => p.only !== "flagged" || l.level === "over" || l.level === "under" || l.waiting >= 9).sort((a, b) => (b.level === "over" ? 1 : 0) - (a.level === "over" ? 1 : 0) || b.waiting - a.waiting), p));
    case "nextlead": return withMeta(nextlead(p));
    case "leaderboard": return withMeta(board(p));
    case "money": return withMeta(money(p));
    case "coaching": return withMeta(page(byName(PEOPLE.filter((x) => x.role === "staff").map(coach), p), p));
    case "access": return withMeta(text(p, "by") === "account" ? { ...page(byName(accessA(), p), p), by: "account" } : { ...page(byName(accessP(), p), p), by: "person" });
    case "proof": return withMeta(proof(p));
    case "person": return withMeta(panel(p));
    case "list": return withMeta(page(list(p), p, 20));
  }
}
