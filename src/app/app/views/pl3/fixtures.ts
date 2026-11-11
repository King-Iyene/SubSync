import type { PlDeal, PlDeals, PlForecast, PlHealthRow, PlMoneyFlow, PlOverview, PlPerson, PlProof, PlReplayDay, PlSource, PlStageHistory, PlWonLost } from "@/lib/analytics/pipeline3-types-interim";

// Small typed fixtures (no database). Open any Pipeline address with ?plfx=1 (or empty / error) to see every state until the API is merged.
const C = 100;
const NAMES = ["New lead", "Contacted", "Appointment booked", "Proposal sent", "Negotiation", "Contract out"];
const VAL = [310_000, 240_000, 196_000, 142_000, 88_000, 41_000], CNT = [96, 61, 38, 24, 13, 6];
const MED = [1.2, 3.1, 5.4, 9.8, 6.9, 4.4], NORM = [1.5, 3.0, 4.2, 6.0, 5.5, 4.0], STALE = [4, 6, 7, 11, 3, 0], LOST = [20_000, 34_000, 41_000, 63_000, 22_000, 9_000], LOSTN = [14, 9, 7, 8, 3, 1];

export const FLOW_STAGES = NAMES.map((name, i) => ({ id: `st${i}`, name, order: i, count: CNT[i], valueCents: VAL[i] * C, staleCount: STALE[i], staleValueCents: Math.round(VAL[i] * C * (STALE[i] / CNT[i])), medianDwellDays: MED[i], normalDwellDays: NORM[i], lostCount: LOSTN[i], lostValueCents: LOST[i] * C }));
const replay = (): PlReplayDay[] => Array.from({ length: 45 }, (_, d) => {
  const t = d / 44, d0 = new Date(Date.UTC(2026, 9, 1 + d));
  return { date: d0.toISOString().slice(0, 10), stageValueCents: VAL.map((v, i) => Math.round(v * C * (0.55 + 0.45 * t + 0.08 * Math.sin(d / 3 + i)) * (i === 3 ? 1 + 0.35 * t : 1))), stageCounts: CNT.map((c, i) => Math.max(1, Math.round(c * (0.6 + 0.4 * t + 0.05 * Math.sin(d / 3 + i))))), wonCents: Math.round(212_000 * C * t), lostCents: Math.round(189_000 * C * t) };
});
export const FLOW_FIXTURE: PlMoneyFlow = {
  pipelineName: "Sales pipeline", periodLabel: "Last 45 days",
  stages: FLOW_STAGES,
  drains: [{ reason: "Price too high", count: 11, valueCents: 71_000 * C }, { reason: "Went quiet", count: 17, valueCents: 64_000 * C }, { reason: "Chose a competitor", count: 8, valueCents: 33_000 * C }, { reason: "Not ready yet", count: 6, valueCents: 14_000 * C }, { reason: "No reason recorded", count: 4, valueCents: 7_000 * C }],
  won: { count: 19, valueCents: 212_000 * C, previousValueCents: 171_000 * C },
  leak: { fromStage: "Proposal sent", toStage: "Negotiation", lostCents: 63_000 * C },
  people: [
    { id: "u1", name: "Mia Okafor", stages: FLOW_STAGES.map((s) => ({ count: Math.round(s.count * 0.4), valueCents: Math.round(s.valueCents * 0.45), staleCount: Math.round(s.staleCount * 0.2), lostCount: Math.round(s.lostCount * 0.3), lostValueCents: Math.round(s.lostValueCents * 0.25) })), wonCents: 118_000 * C, wonCount: 11 },
    { id: "u2", name: "Dan Reyes", stages: FLOW_STAGES.map((s) => ({ count: Math.round(s.count * 0.35), valueCents: Math.round(s.valueCents * 0.3), staleCount: Math.round(s.staleCount * 0.6), lostCount: Math.round(s.lostCount * 0.5), lostValueCents: Math.round(s.lostValueCents * 0.55) })), wonCents: 64_000 * C, wonCount: 6 },
    { id: "u3", name: "Priya Shah", stages: FLOW_STAGES.map((s) => ({ count: Math.round(s.count * 0.25), valueCents: Math.round(s.valueCents * 0.25), staleCount: Math.round(s.staleCount * 0.2), lostCount: Math.round(s.lostCount * 0.2), lostValueCents: Math.round(s.lostValueCents * 0.2) })), wonCents: 30_000 * C, wonCount: 2 },
  ],
  replay: replay(), minDeals: 20, excluded: { zeroValue: 14, noOwner: 9, test: 3 }, outlier: { name: "Harbor Group retainer", share: 0.46 },
};
export const FLOW_EMPTY: PlMoneyFlow = { ...FLOW_FIXTURE, stages: [], drains: [], won: { count: 0, valueCents: 0, previousValueCents: null }, leak: null, people: [], replay: null, outlier: null };

export const OVERVIEW_FIXTURE: PlOverview = {
  headline: { openCount: 238, openValueCents: 1_017_000 * C, staleCount: 31, staleValueCents: 214_000 * C, wonCents: 212_000 * C, lostCents: 189_000 * C, winRate: 0.41, winRateDeals: 46 },
  sentence: "Your deals are slowest after the proposal goes out: $630,000 has left from that step in 45 days.",
  leak: FLOW_FIXTURE.leak, minDeals: 20, excluded: FLOW_FIXTURE.excluded, outlier: FLOW_FIXTURE.outlier,
};
const ACCT = ["Northside Roofing", "Bright Smiles Dental", "Lakeview Realty"], OWNER = ["Mia Okafor", "Dan Reyes", "Priya Shah", null], SRC = ["Facebook ads", "Google", "Referral", null];
export const dealsFixture = (n: number, kind: "stale" | "won" | "lost" | "all"): PlDeal[] => Array.from({ length: n }, (_, i) => {
  const si = i % NAMES.length;
  return { id: `d${kind}${i}`, name: `${["Re-roof", "Whitening plan", "Listing 12 Elm", "Kitchen remodel", "Veneers", "Buyer search"][i % 6]} ${i + 1}`, contactName: `Contact ${i + 1}`, accountName: ACCT[i % 3], locationId: `loc${i % 3}`, pipelineName: "Sales pipeline", stageId: `st${si}`, stageName: NAMES[si],
    status: kind === "won" ? "won" : kind === "lost" ? "lost" : "open", valueCents: (900 + ((i * 7919) % 9000)) * C, ownerName: OWNER[i % 4], source: SRC[i % 4], daysInStage: 4 + ((i * 5) % 40), staleAfterDays: [3, 7, 10, 14, 10, 7][si],
    lostReason: kind === "lost" ? ["Price too high", "Went quiet", "Chose a competitor"][i % 3] : null, health: i % 5 === 4 ? null : 90 - ((i * 11) % 80), url: null };
});
export const page = (rows: PlDeal[], total: number, pg: number, size: number): PlDeals => ({ total, page: pg, pageSize: size, rows });

export const FORECAST_FIXTURE: PlForecast = { lowCents: 301_000 * C, midCents: 382_000 * C, highCents: 447_000 * C, closedDeals: 46, minDeals: 20, formula: "Each open deal's value times how often deals at its stage have won in your own last 90 days, pulled toward your overall win rate when a stage has few deals. The range is that estimate lowered and raised by how much your win rate has swung week to week. Deals above 40% of the total are left out and shown separately.", byStage: NAMES.map((s, i) => ({ stage: s, openCents: VAL[i] * C, winChance: [0.08, 0.14, 0.27, 0.38, 0.55, null][i] ?? null })) };
export const WONLOST_FIXTURE: PlWonLost = { won: 19, lost: 27, wonCents: 212_000 * C, lostCents: 189_000 * C, winRate: 0.41, byReason: FLOW_FIXTURE.drains, bookedToWon: 0.34 };
export const PEOPLE_FIXTURE: PlPerson[] = [{ id: "u1", name: "Mia Okafor", open: 61, openCents: 458_000 * C, won: 11, wonCents: 118_000 * C, lost: 7, stale: 5, winRate: 0.61, burnedCents: 40_000 * C }, { id: "u2", name: "Dan Reyes", open: 48, openCents: 301_000 * C, won: 6, wonCents: 64_000 * C, lost: 14, stale: 17, winRate: 0.3, burnedCents: 98_000 * C }, { id: "u3", name: "Priya Shah", open: 22, openCents: 150_000 * C, won: 2, wonCents: 30_000 * C, lost: 3, stale: 2, winRate: null, burnedCents: 12_000 * C }];
export const SOURCES_FIXTURE: PlSource[] = [{ source: "Referral", deals: 31, won: 12, winRate: 0.55, wonCents: 98_000 * C, avgCycleDays: 14 }, { source: "Google", deals: 64, won: 14, winRate: 0.34, wonCents: 77_000 * C, avgCycleDays: 22 }, { source: "Facebook ads", deals: 120, won: 9, winRate: 0.12, wonCents: 37_000 * C, avgCycleDays: 31 }, { source: "Unknown", deals: 8, won: 1, winRate: null, wonCents: 4_000 * C, avgCycleDays: null }];
export const HISTORY_FIXTURE: PlStageHistory = { stages: NAMES.map((name, i) => ({ name, medianDays: MED[i], p90Days: Math.round(MED[i] * 2.4 * 10) / 10, sample: [120, 90, 64, 40, 22, i === 5 ? 6 : 9][i], staleAfterDays: [3, 7, 10, 14, 10, null][i] ?? null })), recorded: { since: "2026-09-14", changes: 2_184 } };
export const HEALTH_FIXTURE: PlHealthRow[] = [{ locationId: "loc0", name: "Northside Roofing", openCents: 520_000 * C, staleShare: 0.31, winRate: 0.28, health: 41 }, { locationId: "loc1", name: "Bright Smiles Dental", openCents: 310_000 * C, staleShare: 0.09, winRate: 0.52, health: 83 }, { locationId: "loc2", name: "Lakeview Realty", openCents: 187_000 * C, staleShare: null, winRate: null, health: null }];
export const PROOF_FIXTURE: PlProof = { weekLabel: "Week of 2 Nov", rows: [{ locationId: "loc0", name: "Northside Roofing", caught: 12, unclogged: 7, wonCents: 48_000 * C, staleCents: 120_000 * C }, { locationId: "loc1", name: "Bright Smiles Dental", caught: 5, unclogged: 5, wonCents: 31_000 * C, staleCents: 16_000 * C }, { locationId: "loc2", name: "Lakeview Realty", caught: 3, unclogged: 1, wonCents: 0, staleCents: 22_000 * C }] };
