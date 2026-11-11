import { ratesFromOutcomes } from "@/lib/design/appt-flow-layout";
import type { ApConflictRow, ApFlowCloser, ApFlowSetter, ApFlowTree, ApHealthRow, ApOutcome, ApOverview, ApPage, ApPersonRow, ApProof, ApReminderRow, ApRow, ApSourceRow, ApSpeedBand } from "./types";

// Small typed fixtures (a few dozen rows, no database). They show every state of the screens until the API is merged; open any Appointments address with ?apfx=1 to use them.
const MIN = 5;
const oc = (o: Partial<Record<ApOutcome, number>>): Record<ApOutcome, number> => ({ won: 0, lost: 0, showed: 0, noshow: 0, cancelled: 0, unmarked: 0, ...o });
const closer = (id: string, name: string, o: Partial<Record<ApOutcome, number>>, lead = 5): ApFlowCloser => {
  const outcomes = oc(o); const bookings = Object.values(outcomes).reduce((a, b) => a + b, 0);
  return { id, name, outcomes, bookings, ...ratesFromOutcomes(outcomes, MIN), revenueCents: outcomes.won * 240_000, avgLeadToBookedHours: lead };
};
const setter = (id: string, name: string, closers: ApFlowCloser[], hidden = 0): ApFlowSetter => {
  const bookings = closers.reduce((a, c) => a + c.bookings, 0);
  const sum = oc({}); for (const c of closers) for (const k of Object.keys(sum) as ApOutcome[]) sum[k] += c.outcomes[k];
  return { id, name, closers, hiddenClosers: hidden, bookings, ...ratesFromOutcomes(sum, MIN), revenueCents: closers.reduce((a, c) => a + c.revenueCents, 0), avgLeadToBookedHours: 4.5 };
};

const setters: ApFlowSetter[] = [
  setter("u-ada", "Ada Okafor", [closer("u-dan", "Dan Reyes", { won: 14, showed: 9, lost: 6, noshow: 3, unmarked: 2, cancelled: 2 }), closer("u-mia", "Mia Chen", { won: 9, showed: 6, lost: 5, noshow: 4, cancelled: 1, unmarked: 1 })]),
  setter("u-ben", "Ben Hart", [closer("u-dan", "Dan Reyes", { won: 5, showed: 4, lost: 5, noshow: 16, unmarked: 4, cancelled: 2 }), closer("u-sol", "Sol Ibe", { won: 8, showed: 7, lost: 4, noshow: 5, unmarked: 3, cancelled: 1 })]),
  setter("u-cy", "Cy Mensah", [closer("u-mia", "Mia Chen", { won: 11, showed: 5, lost: 3, noshow: 2, unmarked: 1, cancelled: 1 }), closer("u-sol", "Sol Ibe", { won: 3, showed: 2, lost: 2, noshow: 2 })]),
  setter("u-eve", "Eve Park", [closer("u-dan", "Dan Reyes", { won: 2, showed: 2, lost: 1, noshow: 1 })]),
];
const totals = oc({}); for (const s of setters) for (const c of s.closers) for (const k of Object.keys(totals) as ApOutcome[]) totals[k] += c.outcomes[k];
const rt = ratesFromOutcomes(totals, MIN);

export const FLOW_FIXTURE: ApFlowTree = {
  booked: setters.reduce((a, s) => a + s.bookings, 0), periodLabel: "Last 30 days", setters, hiddenSetters: 0, totals, overall: rt, minBookings: MIN,
};
export const FLOW_EMPTY: ApFlowTree = { booked: 0, periodLabel: "Last 30 days", setters: [], hiddenSetters: 0, totals: oc({}), overall: { showRate: null, noShowRate: null, closeRate: null }, minBookings: MIN };

export const OVERVIEW_FIXTURE: ApOverview = {
  headline: { needsOutcome: 23, noShowsToRecover: 17, reportedShowRate: 0.88, trueShowRate: 0.71, trueRange: [0.66, 0.79], marked: 212, booked: 241 },
  revenueAtRisk: { lowCents: 4_800_000, highCents: 9_600_000, basis: "No-shows and appointments with no outcome, times the average won deal of the last 90 days, times the share of those leads that closed after a rebook (4% to 8%)." },
  journey: [{ key: "booked", label: "Booked", count: 241 }, { key: "showed", label: "Showed", count: 150 }, { key: "won", label: "Won", count: 52 }],
  cards: { worstAccount: { id: "L-2", name: "Brightside Dental", noShowRate: 0.34 }, topSetter: { id: "u-cy", name: "Cy Mensah", showRate: 0.9 }, leak: "16 no-shows when Ben Hart hands to Dan Reyes: 57% against 24% across everyone." },
  needsPermission: false,
};

const NAMES = ["Tola Adams", "Rae Singh", "Kofi Boateng", "Lena Voss", "Jo Park", "Maya Cole", "Sam Ortiz", "Ivy Tran", "Noor Ali", "Chidi Eze"];
const ACCTS = [["L-1", "Glow Med Spa"], ["L-2", "Brightside Dental"], ["L-3", "Sunrise Solar"]];
export function rowsFixture(n: number, kind: "needs" | "recover" | "all" = "all"): ApRow[] {
  return Array.from({ length: n }, (_, i) => {
    const [lid, an] = ACCTS[i % 3]; const owner = ["Dan Reyes", "Mia Chen", "Sol Ibe", null][i % 4]; const booker = ["Ada Okafor", "Ben Hart", "Cy Mensah", "Eve Park"][i % 4];
    return {
      id: `fx-${kind}-${i}`, locationId: lid, accountName: an, contactId: `fc-${i}`, contactName: NAMES[i % NAMES.length], startAt: new Date(Date.UTC(2026, 10, 10 - (i % 9), 9 + (i % 7), 0)).toISOString(), calendarName: ["Consult", "Strategy call", "Discovery"][i % 3],
      status: kind === "recover" ? "noshow" : kind === "needs" ? "booked" : (["booked", "confirmed", "showed", "noshow", "cancelled"] as const)[i % 5], ownerId: owner ? `o${i % 4}` : null, ownerName: owner, bookerId: `b${i % 4}`, bookerName: booker,
      source: ["Facebook ad", "Google", "Referral", "Website form"][i % 4], dealValueCents: i % 3 === 0 ? 120_000 + i * 15_000 : null, dealStatus: (["open", "none", "won", "lost"] as const)[i % 4], hoursPast: kind === "all" ? null : 6 + i * 5,
      flags: i % 6 === 0 ? ["double-booked"] : i % 5 === 0 ? ["no-deal"] : [],
    };
  });
}
export const page = <T,>(rows: T[], total = rows.length, p = 1, size = 20): ApPage<T> => ({ total, page: p, pageSize: size, rows });

export const PEOPLE_FIXTURE: ApPersonRow[] = [
  ...setters.map((s, i) => ({ id: s.id, name: s.name, role: "setter" as const, bookings: s.bookings, showRate: s.showRate, noShowRate: s.noShowRate, closeRate: s.closeRate, revenueCents: s.revenueCents, avgLeadToBookedHours: s.avgLeadToBookedHours, trend: [60, 64, 58, 70, 66 + i, 72].map((v) => v / 100) })),
  { id: "u-none", name: "Nobody assigned", role: "closer", unassigned: true, bookings: 9, showRate: 0.55, noShowRate: 0.45, closeRate: 0.1, revenueCents: 0, avgLeadToBookedHours: null, trend: [] },
];
export const HEALTH_FIXTURE: ApHealthRow[] = [
  { locationId: "L-2", name: "Brightside Dental", booked: 74, showRate: 0.58, noShowRate: 0.34, cancelRate: 0.12, unmarked: 14, rescheduleRate: 0.1 },
  { locationId: "L-3", name: "Sunrise Solar", booked: 96, showRate: 0.72, noShowRate: 0.2, cancelRate: 0.09, unmarked: 6, rescheduleRate: 0.07 },
  { locationId: "L-1", name: "Glow Med Spa", booked: 71, showRate: 0.86, noShowRate: 0.08, cancelRate: 0.05, unmarked: 3, rescheduleRate: 0.04 },
  { locationId: "L-4", name: "Hartley Realty", booked: 3, showRate: null, noShowRate: null, cancelRate: null, unmarked: 1, rescheduleRate: null },
];
export const SOURCES_FIXTURE: ApSourceRow[] = [
  { source: "Referral", booked: 48, showRate: 0.89, medianFirstReplyMinutes: 12, won: 19 }, { source: "Google", booked: 80, showRate: 0.74, medianFirstReplyMinutes: 31, won: 21 },
  { source: "Facebook ad", booked: 92, showRate: 0.61, medianFirstReplyMinutes: 140, won: 11 }, { source: "Website form", booked: 21, showRate: null, medianFirstReplyMinutes: 55, won: 1 },
];
export const SPEED_FIXTURE: ApSpeedBand[] = [{ label: "Under 5 min", booked: 61, showRate: 0.87 }, { label: "5 to 30 min", booked: 70, showRate: 0.77 }, { label: "30 min to 4 hours", booked: 58, showRate: 0.66 }, { label: "Over 4 hours", booked: 33, showRate: 0.49 }];
export const CONFLICTS_FIXTURE: ApConflictRow[] = [
  { id: "cf1", kind: "double-booking", accountName: "Brightside Dental", calendarName: "Consult", when: "2026-11-12T10:00:00Z", people: ["Mia Chen"], note: "Two appointments at the same time for Mia Chen." },
  { id: "cf2", kind: "forced-overlap", accountName: "Sunrise Solar", calendarName: "Strategy call", when: "2026-11-13T15:30:00Z", people: ["Dan Reyes"], note: "A booking was forced into a busy slot." },
  { id: "cf3", kind: "disconnected", accountName: "Glow Med Spa", calendarName: "Discovery", when: null, people: ["Sol Ibe"], note: "This calendar stopped syncing 3 days ago." },
];
export const PROOF_FIXTURE: ApProof[] = [
  { weekOf: "2026-11-02", accountName: "Glow Med Spa", booked: 19, showed: 16, recovered: 3, stillUnmarked: 1, trueShowRate: 0.86, caught: 5, fixed: 4 },
  { weekOf: "2026-11-02", accountName: "Brightside Dental", booked: 17, showed: 10, recovered: 2, stillUnmarked: 5, trueShowRate: 0.58, caught: 9, fixed: 4 },
];
