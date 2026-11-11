// INTERIM view-model types for the Pipeline module screens (slice PU). Slice PD's pipeline3-types.ts (the API response shapes) replaces/extends these;
// views/pl3/adapters turn API shapes into these. Money is whole cents everywhere. A null rate or range means "not enough data", never zero.
export type PlTone = "green" | "amber" | "red" | "grey" | "cyan" | "violet";
export type PlStatus = "open" | "won" | "lost" | "abandoned";

export type PlStage = {
  id: string; name: string; order: number;
  count: number; valueCents: number;
  staleCount: number; staleValueCents: number;
  medianDwellDays: number | null; normalDwellDays: number | null; // this stage's dwell now vs the account's own normal
  lostCount: number; lostValueCents: number; // deals that left the pipeline from this stage in the period
};
export type PlDrain = { reason: string; count: number; valueCents: number };
export type PlReplayDay = { date: string; stageValueCents: number[]; stageCounts: number[]; wonCents: number; lostCents: number };
export type PlPersonFlow = { id: string; name: string; stages: Array<{ count: number; valueCents: number; staleCount: number; lostCount: number; lostValueCents: number }>; wonCents: number; wonCount: number };
export type PlMoneyFlow = {
  pipelineName: string; periodLabel: string;
  stages: PlStage[]; drains: PlDrain[];
  won: { count: number; valueCents: number; previousValueCents: number | null };
  leak: { fromStage: string; toStage: string; lostCents: number } | null; // biggest drop between stages
  people: PlPersonFlow[]; replay: PlReplayDay[] | null; minDeals: number;
  excluded: { zeroValue: number; noOwner: number; test: number };
  outlier: { name: string; share: number } | null; // one deal over 40% of the total, shown separately
};
export type PlDeal = {
  id: string; name: string; contactName: string | null; accountName: string; locationId: string; pipelineName: string;
  /** The person behind the deal (opens in the shared lead panel); absent when none. */ contactId?: string | null;
  stageId: string; stageName: string; status: PlStatus; valueCents: number;
  ownerId?: string | null; ownerName: string | null; source: string | null; daysInStage: number; staleAfterDays: number | null; // per stage, from the account's own dwell times
  lostReason: string | null; health: number | null; // 0..100, null = not enough data
  url: string | null;
};
export type PlDeals = { total: number; page: number; pageSize: number; rows: PlDeal[]; next?: string | null };
export type PlOverview = {
  headline: { openCount: number; openValueCents: number; staleCount: number; staleValueCents: number; wonCents: number; lostCents: number; winRate: number | null; winRateDeals: number };
  bigUntouched?: { count: number; valueCents: number; days: number };
  sentence: string; leak: PlMoneyFlow["leak"]; minDeals: number; excluded: PlMoneyFlow["excluded"]; outlier: PlMoneyFlow["outlier"];
};
export type PlForecast = { lowCents: number | null; midCents: number | null; highCents: number | null; closedDeals: number; minDeals: number; formula: string; byStage: Array<{ stage: string; openCents: number | null; winChance: number | null }> };
export type PlWonLost = { won: number; lost: number; wonCents: number; lostCents: number; winRate: number | null; byReason: PlDrain[]; bookedToWon: number | null };
export type PlPerson = { id: string; name: string; open: number; openCents: number; won: number; wonCents: number; lost: number; lostCents: number; stale: number; winRate: number | null; burned: number };
export type PlSource = { source: string; deals: number; won: number; winRate: number | null; wonCents: number; avgCycleDays: number | null };
export type PlStageHistory = { stages: Array<{ name: string; medianDays: number | null; p90Days: number | null; sample: number; staleAfterDays: number | null }>; recorded: { since: string | null; changes: number } };
export type PlHealthRow = { locationId: string; name: string; open: number; stale: number; staleShare: number | null; health: number | null };
export type PlProof = { weekLabel: string; headline: string; verifyHash: string | null; rows: Array<{ label: string; value: string; go: "needs" | "won" | "lost" | null }> };
export type PlPart = "money-flow" | "overview" | "needs-attention" | "won-lost" | "forecast" | "people" | "sources" | "stage-history" | "health" | "proof" | "list" | "accounts" | "pipelines";
