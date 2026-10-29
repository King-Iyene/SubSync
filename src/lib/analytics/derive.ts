// Pure analytics on top of per-account counts: completeness, activity, score, churn risk,
// revenue figures, onboarding checklist, alert rules, the Slack digest and CSV export.

import {
  churnRisk, engagementBreakdown, isDormant, scoreBand,
  type ChurnRisk, type ScoreBand, type ScoreBreakdown,
} from "../scoring.ts";

export type AccountRow = {
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

export type AccountSettings = { staleDays: number; dormantDays: number; slaHours: number };

export type DerivedAccount = AccountRow & {
  emailPct: number;
  phonePct: number;
  tagPct: number;
  activePct: number;
  completenessPct: number;
  daysInactive: number | null;
  dormant: boolean;
  score: number;
  band: ScoreBand;
  breakdown: ScoreBreakdown;
  churn: ChurnRisk;
  winRate: number | null;
  avgDealValue: number | null;
  expectedRevenue: number | null;
  revenueAtRisk: number;
  followUpRevenueAtRisk: number | null;
};

const DAY = 86_400_000;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export function deriveAccount(
  row: AccountRow,
  settings: AccountSettings,
  history: number[] = [],
  now = Date.now(),
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

  const closed = row.wonCount + row.lostCount;
  const winRate = closed >= 5 ? row.wonCount / closed : null;
  const avgDealValue =
    row.wonCount > 0 ? row.wonValue / row.wonCount : row.openOpps > 0 ? row.openValue / row.openOpps : null;

  return {
    ...row,
    emailPct, phonePct, tagPct, activePct, completenessPct, daysInactive,
    dormant: isDormant(daysInactive, settings.dormantDays),
    score,
    band: scoreBand(score),
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
    `*SubSync weekly summary for ${agency}*`,
    `${live.length} client accounts, ${live.filter((a) => a.dormant).length} dormant, ${openAlerts} open alerts`,
    `${money(stale)} sitting in stale deals, ${waiting} conversations waiting past the SLA`,
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
