"use client";

import type { WgAccount, WgBucket, WgList, WgRow, WgSettings, WgSummary, WgUsage } from "@/lib/analytics/wg-types";
import { FORMULA_BURN, FORMULA_SPIKE, whyLine } from "@/lib/analytics/wg-core";
import { dayLabel, SECTION_LABEL, SECTIONS, type Brief } from "@/lib/analytics/br-core";
import { useData } from "../../session";

// The one place the wallet screens and the brief read. Real parts of GET /api/app/wg?part=... and GET /api/app/br?part=... Sample data appears ONLY when the address carries ?wgfx and every screen
// that uses it says "Sample data". The real path never touches the sample builders below.
export const wgfxOn = (): boolean => { try { return typeof window !== "undefined" && /[?&]wgfx\b/.test(window.location.search + window.location.hash); } catch { return false; } };

export type Meta = { generatedAt: string; flags: Record<string, boolean>; level: string };

/** A real answer of the wallet API, or typed sample data with ?wgfx. `off` skips the read. */
export function useWg<T>(query: string | null, sample: () => T) {
  const fx = wgfxOn();
  const live = useData<T & Meta>(fx || query === null ? null : `wg?${query}`);
  if (!fx) return live;
  return { data: sample() as T & Meta, error: null as never, loading: false, reload: () => undefined };
}

const row = (i: number, name: string, balance: number | null, daysLeft: number | null, over: Partial<WgRow> = {}): WgRow => {
  const burn = balance !== null && daysLeft ? balance / daysLeft : null;
  const level = balance === null ? "unknown" : balance <= 0 ? "empty" : (balance <= 25 || (daysLeft !== null && daysLeft <= 3)) ? "low" : over.spike ? "spike" : "ok";
  return {
    locationId: `sample${i}`, name, balance, credits: null, level, state: balance === null ? "needs_permission" : "ok", observedAt: new Date(Date.now() - 3_600_000).toISOString(), burnPerDay: burn, daysLeft: balance !== null && balance <= 0 ? 0 : daysLeft,
    spent7d: burn === null ? null : burn * 7, topups7d: 0, spike: false, spikeSpent: null, spikeBaseline: null, readings: balance === null ? 0 : 22, enough: burn !== null, lowAmount: 25, ruleAmount: null, pausedUntil: null, url: null,
    why: whyLine({ balance, daysLeft, burnPerDay: burn, spike: !!over.spike, spikeSpent: over.spikeSpent ?? null, spikeBaseline: over.spikeBaseline ?? null, lowAmount: 25, state: balance === null ? "needs_permission" : "ok" }), ...over,
  } as WgRow;
};
export const SAMPLE_ROWS: WgRow[] = [
  row(1, "Sample Roofing Co", 0, 0), row(2, "Sample Dental", 18, 1.4), row(3, "Sample Med Spa", 64, 4.2), row(4, "Sample Realty", 210, 12, { spike: true, spikeSpent: 48, spikeBaseline: 9 }),
  row(5, "Sample Solar", 340, 30), row(6, "Sample Coaching", null, null),
];
const inB = (r: WgRow, b: WgBucket) => (b === "all" ? true : b === "empty" ? r.level === "empty" : b === "low" ? r.level === "low" : b === "spike" ? r.spike : b === "unknown" ? r.balance === null : r.pausedUntil !== null);

export const sampleSummary = (): WgSummary => {
  const counts = Object.fromEntries((["all", "empty", "low", "spike", "unknown", "paused"] as WgBucket[]).map((b) => [b, SAMPLE_ROWS.filter((r) => inB(r, b)).length])) as WgSummary["counts"];
  return {
    accounts: SAMPLE_ROWS.length, counts, headline: "1 client account has an empty credit balance and 1 is running low.", needsPermission: 1, top: SAMPLE_ROWS.filter((r) => r.level === "empty" || r.level === "low").slice(0, 3),
    formulaBurn: FORMULA_BURN, formulaSpike: FORMULA_SPIKE, historyStarts: new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10), prefs: { lowAmount: 25, lowDays: 3, alertsOn: true, spikeOn: true },
    autoRecharge: { available: false, note: "Not available from the platform yet: it does not let apps read whether auto-recharge is on, so SubSync never guesses. Check it in your CRM, Settings, Billing." },
  };
};
export const sampleList = (bucket: WgBucket, q: string): WgList => {
  const rows = SAMPLE_ROWS.filter((r) => inB(r, bucket) && (!q || r.name.toLowerCase().includes(q.toLowerCase())));
  return { rows, total: rows.length, page: 0, size: 20, pages: 1, bucket };
};
export const sampleAccount = (id: string): WgAccount => {
  const r = SAMPLE_ROWS.find((x) => x.locationId === id) ?? SAMPLE_ROWS[0];
  const series = Array.from({ length: 21 }, (_, i) => ({ day: new Date(Date.now() - (20 - i) * 86_400_000).toISOString().slice(0, 10), spent: i === 20 && r.spike ? 48 : 6 + (i % 4), topups: i === 9 ? 1 : 0, covered: i > 0 }));
  let bal = (r.balance ?? 0) + 120;
  const balances = series.map((d) => { bal = Math.max(0, bal - d.spent + (d.topups ? 80 : 0)); return { at: `${d.day}T12:00:00.000Z`, balance: bal }; });
  return { row: r, series, balances, events: [{ id: 1, kind: "recharge", at: series[9].day + "T12:00:00.000Z", text: "Topped up by about $80." }] };
};
export const sampleSettings = (): WgSettings => ({ canEdit: true, lowAmount: 25, lowDays: 3, alertsOn: true, spikeOn: true, watching: true, sendingNote: "Alert emails are shown here but only sent once sending is switched on for your business.", rules: [] });
export const sampleUsage = (): WgUsage => ({ state: "ok", days: 7, total: 42.18, byType: [{ type: "SMS", amount: 24.6, count: 310 }, { type: "Call", amount: 11.4, count: 38 }, { type: "Email", amount: 6.18, count: 912 }], byDay: [], note: "Sample data." });

export const sampleBrief = (): Brief => ({
  day: new Date().toISOString().slice(0, 10), dayText: dayLabel(new Date().toISOString().slice(0, 10)), headline: "5 of 7 things need you today.", more: 2, accounts: 6, formula: "Adds the estimates of missed leads, deals past their usual time in a stage, and failed or late payments. A deal that is in two lists may be counted twice, so read it as a ceiling, not a promise. Each part is an estimate from your own history.",
  dollar: { amount: 18200, text: "Up to about $18,200 could be at stake across these lists (estimate)." },
  bySection: Object.fromEntries(SECTIONS.map((s) => [s, 1])) as Brief["bySection"],
  items: [
    { key: "wallet_empty", section: "wallet", title: "1 client account has run out of credit", why: "Texts, calls and emails can stop until it is topped up (Sample Roofing Co).", count: 1, dollars: null, tier: 1, hash: "#clients?tab=wallet" },
    { key: "recover", section: "recover", title: "12 people are waiting to be won back", why: "They wrote, called or booked and nobody followed up.", count: 12, dollars: 11200, tier: 2, hash: "#today?tab=recover" },
    { key: "deals", section: "deals", title: "6 deals are past their usual time in a stage", why: "They have gone quiet for longer than your usual deals do.", count: 6, dollars: 5400, tier: 2, hash: "#pipeline" },
    { key: "payments", section: "payments", title: "3 payments have failed or gone late", why: "Chase them before they are written off.", count: 3, dollars: 1600, tier: 2, hash: "#payments" },
    { key: "save:s1", section: "save", title: "Save Sample Dental", why: "Reply speed slipped: 90% answered in time last week, 61% this week.", count: 1, dollars: null, tier: 2, hash: "#clients" },
  ],
});
export { SECTION_LABEL };
