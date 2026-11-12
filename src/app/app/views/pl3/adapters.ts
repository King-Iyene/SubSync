import type { Pl3Forecast, Pl3Health, Pl3MoneyFlow, Pl3Overview, Pl3People, Pl3Receipt, Pl3Replay, Pl3Row, Pl3Sources, Pl3StageHistory, Pl3WonLost, Page } from "@/lib/analytics/pipeline3-types";
import type { PlDeal, PlDeals, PlForecast, PlHealthRow, PlMoneyFlow, PlOverview, PlPart, PlPerson, PlProof, PlSource, PlStageHistory, PlWonLost } from "@/lib/analytics/pipeline3-types-interim";

// Adapters from the real API shapes (pipeline3-types.ts, dollars) to the screens' view models (cents). One place, pure, unit tested.
// A missing or malformed answer never throws: it becomes the empty shape, which the screens already show as "nothing yet".
const c = (v: number | null | undefined): number => Math.round((v ?? 0) * 100);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function dealOf(r: Pl3Row): PlDeal {
  return {
    id: r.opportunityId, contactId: r.contactId ?? null, name: r.name || r.contactName || "Deal", contactName: r.contactName ?? null, accountName: r.accountName ?? "Account", locationId: r.locationId, pipelineName: r.pipelineName ?? "Pipeline",
    stageId: r.stageId ?? "", stageName: r.stageName ?? "No stage", status: r.status, valueCents: c(r.value), ownerId: r.ownerId, ownerName: r.ownerName, source: r.source,
    daysInStage: Math.max(0, Math.round(r.daysInStage ?? 0)), staleAfterDays: r.staleLimitDays === null || r.staleLimitDays === undefined ? null : Math.round(r.staleLimitDays), lostReason: r.lostReason, health: r.health, url: r.url,
  };
}
export const dealsOf = (p: Partial<Page<Pl3Row>> | null | undefined): PlDeals => ({ total: p?.total ?? 0, page: (p?.page ?? 0) + 1, pageSize: p?.size ?? 20, rows: arr<Pl3Row>(p?.rows).map(dealOf), next: p?.next ?? null });

export function overviewOf(o: Pl3Overview | null): PlOverview {
  const h = o?.health;
  return {
    headline: { openCount: o?.openCount ?? 0, openValueCents: c(o?.openValue?.value), staleCount: o?.stale?.count ?? 0, staleValueCents: c(o?.stale?.value), wonCents: c(o?.wonLast30?.value), lostCents: c(o?.lostLast30?.value), winRate: o?.winRate?.value ?? null, winRateDeals: o?.winRate?.of ?? 0 },
    bigUntouched: o?.bigUntouched ? { count: o.bigUntouched.count, valueCents: c(o.bigUntouched.value), days: o.bigUntouched.days } : undefined,
    sentence: typeof o?.headline === "string" ? o.headline : "", leak: null, minDeals: 15, excluded: { zeroValue: h?.noValue ?? 0, noOwner: h?.noOwner ?? 0, test: h?.test ?? 0 }, outlier: null, trust: o?.trust ?? null,
  };
}

export function flowOf(m: Pl3MoneyFlow | null, replay: Pl3Replay | null): PlMoneyFlow {
  const pipe = m?.pipelines?.find((p) => p.id === m?.pipelineId);
  const stages = arr<Pl3MoneyFlow["stages"][number]>(m?.stages).filter((s) => !m?.pipelineId || s.pipelineId === m.pipelineId).sort((a, b) => a.order - b.order);
  const index = new Map(stages.map((s, i) => [s.id, i]));
  const lostBy = stages.map(() => ({ count: 0, value: 0 }));
  const reasons = new Map<string, { count: number; value: number }>();
  for (const d of arr<Pl3MoneyFlow["drain"][number]>(m?.drain)) {
    const i = index.get(d.stageId);
    if (i === undefined) continue;
    lostBy[i].count += d.count; lostBy[i].value += d.value;
    const x = reasons.get(d.reason) ?? { count: 0, value: 0 };
    reasons.set(d.reason, { count: x.count + d.count, value: x.value + d.value });
  }
  const names = new Map(stages.map((s) => [s.id, s.name]));
  const big = m?.outliers?.[0];
  return {
    pipelineName: pipe?.name ?? "Pipeline", periodLabel: m?.period ? `${m.period.from.slice(0, 10)} to ${m.period.to.slice(0, 10)}` : "",
    stages: stages.map((s, i) => ({
      id: s.id, name: s.name, order: s.order, count: s.openCount, valueCents: c(s.openValue), noValueCount: s.noValueCount ?? 0, staleCount: s.clog.count, staleValueCents: c(s.clog.value),
      medianDwellDays: s.dwell.enough ? s.dwell.medianDays : null, normalDwellDays: s.dwell.enough ? s.dwell.normalDays : null, lostCount: lostBy[i].count, lostValueCents: c(lostBy[i].value),
    })),
    drains: [...reasons.entries()].map(([reason, x]) => ({ reason, count: x.count, valueCents: c(x.value) })).sort((a, b) => b.valueCents - a.valueCents),
    won: { count: m?.vault?.won?.n ?? 0, valueCents: c(m?.vault?.won?.value), previousValueCents: null },
    leak: m?.leak && m.leak.fromStageId ? { fromStage: names.get(m.leak.fromStageId) ?? "A stage", toStage: (m.leak.toStageId && names.get(m.leak.toStageId)) || "the drain", lostCents: c(m.leak.lostValue) } : null,
    people: arr<Pl3MoneyFlow["people"][number]>(m?.people).map((p) => ({
      id: p.ownerId ?? "none", name: p.name, wonCents: c(p.won.value), wonCount: p.won.n,
      stages: stages.map((s) => { const x = p.stages.find((y) => y.stageId === s.id); return { count: x?.count ?? 0, valueCents: c(x?.value), staleCount: 0, lostCount: 0, lostValueCents: 0 }; }),
    })),
    replay: replay?.enough && replay.frames.length ? replay.frames.map((f) => ({
      date: f.day, wonCents: c(f.wonValue), lostCents: c(f.lostValue),
      stageValueCents: stages.map((s) => c(f.stages.find((x) => x.stageId === s.id)?.value)), stageCounts: stages.map((s) => f.stages.find((x) => x.stageId === s.id)?.count ?? 0),
    })) : null,
    minDeals: 15,
    excluded: { zeroValue: 0, noOwner: 0, test: 0 },
    outlier: big ? { name: big.name ?? "One deal", share: big.sharePct / 100 } : null,
  };
}

export function wonLostOf(w: Pl3WonLost | null): PlWonLost {
  return { won: w?.won?.n ?? 0, lost: w?.lost?.n ?? 0, wonCents: c(w?.won?.value), lostCents: c(w?.lost?.value), winRate: w?.winRate?.value ?? null, byReason: arr<Pl3WonLost["lostReasons"][number]>(w?.lostReasons).map((r) => ({ reason: r.reason, count: r.count, valueCents: c(r.value) })), bookedToWon: w?.bookedToWon?.rate?.value ?? null };
}

export function forecastOf(f: Pl3Forecast | null): PlForecast {
  const n = f?.next30;
  const ok = !!n && n.enough && n.low !== null && n.high !== null && n.value !== null;
  return {
    lowCents: ok ? c(n.low) : null, midCents: ok ? c(n.value) : null, highCents: ok ? c(n.high) : null, closedDeals: f?.closedDeals ?? 0, minDeals: f?.minClosed ?? 15,
    formula: [n?.formula, n?.minNote].filter(Boolean).join(" ") || "An estimate from your own closed deals.",
    byStage: arr<Pl3Forecast["stageProb"][number]>(f?.stageProb).map((s) => ({ stage: s.stageName, openCents: null, winChance: s.p.enough ? s.p.value : null })),
  };
}

export const peopleOf = (p: Pl3People | null): PlPerson[] => arr<Pl3People["rows"][number]>(p?.rows).map((x) => ({ id: x.ownerId ?? "none", name: x.name, open: x.open.n, openCents: c(x.open.value), won: x.won.n, wonCents: c(x.won.value), lost: x.lost.n, lostCents: c(x.lost.value), stale: x.staleCount, winRate: x.winRate.value, burned: x.burned }));
export const sourcesOf = (s: Pl3Sources | null): PlSource[] => arr<Pl3Sources["bySource"][number]>(s?.bySource).map((x) => ({ source: x.source, deals: x.created, won: x.won, winRate: x.winRate.value, wonCents: c(x.wonValue), avgCycleDays: x.avgCycleDays }));

export function historyOf(h: Pl3StageHistory | null): PlStageHistory {
  return { stages: arr<Pl3StageHistory["dwell"][number]>(h?.dwell).map((s) => ({ name: s.stageName, medianDays: s.medianDays, p90Days: s.p90Days, sample: s.stays, staleAfterDays: Math.round(s.staleLimitDays) })), recorded: { since: h?.historySince ? h.historySince.slice(0, 10) : null, changes: h?.eventsRecorded ?? 0 } };
}
export const healthOf = (h: Pl3Health | null): PlHealthRow[] => arr<Pl3Health["rows"][number]>(h?.rows).map((x) => ({ locationId: x.locationId, name: x.accountName ?? "Account", open: x.open, stale: x.stale, staleShare: x.open > 0 ? x.stale / x.open : null, health: x.score }));

export function proofOf(r: Pl3Receipt | null): PlProof {
  if (!r || !r.won || !r.lost) return { weekLabel: "", headline: "", verifyHash: null, rows: [] };
  const empty = r.moved + r.won.n + r.lost.n + r.newDeals + r.unclogged + r.stillStale === 0;
  const m = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  return {
    weekLabel: `Week of ${r.weekStart.slice(0, 10)}`, headline: r.headline, verifyHash: r.verifyHash,
    rows: empty ? [] : [
      { label: "Deals moved on", value: String(r.moved), go: null }, { label: "Unclogged (moved after sitting too long)", value: String(r.unclogged), go: null }, { label: "Still stuck now", value: String(r.stillStale), go: "needs" },
      { label: "Won", value: `${r.won.n} deals, ${m(r.won.value)}`, go: "won" }, { label: "Lost", value: `${r.lost.n} deals, ${m(r.lost.value)}`, go: "lost" }, { label: "New deals", value: String(r.newDeals), go: null },
    ],
  };
}

/** What the screens call a part, and how the API names it. */
export const API_PART: Record<PlPart, string> = {
  "money-flow": "money-flow", pipelines: "pipelines", overview: "overview", "needs-attention": "attention", "won-lost": "won-lost", forecast: "forecast", people: "people", sources: "sources", "stage-history": "stage-history", health: "health", proof: "receipt", list: "list", accounts: "health",
};
export function adapt(part: PlPart, raw: unknown, aux?: unknown): unknown {
  const r = raw as never;
  switch (part) {
    case "pipelines": return raw;
    case "money-flow": return flowOf(r, (aux as Pl3Replay | null) ?? null);
    case "overview": return overviewOf(r);
    case "needs-attention": case "list": return dealsOf(r);
    case "won-lost": return wonLostOf(r);
    case "forecast": return forecastOf(r);
    case "people": return { rows: peopleOf(r) };
    case "sources": return { rows: sourcesOf(r) };
    case "stage-history": return historyOf(r);
    case "health": case "accounts": return { rows: healthOf(r) };
    case "proof": return proofOf(r);
  }
}
// ---- the address of one part of the real API ----
export type PlFiltersLike = { days: number; from?: string; to?: string; locationId: string; pipeline: string; ownerId: string; q: string };
const DEAL_STATUS = new Set(["open", "won", "lost", "abandoned"]);
/** Drill-down words are translated to the server's own (status or stale become bucket, lostReason becomes reason, pageSize becomes size); the server re-checks every one of them. */
export function queryOf(part: PlPart, f: PlFiltersLike, extra: Record<string, string | number | undefined> = {}, now = new Date()): string {
  const from = new Date(now.getTime() - f.days * 86_400_000);
  // The date bar's dates win; `days` counted back from today is only the fallback before they are known.
  const p = new URLSearchParams({ part: API_PART[part], from: f.from && f.to ? f.from : from.toISOString().slice(0, 10), to: f.from && f.to ? f.to : now.toISOString().slice(0, 10) });
  if (f.locationId) p.set("location", f.locationId);
  if (f.pipeline) p.set("pipeline", f.pipeline);
  if (f.ownerId) p.set("owner", f.ownerId);
  if (f.q.trim()) p.set("q", f.q.trim());
  const status = typeof extra.status === "string" && DEAL_STATUS.has(extra.status) ? extra.status : "";
  if (part === "list") { const bucket = extra.stale ? "stale" : status; if (bucket) p.set("bucket", bucket); }
  if (extra.stage) p.set("stage", String(extra.stage));
  if (extra.after) p.set("after", String(extra.after));
  if (extra.total) p.set("total", String(extra.total));
  if (extra.empty) p.set("empty", "1");
  if (extra.owner) p.set("owner", String(extra.owner));
  if (extra.location) p.set("location", String(extra.location));
  if (extra.source) p.set("source", String(extra.source));
  const reason = extra.reason ?? extra.lostReason;
  if (reason) p.set("reason", reason === "No reason recorded" ? "none" : String(reason));
  if (extra.page) p.set("page", String(Math.max(0, Number(extra.page) - 1)));
  if (extra.pageSize) p.set("size", String(extra.pageSize));
  if (part === "health" || part === "accounts" || part === "people") p.set("size", "100");
  return `pipeline3?${p}`;
}
