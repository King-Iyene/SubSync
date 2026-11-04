import type { AccountFacts, Proof, QueueRow, ReplyPoint, TodayItem, Totals, Usual } from "./today-queue.ts";
import type { Forecast, Insight, LeadRow, SinceVisit } from "./today-smart.ts";
import type { Assignment, Hold } from "./today-state.ts";

// The shape of the Today read (GET /api/app/today) as the page receives it. The server builds it in src/lib/api/today-api.ts.

export type TodayPerson = { contactId: string | null; name: string; phone: string | null; at: number; calendar: string | null; url: string; locationId: string; dnd: boolean; noOutcome?: boolean };
export type TodayMine = {
  timeZone: string;
  calls: {
    newLeads: { total: number; rows: Array<{ contactId: string; name: string; hasPhone: boolean; url: string }> };
    noshows: { total: number; rows: TodayPerson[] };
    confirm: { total: number; rows: TodayPerson[] };
  };
  appointments: { today: TodayPerson[]; tomorrow: TodayPerson[]; noOutcomeToday: number };
  numbers: {
    reply: { current: { seconds: number | null; answered: number }; usual: { seconds: number | null; answered: number }; verdict: Usual };
    showRate: { now: number | null; usual: number | null; nNow: number; nUsual: number; minN: number };
    inTarget: { now: number | null; usual: number | null; nNow: number; nUsual: number };
    streakDays: number;
  };
};
export type TodayData = {
  now: number; scope: "all" | "account"; kind: "agency" | "business" | "client";
  accounts: AccountFacts[]; items: TodayItem[]; totals: Totals; queue: QueueRow[]; staleDays: number; targetMinutes: number;
  access: { leadsBlocked: boolean; apptsBlocked: boolean };
  outlier: { value: number; share: number } | null;
  pulse: { reply: { current: { seconds: number | null; answered: number }; usual: { seconds: number | null; answered: number }; points: ReplyPoint[]; verdict: Usual }; stale: { today: number; usual: number | null; samples: number; unusual: "up" | "down" | null } | null };
  proof: Proof | null;
  mine: TodayMine | null;
  /** The lead ledger (the last 14 days, newest first, at most `ledgerCap` rows) and how many leads there really were. */
  ledger: LeadRow[]; ledgerTotal: number;
  /** Rules written in docs/METRICS.md; the no-show card is added on the page from the items on screen. */
  insights: Insight[];
  /** What changed since this person last had Today open; null on a first visit. */
  sinceVisit: SinceVisit | null;
  forecast: Forecast;
  /** Each account's own time zone, for hours. */
  zones: Record<string, string>;
  /** Items this person's team set aside (Done or snoozed), by item id, and who has taken a row. Only SubSync knows these; the CRM does not. */
  holds: Record<string, Hold>; assigned: Record<string, Assignment>;
  /** False until the latest database update is applied: the buttons then say so in plain words. */
  actionsReady: boolean;
};
