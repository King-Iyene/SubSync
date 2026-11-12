import { biggestLeak, FORMULA, forecastOf, headlineOf, leakDollars, leakFinder, spanText, stepRows, ZERO, type CohortRow, type EntityLeak, type Forecast, type Leak, type StepRow, type Tot } from "@/lib/analytics/bf-core";

// The shapes the booking funnel API returns, and sample data (only behind ?bffx, always labelled "Sample data") built with the very same rules as the server.

export type SummaryRes = {
  period: { from: string; to: string }; steps: StepRow[]; headline: string; hot: string | null; leak: (Leak & { dollars: number | null; formula: string }) | null; avgDeal: number | null; won: number; wonValue: number; lost: number;
  times: Array<{ key: string; label: string; secs: number | null; text: string }>; timesNote: string | null; live: boolean; historyStarts: string | null; problem: string | null; canSeeAccounts: boolean; canSeePeople: boolean;
};
export type BreakdownRow = { id: string; name: string; steps: StepRow[]; leak: Leak | null };
export type BreakdownRes = { by: string; rows: BreakdownRow[]; live?: boolean };
export type LeaksRes = { accounts: EntityLeak[]; setters: EntityLeak[]; closers: EntityLeak[] };
export type CohortsRes = { rows: CohortRow[]; live: boolean; historyStarts: string | null };
export type ForecastRes = Forecast & { historyStarts: string | null };
export type OptionsRes = { forms: Array<{ id: string; name: string }> };
export type LeadRowT = { contactId: string; locationId: string; locationName: string | null; name: string; email: string | null; phone: string | null; owner: string | null; source: string | null; createdAt: string | null; dnd: boolean; depth: number; won: boolean; url?: string | null };
export type RowsRes = { rows: LeadRowT[]; next: string | null; total: { n: number; capped: boolean } | null; label: string };
export type RecoverPreview = { requested: number; cap: number; capped: boolean; protectedSkipped: number; sample: string[]; phrase: string; mode: "dry_run" | "live"; modeWords: string; warning: string };
export type RecoverDone = { mode: "dry_run" | "live"; requested: number; done: number; failed: number; protectedSkipped: number; needsPermission: boolean; message: string };

export const bffxOn = (): boolean => { try { return typeof window !== "undefined" && /[?&]bffx\b/.test(window.location.search); } catch { return false; } };

const t = (o: Partial<Tot>): Tot => ({ ...ZERO, ...o });
const TOT = t({ leads: 1240, answered: 980, booked: 520, showed: 307, deal: 171, won: 88, wonValue: 176_000, lost: 22, tTouchSecs: 900 * 800, tTouchN: 800, mature7: 1100, mature14: 900, mature30: 600, booked7: 380, booked14: 410, booked30: 420, showed7: 200, showed14: 224, showed30: 232, won7: 30, won14: 44, won30: 56 });
const ACCOUNTS: Array<[string, string, Partial<Tot>]> = [
  ["a1", "Bright Smile Dental", { leads: 410, answered: 360, booked: 210, showed: 150, deal: 90, won: 50, wonValue: 125_000 }],
  ["a2", "Peak Roofing", { leads: 330, answered: 230, booked: 120, showed: 60, deal: 40, won: 18, wonValue: 36_000 }],
  ["a3", "Glow Med Spa", { leads: 280, answered: 210, booked: 130, showed: 70, deal: 28, won: 12, wonValue: 9_000 }],
  ["a4", "Harbor Real Estate", { leads: 220, answered: 180, booked: 60, showed: 27, deal: 13, won: 8, wonValue: 6_000 }],
];
const PEOPLE: Array<[string, string, Partial<Tot>]> = [["p1", "Amara O.", { leads: 140, answered: 140, booked: 140, showed: 98, deal: 60, won: 34, wonValue: 68_000 }], ["p2", "Daniel K.", { leads: 120, answered: 120, booked: 120, showed: 60, deal: 30, won: 14, wonValue: 28_000 }], ["p3", "Zoe P.", { leads: 90, answered: 90, booked: 90, showed: 70, deal: 30, won: 12, wonValue: 24_000 }]];
const rowOf = ([id, name, o]: [string, string, Partial<Tot>]) => { const tot = t(o); return { id, name, steps: stepRows(tot), leak: biggestLeak(tot) }; };

export const SAMPLE = {
  summary: (): SummaryRes => {
    const leak = biggestLeak(TOT);
    return {
      period: { from: "2026-10-13", to: "2026-11-11" }, steps: stepRows(TOT), headline: headlineOf(TOT, { dow: 2, part: "morning", text: "leads from Tuesday mornings" }), hot: "leads from Tuesday mornings",
      leak: leak ? { ...leak, dollars: leakDollars(TOT, leak.stepIdx), formula: FORMULA.leak } : null, avgDeal: 2000, won: TOT.won, wonValue: TOT.wonValue, lost: TOT.lost,
      times: [{ key: "touch", label: "Lead to first reply", secs: 900, text: spanText(900) }, { key: "book", label: "Lead to booked", secs: 86400 * 1.2, text: spanText(86400 * 1.2) }, { key: "show", label: "Lead to showed up", secs: 86400 * 4.5, text: spanText(86400 * 4.5) }, { key: "win", label: "Lead to won", secs: 86400 * 14, text: spanText(86400 * 14) }],
      timesNote: "Median of the latest 1,240 leads.", live: false, historyStarts: "2026-08-20", problem: null, canSeeAccounts: true, canSeePeople: true,
    };
  },
  breakdown: (by: string): BreakdownRes => ({ by, rows: (by === "setter" || by === "closer" || by === "owner" ? PEOPLE : ACCOUNTS).map(rowOf) }),
  leaks: (): LeaksRes => ({ accounts: leakFinder(ACCOUNTS.map(([id, name, o]) => ({ id, name, tot: t(o) }))), setters: leakFinder(PEOPLE.map(([id, name, o]) => ({ id, name, tot: t(o) }))), closers: leakFinder(PEOPLE.slice(0, 2).map(([id, name, o]) => ({ id, name, tot: t(o) }))) }),
  cohorts: (): CohortsRes => ({ historyStarts: "2026-08-20", live: false, rows: [["2026-09-14", 210, 210, 210, 210, 98, 120, 132, 52, 70, 80, 14, 22, 30], ["2026-09-21", 232, 232, 232, 232, 110, 130, 140, 55, 74, 85, 16, 24, 31], ["2026-09-28", 250, 250, 250, 220, 120, 142, 150, 60, 80, 90, 18, 27, 33], ["2026-10-05", 240, 240, 200, 0, 108, 128, 0, 50, 66, 0, 15, 21, 0], ["2026-10-12", 262, 200, 0, 0, 99, 0, 0, 45, 0, 0, 10, 0, 0]].map((r) => ({ week: r[0] as string, leads: r[1] as number, mature7: r[2] as number, mature14: r[3] as number, mature30: r[4] as number, booked7: r[5] as number, booked14: r[6] as number, booked30: r[7] as number, showed7: r[8] as number, showed14: r[9] as number, showed30: r[10] as number, won7: r[11] as number, won14: r[12] as number, won30: r[13] as number })) }),
  forecast: (): ForecastRes => ({ ...forecastOf({ leads28: 1100, mature30: 600, booked30: 420, showed30: 232, won30: 56, wonValue: 176_000, wonN: 88, liveDays: 80 }), historyStarts: "2026-08-20" }),
  options: (): OptionsRes => ({ forms: [{ id: "f1", name: "Free quote form" }, { id: "f2", name: "Book a call" }] }),
  rows: (step: string): RowsRes => ({ label: `Sample: ${step}`, next: null, total: { n: 3, capped: false }, rows: [["Maria Lopez", "Bright Smile Dental"], ["Chris Dean", "Peak Roofing"], ["Ayo Bello", "Glow Med Spa"]].map(([name, loc], i) => ({ contactId: `s${i}`, locationId: `l${i}`, locationName: loc, name, email: null, phone: null, owner: null, source: "Facebook ads", createdAt: "2026-11-03T10:00:00Z", dnd: false, depth: 3, won: false, url: null })) }),
};
