import type {
  Delta, Pp3Access, Pp3AccountRef, Pp3Board, Pp3Coaching, Pp3Envelope, Pp3Handoff, Pp3HandoffRow, Pp3List, Pp3ListRow, Pp3Money, Pp3MoneyRow, Pp3NextLead, Pp3Note, Pp3Options, Pp3Part, Pp3Person, Pp3PersonPanel,
  Pp3Proof, Pp3Ranked, Pp3Role, Pp3Scorecard, Pp3Scorecards, Pp3Today, Pp3TodayLine, Pp3WorkloadRow, Rate,
} from "@/lib/analytics/people3-types";

// SAMPLE DATA ONLY (open Team with ?ppfx=1, ?ppfx=empty or ?ppfx=error). No database, no real people; the screen says "Sample data" whenever this is used.
// Realistic on purpose: about 1 person in 9 is flagged, and the rest are fine. 12 client accounts and 44 people prove the lists page and scale.
export type FxParams = Record<string, string | number | undefined>;
const FIRST = ["Priya", "Marcus", "Elena", "Tomas", "Aisha", "Daniel", "Grace", "Hiro", "Lena", "Omar", "Sofia", "Victor", "Nia", "Caleb", "Ruth", "Ibrahim", "Maya", "Felix", "Zara", "Jonah", "Clara"];
const LAST = ["Shah", "Reed", "Costa", "Novak", "Bello", "Hart", "Okoye", "Tanaka", "Weber", "Haddad", "Rossi", "Lund", "Mensah", "Ellis", "Park", "Silva"];
const ACCT = ["Northside Roofing", "Bright Smiles Dental", "Lakeview Realty", "Harbor Med Spa", "Summit Solar", "Cedar Coaching", "Ironwood HVAC", "Maple Family Law", "Oak Street Dental", "Redline Auto", "Blue Fern Spa", "Granite Homes"];
export const ACCOUNTS: Pp3AccountRef[] = ACCT.map((name, i) => ({ locationId: `loc${i}`, name }));
const rnd = (i: number, k: number) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
const NOW = Date.parse("2026-11-11T08:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const rate = (n: number, of: number, min = 20): Rate => ({ value: of >= min ? n / of : null, n, of, enough: of >= min });
const N = 44;
const PERIOD = { from: "2026-10-14", to: "2026-11-11", days: 28 };
const HISTORY = "2026-09-14";

type Raw = { p: Pp3Person; sc: Pp3Scorecard; accts: number[]; staff: boolean; setter: boolean; idle: boolean };
const RAW: Raw[] = Array.from({ length: N }, (_, i) => {
  const r = (k: number) => rnd(i, k);
  const admin = i < 3, role: Pp3Role = admin ? "agency_admin" : "agency_staff";
  const accts = admin ? ACCOUNTS.map((_, k) => k) : [...new Set([i % 12, ...(i % 3 === 0 ? [(i + 5) % 12] : [])])];
  const unnamed = i >= N - 2, fresh = i % 11 === 10, idle = !admin && i % 9 === 4;
  const name = unnamed ? "Unnamed user" : `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
  const p: Pp3Person = {
    userId: `u${i}`, name, nameState: unnamed ? "unnamed" : "named", initials: unnamed ? "?" : `${name.split(" ")[0][0]}${name.split(" ")[1][0]}`, photoUrl: null, role, isAdmin: admin,
    allAccounts: admin, accountCount: accts.length, accounts: accts.slice(0, 8).map((a) => ACCOUNTS[a]), email: admin ? `${FIRST[i % FIRST.length].toLowerCase()}@team.example` : null, deleted: false,
    firstSeen: "2026-09-14T00:00:00Z", lastSeen: iso(NOW - 3_600_000), lastActivityAt: iso(NOW - (idle ? 31 : 0.3 + r(11) * 6) * 3_600_000), away: i === 17 ? { until: "2026-11-14T00:00:00Z" } : null, isNew: unnamed,
  };
  const leads = fresh ? 8 + Math.floor(r(1) * 10) : 60 + Math.floor(r(1) * 340), inTime = Math.round(leads * (0.55 + r(2) * 0.4)), set = Math.round(leads * (0.1 + r(3) * 0.2)), held = Math.round(set * (0.6 + r(4) * 0.3));
  const wonCount = Math.round(leads * (0.03 + r(5) * 0.08)), enough = !fresh && !unnamed, base = 45 + r(6) * 45;
  const delta = (cur: number, prev: number, ok = true): Delta => ({ current: cur, previous: prev, change: ok && prev > 0 ? (cur - prev) / prev : null, enough: ok && prev >= 5 });
  const sc: Pp3Scorecard = {
    person: p, answeredFirst: delta(leads, Math.round(leads * (0.8 + r(7) * 0.4)), enough), typicalReplySeconds: enough ? Math.round((4 + r(7) * 40) * 60) : null, typicalReplyPrev: enough ? Math.round((5 + r(8) * 40) * 60) : null,
    inTime: rate(inTime, leads), apptsSet: delta(set, Math.round(set * (0.8 + r(8) * 0.4)), set >= 5), apptsSetEstimated: i % 2 === 0 ? Math.round(set * 0.3) : 0, showed: rate(held, set, 8), setShowed: rate(Math.round(held * 0.95), set, 8),
    wonCount, wonValue: delta(wonCount * (1800 + Math.round(r(9) * 3000)), wonCount * 2400, enough), lostCount: Math.round(wonCount * 1.4), touches: { sms: leads * 3, email: leads, call: Math.round(leads * 0.8), other: 4 },
    waiting: 0, accounts: accts.length, enough, historyStarts: HISTORY, spark: [...Array(8)].map((_, k) => Math.round(Math.min(98, base + (rnd(i, 40 + k) - 0.5) * 24))),
  };
  return { p, sc, accts, staff: !admin, setter: i % 3 !== 0, idle };
});

const ENV: Pp3Envelope = { generatedAt: iso(NOW - 600_000), cached: false, canSee: true, flags: {}, problem: null };
export const withEnv = <T,>(x: T): T & Pp3Envelope => ({ ...x, ...ENV });
const text = (p: FxParams, k: string) => String(p[k] ?? "");
const cursor = (p: FxParams) => Math.max(0, Number(p.after ?? 0) || 0);
function page<T>(all: T[], p: FxParams, size = 25) { const at = cursor(p), rows = all.slice(at, at + size); return { rows, total: all.length, size, next: at + size < all.length ? String(at + size) : null, truncated: false }; }
const byName = <T,>(rows: T[], p: FxParams, nameOf: (x: T) => string) => { const q = text(p, "q").toLowerCase(); return q ? rows.filter((x) => nameOf(x).toLowerCase().includes(q)) : rows; };
const inAccount = (r: Raw, p: FxParams) => !text(p, "location") || r.accts.includes(Number(text(p, "location").slice(3)));

// ---- workload (per person per account) ----
const LOAD: Pp3WorkloadRow[] = RAW.filter((x) => x.staff).flatMap((x, n) => x.accts.map((a, k) => {
  const over = (n + a) % 13 === 0, under = !over && (n + a) % 17 === 0, med = 12 + (a % 5) * 2, idle = x.idle && k === 0;
  const waiting = idle ? 9 + (n % 7) : over ? 6 : Math.floor(rnd(n, a + 3) * 3), openDeals = 4 + Math.floor(rnd(n, a + 5) * 14), upcoming = Math.floor(rnd(n, a + 7) * 7);
  const items = over ? Math.round(med * 2.4) : under ? Math.round(med * 0.3) : Math.round(med * (0.75 + rnd(n, a) * 0.5)), stale = Math.floor(openDeals * rnd(n, a + 9) * 0.4);
  return { person: x.p, location: ACCOUNTS[a], waiting, waitingOld: Math.floor(waiting * 0.6), openDeals, openValue: openDeals * 3200, staleDeals: stale, staleValue: stale * 3200, upcoming, needsOutcome: n % 7 === 0 ? 2 : 0, load: over ? "over" : under ? "under" : "normal", loadWhy: over ? `${(items / med).toFixed(1)} times the team’s middle (${items} open items)` : under ? `Only ${items} open items; the team’s middle is ${med}` : null, lastTouchAt: x.p.lastActivityAt, idle: idle ? { hours: 31, waitingLeads: waiting } : null } as Pp3WorkloadRow;
}));

function today(p: FxParams): Pp3Today {
  const mine = p.own === "1";
  const lines: Pp3TodayLine[] = LOAD.filter((l) => l.waiting >= 9).slice(0, 2).map((l) => ({ text: `${l.person.name} has ${l.waiting} leads waiting more than 2 hours in ${l.location.name}`, kind: "waiting" as const, count: l.waiting, userId: l.person.userId, locationId: l.location.locationId, reason: "waiting" as const }));
  const idleOne = LOAD.find((l) => l.idle);
  if (idleOne) lines.push({ text: `No activity recorded in your CRM for ${idleOne.person.name} in 31 hours while leads wait`, kind: "idle", count: 1, userId: idleOne.person.userId, locationId: idleOne.location.locationId, reason: null });
  const first = lines[0];
  return { lines, button: first ? { label: mine ? "Open my queue" : "See the leads", userId: first.userId, locationId: first.locationId, reason: first.reason, count: first.count } : null, people: N, accounts: 12, waitingOld: 31, idleCount: 4, overCount: 5, headline: mine ? "You have 6 leads waiting for a reply." : first ? first.text : "Nobody is waiting on a reply.", historyStarts: HISTORY };
}

function scorecards(p: FxParams): Pp3Scorecards {
  const k = text(p, "sort"), dir = p.dir === "desc" ? -1 : 1;
  const rows = byName(RAW.filter((x) => (p.admins === "1" || x.staff) && inAccount(x, p)), p, (x) => x.p.name).map((x) => ({ ...x.sc, waiting: LOAD.filter((l) => l.person.userId === x.p.userId).reduce((s, l) => s + l.waiting, 0) }));
  const val = (s: Pp3Scorecard): number | string => (k === "won" ? s.wonValue.current : k === "answered" ? s.answeredFirst.current : k === "reply" ? s.typicalReplySeconds ?? 1e9 : k === "in_time" ? s.inTime.value ?? 0 : k === "appts" ? s.apptsSet.current : k === "showed" ? s.showed.value ?? 0 : k === "waiting" ? s.waiting : s.person.name);
  rows.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * (k && k !== "name" && !p.dir ? -1 : dir); });
  return { ...page(rows, p), period: PERIOD, unattributed: { automated: 1240, unknown: 38 }, people: rows.length };
}

function board(p: FxParams): { boards: Pp3Board[]; total: number } {
  const kind = text(p, "role") === "closer" ? "closers" : "setters", loc = text(p, "location");
  const boards = ACCOUNTS.map((a, i) => ({ a, i })).filter(({ a }) => !loc || a.locationId === loc).map(({ a, i }) => {
    const pool = RAW.filter((x) => x.staff && x.accts.includes(i) && (kind === "closers" ? !x.setter : x.setter)).sort((m, n) => (n.sc.inTime.value ?? 0) - (m.sc.inTime.value ?? 0));
    let rank = 0;
    const all: Pp3Ranked[] = pool.map((x) => {
      const ok = x.sc.enough && x.sc.answeredFirst.current >= 20, v = x.sc.inTime.value ?? 0;
      if (ok) rank++;
      const exp = 0.7 + rnd(i, 3) * 0.1, vs = (v - exp) * 100;
      return { rank: ok ? rank : null, person: x.p, n: x.sc.answeredFirst.current, enough: ok, value: kind === "closers" ? rate(x.sc.wonCount, Math.round(x.sc.wonCount * 2.4), 10) : x.sc.inTime, expected: ok ? exp : null, vsMix: ok ? vs : null, why: ok ? `${vs >= 0 ? "Answers" : "Answers"} ${Math.abs(Math.round(vs))} points ${vs >= 0 ? "more" : "fewer"} of their leads in time than the team does on the same sources` : `Not enough data: ${x.sc.answeredFirst.current} leads, needs 20` };
    });
    const ranked = all.filter((x) => x.rank !== null), half = Math.max(1, Math.ceil(ranked.length / 2)), all1 = p.all === "1";
    return { location: a, kind, visibility: all1 ? "all" : "top_half", ranked: ranked.length, shown: all1 ? all : [...ranked.slice(0, half), ...all.filter((x) => x.rank === null)], hidden: all1 ? 0 : Math.max(0, ranked.length - half), you: null, minLeads: 20, minDays: 14, enough: ranked.length > 1, note: pool.length < 2 ? "Only one person works here, so there is no ranking." : null } as Pp3Board;
  }).filter((b) => b.shown.length > 0);
  return { boards, total: boards.length };
}

function money(p: FxParams): Pp3Money {
  const rows: Pp3MoneyRow[] = byName(RAW.filter((x) => (p.admins === "1" || x.staff) && inAccount(x, p)), p, (x) => x.p.name).map((x, i) => {
    const w = LOAD.filter((l) => l.person.userId === x.p.userId), waiting = w.reduce((s, l) => s + l.waiting, 0), stale = w.reduce((s, l) => s + l.staleValue, 0), open = w.reduce((s, l) => s + l.openValue, 0);
    return { person: x.p, location: text(p, "location") ? ACCOUNTS[Number(text(p, "location").slice(3))] : null, wonCount: x.sc.wonCount, wonValue: x.sc.wonValue.current, lostValue: Math.round(x.sc.wonValue.current * 0.6), openValue: open + Math.round(rnd(i, 21) * 9000), staleValue: stale, waitingValue: waiting * 1100, atRiskValue: stale + waiting * 1100, enough: x.sc.enough };
  }).sort((a, b) => b.wonValue - a.wonValue);
  const sum = (f: (r: Pp3MoneyRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  return { ...page(rows, p), period: PERIOD, totals: { wonValue: sum((r) => r.wonValue), openValue: sum((r) => r.openValue), atRiskValue: sum((r) => r.atRiskValue) }, formula: "At risk is the value of open deals that have gone quiet for longer than their stage allows, plus open deals on leads still waiting for a reply, each deal counted once. It is an estimate of what may slip, not money already lost.", isEstimate: true, historyStarts: HISTORY };
}

const notes = (id: string): Pp3Note[] => (Number(id.slice(1)) % 3 === 0 ? [{ id: `n${id}`, userId: id, locationId: null, authorName: "Dana Whitfield", title: "Evening gap", body: "Talked through the evening gap. Agreed to check the inbox at 5pm.", shared: true, createdAt: iso(NOW - 4 * 86_400_000), canDelete: true }] : []);
function coaching(p: FxParams): Pp3Coaching {
  const id = text(p, "user"), x = RAW.find((r) => r.p.userId === id);
  const people = RAW.filter((r) => r.staff).filter((r) => !text(p, "q") || r.p.name.toLowerCase().includes(text(p, "q").toLowerCase())).map((r, i) => ({ person: r.p, lastNoteAt: i % 3 === 0 ? iso(NOW - (2 + i) * 86_400_000) : null }));
  if (!x) return { person: null, oneThing: null, moves: [], notes: [], targets: [], people, historyStarts: HISTORY };
  const k = Number(id.slice(1)) % 4, names = ["How fast the first reply goes out", "Share of replies sent in time", "Appointments set", "Share who show up"];
  return {
    person: x.p, oneThing: x.sc.enough ? { metric: ["reply_minutes", "in_time_pct", "appts_per_week", "show_pct"][k], line: `Work on ${names[k].toLowerCase()}.`, evidence: "It is lower than their own number over the four weeks before." } : null,
    moves: x.sc.enough ? [{ metric: "reply_minutes", label: "First reply", current: 8, previous: 11, unit: "minutes", better: true, line: "First reply went from 11 min to 8 min" }, { metric: "show_pct", label: "Showed up", current: 71, previous: 75, unit: "pct", better: false, line: "Showed up went from 75% to 71%" }] : [],
    notes: notes(id), targets: [{ userId: id, locationId: null, metric: "reply_minutes", value: 10, label: "First reply under 10 min" }, { userId: id, locationId: null, metric: "in_time_share", value: 85, label: "Replied in time 85%" }], people: [], historyStarts: HISTORY,
  };
}

function access(p: FxParams): Pp3Access {
  const rows = byName(RAW, p, (x) => x.p.name).map((x, i) => ({ person: x.p, verified: x.staff ? i % 6 !== 5 : null, flags: [...(i === 31 ? ["no_account" as const] : []), ...(x.p.isNew ? ["new" as const] : [])] }));
  const accounts = ACCOUNTS.map((a, i) => ({ ...a, people: RAW.filter((x) => x.staff && x.accts.includes(i)).length }));
  return {
    ...page(rows, p), accounts, newPeople: 2, deletedPeople: 0, needsPermission: [ACCOUNTS[9]],
    risks: [{ location: ACCOUNTS[7], kind: "single_point", person: { userId: "u7", name: RAW[7].p.name }, sharePct: 88, line: `${RAW[7].p.name} sends 88% of the replies in ${ACCT[7]}. If they are away, nobody else is answering.` }],
  };
}

function proof(p: FxParams): Pp3Proof {
  const i = Math.max(0, ACCOUNTS.findIndex((a) => a.locationId === text(p, "location"))), ps = RAW.filter((x) => x.staff && x.accts.includes(i)), set = 22 + i, held = Math.round(set * 0.74);
  return {
    location: ACCOUNTS[i], period: { from: "2026-11-02", to: "2026-11-08", days: 7 }, leads: 101, answered: 94, answeredPct: rate(94, 101), typicalReplyMinutes: 8.2, targetMinutes: 10, inTime: rate(86, 101), appointments: set, showed: held, noShow: set - held, showedPct: rate(held, set),
    staff: p.named === "1" ? ps.slice(0, 3).map((x) => ({ name: x.p.name, answered: 20 + Math.round(rnd(i, 9) * 30), typicalReplyMinutes: x.sc.typicalReplySeconds ? x.sc.typicalReplySeconds / 60 : null })) : null, naming: p.named === "1" ? "named" : "team",
    lines: ["Your team answered 94 of 101 new leads this week, half of them within 8 minutes.", `${held} of ${set} booked appointments were attended.`], historyStarts: HISTORY, generatedAt: iso(NOW),
  };
}

function panel(p: FxParams): Pp3PersonPanel {
  const idx = Math.max(0, RAW.findIndex((r) => r.p.userId === text(p, "user"))), x = RAW[idx], first = x.p.name.split(" ")[0], staff = RAW.filter((r) => r.staff);
  const at = staff.findIndex((r) => r === x), g = (k: number, lo: number, hi: number) => [...Array(8)].map((_, w) => Math.round(lo + rnd(idx + 3, k * 10 + w) * (hi - lo)));
  const resp = g(1, 5, 30), appts = g(2, 2, 14), showed = g(3, 50, 95), won = g(4, 0, 6), wl = LOAD.filter((l) => l.person.userId === x.p.userId);
  return {
    person: x.p, headline: x.sc.enough ? `${first} replies to ${Math.round((x.sc.inTime.value ?? 0) * 100)}% of new leads in time and has set ${x.sc.apptsSet.current} appointments this period.` : `${first} has handled ${x.sc.answeredFirst.current} leads. Not enough data to say more yet.`,
    weeks: [...Array(8)].map((_, w) => ({ start: iso(NOW - (7 - w) * 7 * 86_400_000).slice(0, 10), answeredFirst: 20 + w, typicalReplySeconds: resp[w] * 60, inTimePct: showed[w] + 3, apptsSet: appts[w], showedPct: showed[w], wonValue: won[w] * 3200 })),
    accounts: x.accts.slice(0, 5).map((a) => { const l = wl.find((m) => m.location.locationId === `loc${a}`); return { location: ACCOUNTS[a], role: x.p.role, waiting: l?.waiting ?? 0, waitingOld: l?.waitingOld ?? 0, openDeals: l?.openDeals ?? 0, openValue: l?.openValue ?? 0, staleDeals: l?.staleDeals ?? 0, upcoming: l?.upcoming ?? 0, needsOutcome: l?.needsOutcome ?? 0, lastTouchAt: x.p.lastActivityAt, load: l?.load ?? "normal" }; }),
    scorecard: x.sc, workloadTrend: [...Array(8)].map((_, w) => ({ day: iso(NOW - (7 - w) * 7 * 86_400_000).slice(0, 10), open: 8 + Math.round(rnd(idx, 70 + w) * 10) })), nextLeadEligible: x.staff && x.sc.enough, openInCrmUrl: null,
    prev: at > 0 ? staff[at - 1].p.userId : null, next: at >= 0 && at < staff.length - 1 ? staff[at + 1].p.userId : null, historyStarts: HISTORY,
  };
}

function list(p: FxParams): Pp3List {
  const n = Number(p.expect ?? 8), reason = (text(p, "reason") || "waiting") as Pp3List["reason"], acct = text(p, "location") ? ACCT[Number(text(p, "location").slice(3))] : ACCT[0];
  const kind = reason === "stale_deals" || reason === "open_deals" ? "deal" : reason === "upcoming" || reason === "needs_outcome" ? "appointment" : "lead";
  const rows: Pp3ListRow[] = Array.from({ length: n }, (_, i) => ({ id: `r${i}`, contactId: null, kind, title: `${FIRST[(i * 3) % FIRST.length]} ${LAST[(i * 5) % LAST.length]}`, locationId: "loc0", locationName: acct, ageHours: 3 + i * 2, value: kind === "deal" ? 1500 + i * 120 : null, at: iso(NOW - (3 + i * 2) * 3_600_000), url: null }));
  const labels: Record<string, string> = { waiting: "Waiting for a reply", waiting_old: "Waiting over 2 hours", stale_deals: "Quiet deals", open_deals: "Open deals", needs_outcome: "Appointments with no outcome", upcoming: "Appointments coming", no_owner: "No owner" };
  return { ...page(rows, p, 20), reason, label: labels[reason] ?? reason };
}
const handoff = (p: FxParams): Pp3Handoff => {
  const rows: Pp3HandoffRow[] = Array.from({ length: 18 }, (_, i) => ({ setter: { userId: `u${3 + (i % 20)}`, name: RAW[3 + (i % 20)].p.name }, closer: { userId: `u${4 + ((i * 3) % 20)}`, name: RAW[4 + ((i * 3) % 20)].p.name }, deals: 2 + (i % 6), wonValue: 4000 + i * 900, medianDays: 2 + (i % 9), location: ACCOUNTS[i % 12] }));
  return { ...page(rows, p), period: PERIOD, windowDays: 60, note: "Booked by is the person the CRM records on the appointment. Where it records nobody, we use the last person who messaged or called the lead before the booking, which is an estimate." };
};
const nextlead = (p: FxParams): Pp3NextLead => {
  const i = Math.max(0, ACCOUNTS.findIndex((a) => a.locationId === text(p, "location"))), ls = LOAD.filter((l) => l.location.locationId === `loc${i}` && l.load !== "over" && l.person.nameState === "named").sort((a, b) => a.waiting - b.waiting);
  const best = ls[0];
  return {
    location: ACCOUNTS[i], source: null, isEstimate: true,
    suggestion: best ? { userId: best.person.userId, name: best.person.name, reasons: [`Fewest leads waiting right now (${best.waiting})`, "Answers this source fastest: about 9 min"], sample: 120 + i * 9 } : null, hidden: best ? null : "not_enough_data",
    considered: ls.slice(0, 5).map((l, k) => ({ userId: l.person.userId, name: l.person.name, waiting: l.waiting, answersSourceMinutes: 9 + k * 4, sample: 90 + k * 11, away: l.person.away !== null })),
  };
};
const options = (): Pp3Options => ({ viewer: { level: "all", userId: null, canSeeEmail: true, canRankAll: true }, accounts: ACCOUNTS, minLeads: 20, minDays: 14, idleHours: 4, usersState: "ok" });

const EMPTY = { rows: [], total: 0, size: 25, next: null, truncated: false };
/** One answer in the shape of the real part. `empty` returns the empty state of each part. */
export function sample(part: Pp3Part, p: FxParams, empty: boolean): unknown {
  if (empty && part !== "options") {
    switch (part) {
      case "today": return withEnv({ lines: [], button: null, people: 0, accounts: 0, waitingOld: 0, idleCount: 0, overCount: 0, headline: "", historyStarts: null });
      case "leaderboard": return withEnv({ period: PERIOD, boards: [], page: { total: 0, next: null }, minLeads: 20, minDays: 14, historyStarts: null });
      case "money": return withEnv({ ...EMPTY, period: PERIOD, totals: { wonValue: 0, openValue: 0, atRiskValue: 0 }, formula: "", isEstimate: true, historyStarts: null });
      case "coaching": return withEnv({ person: null, oneThing: null, moves: [], notes: [], targets: [], people: [], historyStarts: null });
      case "access": return withEnv({ ...EMPTY, risks: [], needsPermission: [], newPeople: 0, deletedPeople: 0, accounts: [] });
      case "proof": return withEnv({ location: null, period: PERIOD, leads: 0, answered: 0, answeredPct: rate(0, 0), typicalReplyMinutes: null, targetMinutes: null, inTime: rate(0, 0), appointments: 0, showed: 0, noShow: 0, showedPct: rate(0, 0), staff: null, naming: "team", lines: [], historyStarts: null, generatedAt: iso(NOW) });
      case "nextlead": return withEnv({ location: null, source: null, isEstimate: true, suggestion: null, hidden: "no_account", considered: [] });
      case "person": return withEnv({ person: null });
      case "scorecards": return withEnv({ ...EMPTY, period: PERIOD, unattributed: { automated: 0, unknown: 0 }, people: 0 });
      case "workload": return withEnv({ ...EMPTY, medianOpen: null, over: 0, under: 0, idleCount: 0, idleHours: 4, historyStarts: null });
      default: return withEnv(EMPTY);
    }
  }
  switch (part) {
    case "options": return withEnv(options());
    case "today": return withEnv(today(p));
    case "scorecards": return withEnv(scorecards(p));
    case "handoff": return withEnv(handoff(p));
    case "workload": {
      const rows = byName(LOAD, p, (l) => l.person.name).filter((l) => !text(p, "location") || l.location.locationId === text(p, "location")).sort((a, b) => (text(p, "sort") === "name" ? a.person.name.localeCompare(b.person.name) : (b.load === "over" ? 1 : 0) - (a.load === "over" ? 1 : 0) || b.waiting - a.waiting));
      return withEnv({ ...page(rows, p), medianOpen: 14, over: LOAD.filter((l) => l.load === "over").length, under: LOAD.filter((l) => l.load === "under").length, idleCount: 4, idleHours: 4, historyStarts: HISTORY });
    }
    case "nextlead": return withEnv(nextlead(p));
    case "leaderboard": { const b = board(p); return withEnv({ period: PERIOD, boards: b.boards.slice(cursor(p), cursor(p) + 6), page: { total: b.total, next: cursor(p) + 6 < b.total ? String(cursor(p) + 6) : null }, minLeads: 20, minDays: 14, historyStarts: HISTORY }); }
    case "money": return withEnv(money(p));
    case "coaching": return withEnv(coaching(p));
    case "access": return withEnv(access(p));
    case "proof": return withEnv(proof(p));
    case "person": return withEnv(panel(p));
    case "list": return withEnv(list(p));
    default: return withEnv({});
  }
}
