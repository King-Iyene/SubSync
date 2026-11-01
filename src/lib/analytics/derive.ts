// Pure analytics on top of per-account counts: completeness, activity, score, churn risk,
// revenue figures, onboarding checklist, alert rules, the Slack digest and CSV export.

import {
  churnRisk, engagementBreakdown, healthBand, isDormant,
  type ChurnRisk, type ScoreBand, type ScoreBreakdown,
} from "../scoring.ts";
import { fmtDuration } from "./speed-intel.ts";

// A win rate built on a handful of deals is noise, so none is shown (or used in an estimate) below this.
import { MIN_CLOSED_DEALS } from "./metrics.ts";
export { MIN_CLOSED_DEALS };

export type AccountRow = {
  /** New leads from the last two days that no person has replied to within the target, and how long the oldest has waited. */
  speedWaiting?: number;
  /** Past appointments with no outcome recorded in the last 30 days. */
  unmarkedAppointments?: number;
  oldestWaitMinutes?: number | null;
  /** Open deals left out of every dollar figure because they have no value or no owner. */
  excludedOpen?: number;
  /** Of those, the open deals that sit in a closed-out or ignored stage or in a pipeline marked not in use. */
  outOfScopeOpen?: number;
  /** The largest counted open deal in the account, for the outlier note on dollar cards. */
  topDeal?: number;
  /** The largest counted open deal that has not moved for the stale threshold (for the outlier guard on the stale-deal finding). */
  topStaleDeal?: number;
  locationId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  ignored: boolean;
  owner: string | null;
  contacts: number;
  withEmail: number;
  withPhone: number;
  withTags: number;
  new30d: number;
  active90d: number;
  openOpps: number;
  openValue: number;
  staleOpps: number;
  staleValue: number;
  wonCount: number;
  lostCount: number;
  wonValue: number;
  unread: number;
  unanswered: number;
  calendars: number | null;
  pipelines: number | null;
  lastActivityAt: string | null;
  syncError: string | null;
  contactsSyncedAt: string | null;
};

export type AccountSettings = { staleDays: number; dormantDays: number; slaHours: number; /** Minutes a new lead may wait for a first reply (default 15). */ speedTargetMinutes?: number };

export type DerivedAccount = AccountRow & {
  emailPct: number;
  phonePct: number;
  tagPct: number;
  activePct: number;
  completenessPct: number;
  daysInactive: number | null;
  dormant: boolean;
  score: number;
  /** The label people read: the score's band, held down by the reply delay (healthBand in scoring.ts). */
  band: ScoreBand;
  /** The band the score alone gives. */
  scoreBand: ScoreBand;
  /** One sentence when the reply delay held the label down, else null. */
  bandNote: string | null;
  breakdown: ScoreBreakdown;
  churn: ChurnRisk;
  winRate: number | null;
  avgDealValue: number | null;
  expectedRevenue: number | null;
  revenueAtRisk: number;
  followUpRevenueAtRisk: number | null;
  /** How far new-contact volume has fallen against the account's own recent average (percent), if meaningful. */
  leadFlowDropPct: number | null;
};

const DAY = 86_400_000;

// Compare this month's new contacts with the account's own recent average. Needs a baseline of at
// least 10 so small accounts do not trigger noise, and a drop of at least 50%.
export function leadFlowDrop(current: number, history: number[]): number | null {
  if (history.length < 7) return null;
  const baseline = history.reduce((a, b) => a + b, 0) / history.length;
  if (baseline < 10) return null;
  const drop = Math.round((1 - current / baseline) * 100);
  return drop >= 50 ? drop : null;
}
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export function deriveAccount(
  row: AccountRow,
  settings: AccountSettings,
  history: number[] = [],
  now = Date.now(),
  newContactsHistory: number[] = [],
): DerivedAccount {
  const emailPct = pct(row.withEmail, row.contacts);
  const phonePct = pct(row.withPhone, row.contacts);
  const tagPct = pct(row.withTags, row.contacts);
  const activePct = pct(row.active90d, row.contacts);
  const completenessPct = row.contacts > 0 ? Math.round((emailPct + phonePct + tagPct) / 3) : 0;

  const lastMs = row.lastActivityAt ? Date.parse(row.lastActivityAt) : NaN;
  const daysInactive = Number.isFinite(lastMs) ? Math.max(0, Math.floor((now - lastMs) / DAY)) : null;

  const breakdown = engagementBreakdown({
    contacts: row.contacts,
    newContacts30d: row.new30d,
    openOpportunities: row.openOpps,
    staleOpportunities: row.staleOpps,
    unansweredOverSla: row.unanswered,
    completenessPct,
    daysInactive,
  });
  const score = breakdown.total;
  const health = healthBand(score, row.unanswered);

  const closed = row.wonCount + row.lostCount;
  const winRate = closed >= MIN_CLOSED_DEALS ? row.wonCount / closed : null;
  const avgDealValue =
    row.wonCount > 0 ? row.wonValue / row.wonCount : row.openOpps > 0 ? row.openValue / row.openOpps : null;

  return {
    ...row,
    emailPct, phonePct, tagPct, activePct, completenessPct, daysInactive,
    dormant: isDormant(daysInactive, settings.dormantDays),
    score,
    band: health.band,
    scoreBand: health.scoreBand,
    bandNote: health.why,
    breakdown,
    churn: churnRisk({ score, daysInactive, dormantDays: settings.dormantDays, history }),
    winRate,
    avgDealValue,
    expectedRevenue: winRate !== null ? Math.round(row.openValue * winRate) : null,
    revenueAtRisk: Math.round(row.staleValue),
    followUpRevenueAtRisk:
      row.unanswered > 0 && winRate !== null && avgDealValue !== null
        ? Math.round(row.unanswered * avgDealValue * winRate)
        : null,
    leadFlowDropPct: leadFlowDrop(row.new30d, newContactsHistory),
  };
}

// ---------------- onboarding checklist ----------------

export type ChecklistItem = {
  key: string;
  label: string;
  status: "done" | "todo" | "unknown";
  auto: boolean;
  detail?: string;
};

export const MANUAL_TASKS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "kickoff", label: "Kickoff call completed" },
  { key: "domain", label: "Custom domain connected" },
  { key: "phone", label: "Phone number registered" },
  { key: "training", label: "Client walked through the account" },
];

export function onboardingChecklist(
  a: DerivedAccount,
  opts: {
    domainStatus: "ok" | "warning" | "critical" | "error" | null;
    manual: Record<string, boolean>;
    custom: string[];
  },
): { items: ChecklistItem[]; completionPct: number } {
  const items: ChecklistItem[] = [];
  const auto = (key: string, label: string, done: boolean, detail?: string) =>
    items.push({ key, label, status: done ? "done" : "todo", auto: true, detail });

  auto("profile", "Business profile filled in (name, email, phone)", Boolean(a.name && a.email && a.phone));
  auto("pipeline", "At least one pipeline", (a.pipelines ?? 0) > 0, a.pipelines === null ? "Not synced yet" : undefined);
  auto("contacts", "Contacts imported", a.contacts > 0);
  auto("opportunities", "Deals created", a.openOpps + a.wonCount + a.lostCount > 0);
  auto("calendar", "A calendar is set up", (a.calendars ?? 0) > 0, a.calendars === null ? "Not synced yet" : undefined);
  auto("activity", "Active in the last 14 days", a.daysInactive !== null && a.daysInactive <= 14);

  if (opts.domainStatus === null) {
    items.push({ key: "email_auth", label: "Sending domain authenticated (SPF, DKIM, DMARC)", status: "unknown", auto: true, detail: "Check the account's domain in Email health" });
  } else {
    auto("email_auth", "Sending domain authenticated (SPF, DKIM, DMARC)", opts.domainStatus === "ok", opts.domainStatus === "ok" ? undefined : `Domain check is ${opts.domainStatus}`);
  }
  items.push({ key: "workflows", label: "Workflows built", status: "unknown", auto: true, detail: "The platform's workflow API is not available to every account" });

  for (const t of MANUAL_TASKS) {
    items.push({ key: `manual:${t.key}`, label: t.label, status: opts.manual[`manual:${t.key}`] ? "done" : "todo", auto: false });
  }
  for (const label of opts.custom) {
    const key = `custom:${label}`;
    items.push({ key, label, status: opts.manual[key] ? "done" : "todo", auto: false });
  }

  const known = items.filter((i) => i.status !== "unknown");
  const done = known.filter((i) => i.status === "done").length;
  return { items, completionPct: known.length ? Math.round((done / known.length) * 100) : 0 };
}

// ---------------- alerts ----------------

export type AlertDraft = {
  dedupeKey: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  locationId: string | null;
  title: string;
  detail: Record<string, unknown>;
};

export type DomainStatus = { locationId: string | null; domain: string; status: "ok" | "warning" | "critical" | "error" };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const label = (a: { name: string | null }) => a.name ?? "Unnamed account";

export function computeAlerts(accounts: DerivedAccount[], domains: DomainStatus[], settings: AccountSettings): AlertDraft[] {
  const out: AlertDraft[] = [];
  for (const a of accounts) {
    if (a.ignored) continue;
    const loc = a.locationId;
    if (a.dormant) {
      const severe = a.daysInactive === null || a.daysInactive >= settings.dormantDays * 2;
      out.push({
        dedupeKey: `dormant:${loc}`, kind: "dormant", severity: severe ? "critical" : "warning", locationId: loc,
        title: `${label(a)} looks dormant`,
        detail: { daysInactive: a.daysInactive, threshold: settings.dormantDays },
      });
    } else if (a.churn.level === "high") {
      out.push({
        dedupeKey: `churn:${loc}`, kind: "churn", severity: "critical", locationId: loc,
        title: `${label(a)} is at high churn risk`, detail: { reasons: a.churn.reasons, score: a.score },
      });
    }
    if (a.unanswered > 0) {
      out.push({
        dedupeKey: `sla:${loc}`, kind: "sla", severity: a.unanswered >= 5 ? "critical" : "warning", locationId: loc,
        title: `${label(a)} has ${a.unanswered} conversation${a.unanswered === 1 ? "" : "s"} waiting over ${settings.slaHours}h`,
        detail: { unanswered: a.unanswered, slaHours: settings.slaHours },
      });
    }
    // New leads left waiting. Three or more is a pattern, not one missed text; only the last two days count,
    // because an older lead is not something to rush to any more.
    if ((a.speedWaiting ?? 0) >= 3) {
      const n = a.speedWaiting as number;
      const target = settings.speedTargetMinutes ?? 15;
      out.push({
        dedupeKey: `speed:${loc}`, kind: "speed", severity: n >= 8 ? "critical" : "warning", locationId: loc,
        title: `${label(a)}: ${n} new leads have waited more than ${target} minutes for a reply${a.oldestWaitMinutes ? ` (longest ${fmtDuration(Math.round(a.oldestWaitMinutes * 60))})` : ""}`,
        detail: { waiting: n, targetMinutes: target, oldestWaitMinutes: a.oldestWaitMinutes ?? null },
      });
    }
    // Past appointments nobody marked as held or no-show make the show rate a guess. Five or more is a habit, not one forgotten click.
    if ((a.unmarkedAppointments ?? 0) >= 5) {
      const n = a.unmarkedAppointments as number;
      out.push({
        dedupeKey: `appts:${loc}`, kind: "appointments", severity: n >= 20 ? "critical" : "warning", locationId: loc,
        title: `${label(a)}: ${n} past appointments have no outcome recorded, so the show rate is a guess`,
        detail: { unmarked: n },
      });
    }
    if (a.leadFlowDropPct !== null && !a.dormant) {
      out.push({
        dedupeKey: `leadflow:${loc}`, kind: "leadflow", severity: "warning", locationId: loc,
        title: `${label(a)}: new contacts are down ${a.leadFlowDropPct}% on their recent average`,
        detail: { newContacts30d: a.new30d, dropPct: a.leadFlowDropPct },
      });
    }
    if (a.staleOpps >= 3 && a.openOpps > 0 && a.staleOpps / a.openOpps >= 0.3) {
      out.push({
        dedupeKey: `stale:${loc}`, kind: "stale", severity: "warning", locationId: loc,
        title: `${label(a)} has ${a.staleOpps} stale deals (${money(a.revenueAtRisk)})`,
        detail: { staleOpps: a.staleOpps, openOpps: a.openOpps, value: a.revenueAtRisk, staleDays: settings.staleDays },
      });
    }
    if (a.contacts >= 20 && a.completenessPct < 50) {
      out.push({
        dedupeKey: `quality:${loc}`, kind: "quality", severity: "info", locationId: loc,
        title: `${label(a)} has incomplete contact data (${a.completenessPct}%)`,
        detail: { completenessPct: a.completenessPct },
      });
    }
    if (a.syncError) {
      out.push({
        dedupeKey: `sync:${loc}`, kind: "sync", severity: "warning", locationId: loc,
        title: `${label(a)} could not be synced`, detail: { error: a.syncError },
      });
    }
  }
  for (const d of domains) {
    if (d.status === "critical" || d.status === "warning") {
      out.push({
        dedupeKey: `email:${d.domain}`, kind: "email", severity: d.status === "critical" ? "critical" : "warning",
        locationId: d.locationId, title: `Email authentication ${d.status === "critical" ? "is broken" : "needs attention"} on ${d.domain}`,
        detail: { domain: d.domain, status: d.status },
      });
    }
  }
  return out;
}

// ---------------- digest ----------------

export function buildDigest(agency: string, accounts: DerivedAccount[], openAlerts: number): string {
  const live = accounts.filter((a) => !a.ignored);
  const atRisk = live.filter((a) => a.band === "at_risk" || a.churn.level === "high").sort((x, y) => x.score - y.score).slice(0, 5);
  const stale = live.reduce((s, a) => s + a.revenueAtRisk, 0);
  const waiting = live.reduce((s, a) => s + a.unanswered, 0);
  const lines = [
    `*Weekly summary for ${agency}*`,
    `${live.length} client accounts, ${live.filter((a) => a.dormant).length} dormant, ${openAlerts} open alerts`,
    `${money(stale)} sitting in stale deals, ${waiting} conversations waiting past your reply target`,
  ];
  if (atRisk.length) {
    lines.push("", "*Needs attention*");
    for (const a of atRisk) lines.push(`• ${label(a)}: score ${a.score}${a.churn.reasons[0] ? `, ${a.churn.reasons[0].toLowerCase()}` : ""}`);
  } else {
    lines.push("", "No accounts are at risk this week.");
  }
  return lines.join("\n");
}

// Slack incoming webhooks only; this stops the setting being used to make the server call
// arbitrary URLs.
export function isSlackWebhook(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "hooks.slack.com" && u.pathname.startsWith("/services/");
  } catch {
    return false;
  }
}

// ---------------- CSV ----------------

export type CsvColumn<T> = { label: string; value: (row: T) => unknown };

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : value instanceof Date ? value.toISOString() : String(value);
  // Stop spreadsheet formula injection from customer-controlled text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: Array<CsvColumn<T>>): string {
  const header = columns.map((c) => cell(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))).join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}
