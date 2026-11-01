import type { Freshness } from "@/lib/sync/freshness";
// Shapes returned by /api/app/*. Kept in one place so every view agrees with the server.

export type Band = "thriving" | "healthy" | "watch" | "at_risk";
export type Severity = "info" | "warning" | "critical";
export type Churn = { level: "low" | "medium" | "high"; reasons: string[] };

export type Account = {
  locationId: string; name: string | null; ignored: boolean; owner: string | null; url: string;
  contacts: number; new30d: number; openOpps: number; openValue: number; staleOpps: number; revenueAtRisk: number;
  unread: number; unanswered: number; calendars: number | null; pipelines: number | null;
  emailPct: number; phonePct: number; tagPct: number; activePct: number; completenessPct: number;
  daysInactive: number | null; lastActivityAt: string | null; dormant: boolean; score: number; band: Band; churn: Churn;
  winRate: number | null; expectedRevenue: number | null; followUpRevenueAtRisk: number | null;
  leadFlowDropPct: number | null; syncError: string | null; contactsSyncedAt: string | null;
};

export type ScoreComponent = { key: string; label: string; points: number; max: number; why: string };

export type Overview = {
  demo: boolean;
  plan: "free" | "starter" | "pro";
  entitlements: { enforced: boolean; accountLimit: number | null; features: Record<string, boolean> };
  hiddenAccounts: number;
  kpis: {
    accounts: number; ignored: number; contacts: number; openOpps: number; openValue: number; staleValue: number;
    staleOpps: number; dormant: number; unread: number; unanswered: number; expectedRevenue: number | null;
    followUpRevenueAtRisk: number | null; avgScore: number; openAlerts: number; criticalAlerts: number;
    estimateAccounts: number; minClosedDeals: number; excludedDeals: number; outlier: { value: number; share: number; of: number } | null;
  };
  bands: Record<Band, number>;
  attention: Array<{ locationId: string; name: string | null; score: number; band: Band; churn: string; reasons: string[]; url: string }>;
  freshness: Freshness;
};

export type ChecklistItem = { key: string; label: string; status: "done" | "todo" | "unknown"; auto: boolean; detail?: string };

export type Finding = { severity: "critical" | "warning" | "info" | "good"; area: string; message: string; fix?: string };
export type DomainReport = { domain: string; status: string; findings: Finding[]; mx: { hosts: string[] } };
export type DomainCheck = {
  domain: string; locationId: string | null; locationName?: string | null; status: "ok" | "warning" | "critical" | "error";
  checkedAt: string; report: DomainReport | null;
};

export type TrendPoint = {
  day: string; contacts: number; newContacts30d: number; openOpportunities: number; openValue: number;
  staleOpportunities: number; unreadConversations: number; completenessPct: number; engagementScore: number;
};

export type Deal = {
  opportunityId: string; locationId: string; locationName: string | null; name: string | null; contactName: string | null;
  value: number; pipelineName: string | null; stageName: string | null; lastActivityAt: string | null; daysStale: number; url: string;
};

export type AlertItem = {
  id: string; locationId: string | null; locationName?: string | null; kind: string; severity: Severity; title: string;
  detail: Record<string, unknown>; createdAt: string; resolvedAt: string | null;
};

export type AccountDetail = {
  account: Account;
  breakdown: { total: number; components: ScoreComponent[] };
  trend: TrendPoint[];
  staleDeals: Deal[];
  checklist: { items: ChecklistItem[]; completionPct: number };
  domains: DomainCheck[];
  alerts: AlertItem[];
  settings: { staleDays: number; dormantDays: number; slaHours: number };
  clientView?: boolean;
  brand?: { name: string | null; color: string | null };
};
