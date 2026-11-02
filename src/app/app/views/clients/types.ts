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

export const TABS = ["health", "onboarding", "details", "compare", "reviews"] as const;
export type TabId = (typeof TABS)[number];
