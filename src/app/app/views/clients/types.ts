import type { Band } from "../../types";

// Shapes the Clients module reads from /api/app (stage C1). One place, so the tabs agree with the server.
export type ClientRow = {
  locationId: string; name: string | null; url: string; score: number; band: Band; churn: string; dormant: boolean; new30d: number; openValue: number;
  unanswered: number; completenessPct: number; winRate: number | null; avgCycleDays: number | null;
  profile: { monthlyFee: number | null; renewalDate: string | null; industry: string | null; notes: string | null; lastContactedAt: string | null };
  log: { count: number; lastNote: { body: string; author: string | null; on: string } | null };
  roi: { pipelineMultiple: number; wonMultiple: number } | null;
  renewal: { daysLeft: number; bucket: string } | null;
  contactGap: { days: number | null; flagged: boolean };
  progress: { daysSinceInstall: number | null; firstLeadAt: string | null; firstWonAt: string | null; needsIntervention: boolean };
  activity: string;
  setup: { score: number; missing: string[] };
};

export type ClientsData = {
  clients: ClientRow[];
  revenue: { monthly: number; atRisk: number; clientsWithFee: number };
  firstUse: { noFees: boolean; noRenewals: boolean; noIndustry: boolean; noLog: boolean };
  industryChoices: string[];
  renewals: Array<{ locationId: string; name: string | null; daysLeft: number; bucket: string; fee: number | null }>;
  segments: Array<{ industry: string; accounts: number; avgScore: number; avgWinRate: number | null; openValue: number }>;
  compare: Array<{ locationId: string; name: string; score?: number }>;
};

export type DayPoint = { day: string; healthScore: number | null; openValue: number | null; contacts: number | null; newContacts30d: number | null; completenessPct: number | null };
export type ApptWeek = { weekStart: number; count: number; showed: number; noShow: number; members: Array<{ contactId: string; name: string; status: string; startAt: number; url: string }> };
export type TrendsData = { locationId: string; name: string; days: DayPoint[]; historyStartsOn: string | null; weeks: ApptWeek[] };

export const TABS = ["health", "onboarding", "details", "compare", "reviews", "reports"] as const;
export type TabId = (typeof TABS)[number];

// The rebuilt screen's shapes (GET clients?part=home|list|one), the same as src/lib/analytics/clients-v2.ts builds on the server.
import type { Assessment, Changed, Filter, Headline, Primary, Renewal, Summary, TalkingPoint, Value } from "@/lib/analytics/clients-v2";
export type BookRowOut = {
  id: string; name: string; level: Assessment["level"]; label: string; line: string; reasons: Assessment["reasons"]; needs: { kind: "risk" | "renewal"; label: string } | null; renewal: Renewal | null;
  context: string[]; score: number; fee: number | null; industry: string | null; lastSpokenDays: number | null; daysSinceAdded: number | null; url: string;
};
export type BookHome = {
  now: number; summary: Summary; headline: Headline; support: string; primary: Primary | null; next: string | null;
  needs: { total: number; rows: BookRowOut[]; ids: string[] };
  renewals: { total: number; fee: number; overdue: number; windowDays: number; rows: BookRowOut[] };
  facets: Record<Filter, number>; reading: { reading: boolean; done: number; total: number; text: string }; readLimit: string | null; targetMinutes: number;
  industryChoices: string[]; firstId: string | null;
};
export type BookList = { rows: BookRowOut[]; total: number; page: number; pages: number; from: number; to: number; filter: Filter; facets: Record<Filter, number>; industryChoices: string[] };
export type BookOne = {
  row: BookRowOut; value: Value; valueFormula: string; dealsLine: string | null; changed: Changed; historyStartsOn: string | null; talk: TalkingPoint[];
  reminders: Array<{ before: number; date: string; words: string }>; summary: string; industryChoices: string[]; playbook: string;
  queue: { position: number | null; total: number; previous: string | null; next: string | null };
};
