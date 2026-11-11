import { decisionsOf, delta, funnelOf, lostToNoShows, paceOf, peopleOf, showRate, closeRate, slotsOf, DOW, type Cell, type Tot } from "@/lib/analytics/appointments-exec-intel";

// Sample data for ?apxfx. Clearly labelled on screen ("Sample data"). Never mixed with real numbers: the tab reads either the server or these, never both.
export const apxFixtureOn = (): boolean => { try { return typeof window !== "undefined" && /[?&]apxfx\b/.test(window.location.href + (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.name); } catch { return false; } };

const t = (o: Partial<Tot>): Tot => ({ booked: 0, confirmed: 0, showed: 0, noshow: 0, cancelled: 0, unmarked: 0, rescheduled: 0, won: 0, wonValue: 0, lost: 0, ltbSumMin: 0, ltbN: 0, b2mSumHours: 0, b2mN: 0, ...o });
const cur = t({ booked: 212, confirmed: 140, showed: 126, noshow: 31, cancelled: 22, unmarked: 9, rescheduled: 18, won: 34, wonValue: 61200, lost: 40, ltbSumMin: 41 * 150, ltbN: 150, b2mSumHours: 52 * 190, b2mN: 190 });
const prev = t({ booked: 186, confirmed: 110, showed: 104, noshow: 40, cancelled: 25, unmarked: 6, rescheduled: 20, won: 27, wonValue: 47000, lost: 38, ltbSumMin: 58 * 130, ltbN: 130, b2mSumHours: 58 * 160, b2mN: 160 });
const sp = (a: number[]) => a;
const mk = (key: string, label: string, display: string, v: number | null, p: number | null, kind: "count" | "rate", good: "up" | "down", open: Record<string, string> | null, spark: number[]) =>
  ({ key, label, value: v, display, prev: p, year: null, deltaPrev: delta(v, p, kind), deltaYear: delta(null, null, kind), spark, open, note: null, estimate: false, formula: null, good });
const lost = lostToNoShows(cur);
const funnel = funnelOf(cur);
const kpis = [
  mk("booked", "Appointments booked", "count", 212, 186, "count", "up", { bucket: "booked" }, sp([12, 15, 14, 18, 16, 19, 22, 20, 24, 22, 25, 23, 21, 26])),
  mk("showed", "Showed", "count", 126, 104, "count", "up", { bucket: "showed" }, sp([8, 9, 10, 11, 10, 12, 13, 12, 14, 13, 15, 14, 13, 15])),
  mk("show_rate", "Show rate", "percent", showRate(cur).value, showRate(prev).value, "rate", "up", { bucket: "completed" }, sp([0.6, 0.62, 0.64, 0.63, 0.66, 0.68, 0.7, 0.69, 0.71, 0.72, 0.7, 0.73, 0.74, 0.76])),
  mk("noshow_rate", "No-show rate", "percent", 31 / 166, 40 / 150, "rate", "down", { bucket: "noshow" }, sp([0.3, 0.28, 0.27, 0.26, 0.25, 0.24, 0.22, 0.21, 0.2, 0.2, 0.19, 0.19, 0.18, 0.18])),
  mk("cancel_rate", "Cancelled", "percent", 22 / 212, 25 / 186, "rate", "down", { bucket: "cancelled" }, sp([0.12, 0.1, 0.11, 0.1, 0.1, 0.09, 0.1, 0.11, 0.1, 0.1, 0.1, 0.09, 0.1, 0.1])),
  mk("resched_rate", "Rescheduled", "percent", 18 / 212, 20 / 186, "rate", "down", { bucket: "rescheduled" }, sp([0.1, 0.09, 0.09, 0.08, 0.09, 0.08, 0.08, 0.09, 0.08, 0.09, 0.08, 0.08, 0.09, 0.08])),
  mk("ltb", "Lead to booking", "minutes", 41, 58, "count", "down", null, sp([70, 66, 60, 58, 55, 52, 50, 47, 45, 44, 43, 42, 41, 41])),
  mk("b2m", "Booking to meeting", "hours", 52, 58, "count", "down", null, sp([60, 58, 59, 57, 56, 55, 54, 55, 53, 53, 52, 52, 52, 52])),
  mk("won", "Won from appointments", "count", 34, 27, "count", "up", { bucket: "won" }, sp([1, 2, 2, 3, 2, 3, 3, 2, 3, 3, 4, 3, 4, 3])),
  mk("won_value", "Won deal value", "money", 61200, 47000, "count", "up", { bucket: "won" }, sp([3, 4, 4, 5, 4, 5, 5, 4, 6, 5, 6, 6, 5, 7])),
  { key: "lost_noshow", label: "Revenue lost to no-shows", value: lost.value, display: "money", prev: null, year: null, deltaPrev: delta(null, null, "count"), deltaYear: delta(null, null, "count"), spark: [], open: { bucket: "noshow" }, note: null, estimate: true, formula: lost.formula, good: "down" },
];
const summary = {
  headline: `212 booked, 76% showed, up 14% on the previous period, show rate improved 6 points. ${funnel.leak?.sentence ?? ""}`, kpis, funnel, avgDeal: 1800, closeRate: closeRate(cur), showToClose: { value: 34 / 126, n: 34, of: 126, enough: true }, yearNote: "No data for the same period last year.",
  historyStarts: "2026-08-04", live: false, period: { from: "2026-10-12", to: "2026-11-10" }, previous: { from: "2026-09-12", to: "2026-10-11" }, totals: { cur, prev, year: t({}) }, accountsCount: 6,
};
const cells: Cell[] = [];
for (const dow of [1, 2, 3, 4, 5]) for (let h = 8; h <= 17; h++) { const n = 10 + ((dow * 7 + h * 3) % 14), rate = 0.82 - ((dow === 5 ? 0.25 : 0) + (h === 17 ? 0.22 : 0) + (h === 8 ? 0.1 : 0)); cells.push({ dow, hour: h, booked: n, showed: Math.round(n * rate), noshow: n - Math.round(n * rate), unmarked: 0 }); }
const sl = slotsOf(cells);
const pace = paceOf([{ weekStart: "2026-09-14", booked: 44 }, { weekStart: "2026-09-21", booked: 49 }, { weekStart: "2026-09-28", booked: 51 }, { weekStart: "2026-10-05", booked: 47 }, { weekStart: "2026-10-12", booked: 52 }, { weekStart: "2026-10-19", booked: 55 }, { weekStart: "2026-10-26", booked: 50 }, { weekStart: "2026-11-02", booked: 53 }, { weekStart: "2026-11-09", booked: 14 }], 78, Date.parse("2026-11-11T12:00:00Z"), 240);
const nm = (id: string | null) => ({ a: "Amara O.", b: "Daniel K.", c: "Ngozi E.", d: "Tobi A." }[id ?? ""] ?? "Not recorded");
const agg = (id: string, source: string, o: Partial<Tot>) => ({ id, source, t: t(o) });
const aggs = [agg("a", "Facebook", { booked: 60, showed: 38, noshow: 8, won: 10, lost: 6 }), agg("b", "Facebook", { booked: 50, showed: 22, noshow: 22, won: 3, lost: 8 }), agg("c", "Google", { booked: 44, showed: 34, noshow: 6, won: 12, lost: 5 }), agg("d", "Google", { booked: 30, showed: 22, noshow: 6, won: 6, lost: 4 })];
const people = peopleOf(aggs, aggs.map((a) => ({ ...a, t: { ...a.t, showed: Math.max(0, a.t.showed - 3), noshow: a.t.noshow + 3 } })), nm);
const boards = {
  setters: people, closers: people.map((p) => ({ ...p })), movers: { setters: { up: [], down: [] }, closers: { up: [], down: [] } }, fairness: true,
  calendars: [{ id: "c1", name: "Strategy call", booked: 120, showRate: showRate(t({ booked: 120, showed: 80, noshow: 20 })), closeRate: closeRate(t({})), won: 20, wonValue: 36000, noshow: 20, t: t({ booked: 120, showed: 80, noshow: 20 }) }, { id: "c2", name: "Quick intro", booked: 92, showRate: showRate(t({ booked: 92, showed: 46, noshow: 31 })), closeRate: closeRate(t({})), won: 14, wonValue: 25200, noshow: 31, t: t({ booked: 92, showed: 46, noshow: 31 }) }],
  sources: [{ id: "Facebook", name: "Facebook", booked: 110, showRate: showRate(t({ booked: 110, showed: 60, noshow: 30 })), closeRate: closeRate(t({})), won: 13, wonValue: 23400, noshow: 30, t: t({ booked: 110, showed: 60, noshow: 30 }) }, { id: "Google", name: "Google", booked: 74, showRate: showRate(t({ booked: 74, showed: 56, noshow: 12 })), closeRate: closeRate(t({})), won: 18, wonValue: 32400, noshow: 12, t: t({ booked: 74, showed: 56, noshow: 12 }) }],
  accounts: [{ id: "x1", name: "Northside Dental", booked: 80, showRate: showRate(t({ booked: 80, showed: 50, noshow: 15 })), closeRate: closeRate(t({})), won: 12, wonValue: 21600, noshow: 15, movePoints: -11, prev: t({ booked: 70, showed: 50, noshow: 8 }), t: t({ booked: 80, showed: 50, noshow: 15 }) }],
};
const decisions = decisionsOf({
  unmarked: 9, showRate: showRate(cur), people, slots: sl, sources: boards.sources.map((s) => ({ source: s.name, t: s.t })), accounts: boards.accounts.map((a) => ({ id: a.id, name: a.name, t: a.t, prev: a.prev })), pace, leak: funnel.leak, calendars: [],
});
const row = (i: number) => ({ appointmentId: `s${i}`, locationId: "x1", accountName: "Northside Dental", contactId: `k${i}`, contactName: ["Chidi N.", "Sarah L.", "Ibrahim M.", "Joy P."][i % 4], url: null, calendarId: "c1", calendarName: "Strategy call",
  startAt: new Date(Date.parse("2026-11-03T14:00:00Z") + i * 86_400_000).toISOString(), endAt: null, status: i % 3 ? "showed" : "noshow", bucket: i % 3 ? "showed" : "noshow", ownerId: null, ownerName: "Daniel K.", bookerId: null, bookerName: "Amara O.", phone: null, source: "Facebook",
  dealStatus: null, dealValue: null, leadToBookedMinutes: 40, firstReplyMinutes: null, hasConflict: false, why: null, dnd: false });
export const FX = {
  summary, decisions: { decisions, brief: "Sample brief" }, pace: { ...pace, targetScope: "", canSetTarget: false, targetUndo: false, narrowed: false }, boards,
  slots: { cells, bands: [{ key: "same_day", label: "Same day", n: 40, rate: 0.82 }, { key: "d1_2", label: "1 to 2 days", n: 70, rate: 0.74 }, { key: "d3_7", label: "3 to 7 days", n: 60, rate: 0.61 }, { key: "d8_plus", label: "8 days or more", n: 30, rate: 0.47 }], ...sl, capacity: { calendars: [], people: [], note: "Compared with each calendar's or person's own busiest week." }, tzNote: "Times are in each client account's own time zone." },
  rows: { rows: Array.from({ length: 8 }, (_, i) => row(i)), total: 8, page: 0, size: 20, pages: 1, truncated: false },
};
void DOW;
