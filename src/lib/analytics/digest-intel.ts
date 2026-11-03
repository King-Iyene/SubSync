// The daily digest: what changed, what needs attention today, and what is fine. Pure logic (no
// database or network imports) so it can be unit tested.
//
// Every comparison is against THAT account's own recent history, not one global threshold, so a
// quiet account is not flagged for being quiet and a busy account is flagged when it drops.

import { inSendWindow } from "../sync/schedule.ts";
import { MIN_BASE_FOR_PERCENT, MIN_MONEY_BASE_FOR_PERCENT, percentChange } from "./metrics.ts";

export type SeriesPoint = {
  day: string; // YYYY-MM-DD, oldest first; the last point is today
  contacts: number; new30: number; openOpps: number; openValue: number; stale: number; unread: number; completeness: number; score: number;
  /** False when this day's deal figures were counted under older rules (definitions.ts). Those days are not compared with today for deal figures. */
  dealsOk?: boolean;
};

/** The figures that depend on how deals are counted. Only days counted the same way as today are compared for these. */
const DEAL_KEYS = new Set<string>(["openOpps", "openValue", "stale", "score"]);
const sameRules = (points: SeriesPoint[], key: string) => (DEAL_KEYS.has(key) ? points.filter((p) => p.dealsOk !== false) : points);

export type Change = {
  today: number;
  yesterday: number | null;
  avg7: number | null;
  /** Percent change against yesterday, or null when there is no yesterday or it was too small to measure a percentage against (N6). */
  vsYesterday: number | null;
  vsAvg: number | null;
  /** Today minus yesterday: what to show when the percentage is withheld because the base is small. Null when there is no yesterday. */
  diffYesterday: number | null;
  /** True when yesterday's figure exists but was below the minimum for a percentage. */
  smallBase: boolean;
  /** "up" or "down" only when today is outside this account's own normal range. */
  unusual: "up" | "down" | null;
  samples: number;
};

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const pct = (now: number, then: number | null, minBase: number) => percentChange(now, then, minBase);

// `history` is the earlier days (oldest first, today excluded). `minAbs` stops tiny numbers from
// looking dramatic (going from 1 to 2 contacts is not news).
// `minBase`: a percentage is shown only when the figure it is measured against was at least this big ("-100% vs yesterday" on 2 contacts says nothing).
export function compare(history: number[], today: number, minAbs = 3, minBase = MIN_BASE_FOR_PERCENT): Change {
  const last7 = history.slice(-7);
  const yesterday = history.length ? history[history.length - 1] : null;
  const avg7 = last7.length ? mean(last7) : null;
  let unusual: Change["unusual"] = null;
  if (last7.length >= 4 && avg7 !== null) {
    const band = Math.max(2 * sd(last7), 0.15 * Math.abs(avg7), minAbs);
    if (today - avg7 > band) unusual = "up";
    else if (avg7 - today > band) unusual = "down";
  }
  return {
    today, yesterday, avg7: avg7 === null ? null : Math.round(avg7 * 10) / 10, vsYesterday: pct(today, yesterday, minBase), vsAvg: pct(today, avg7, minBase), unusual, samples: last7.length,
    diffYesterday: yesterday === null ? null : Math.round((today - yesterday) * 10) / 10, smallBase: yesterday !== null && yesterday < minBase,
  };
}

export const seriesOf = (points: SeriesPoint[], key: keyof Omit<SeriesPoint, "day" | "dealsOk">) => points.map((p) => p[key]);
export const changeOf = (all: SeriesPoint[], key: keyof Omit<SeriesPoint, "day" | "dealsOk">, minAbs?: number, minBase?: number): Change | null => {
  const points = sameRules(all, key);
  return points.length === 0 ? null : compare(seriesOf(points.slice(0, -1), key), points[points.length - 1][key], minAbs, minBase);
};

// ---------- attention items ----------

export type Item = { kind: string; weight: number; title: string; detail: string };

export type AccountInput = {
  locationId: string;
  name: string;
  series: SeriesPoint[];
  unanswered: number;
  oldestWaitingHours: number | null;
  slaHours: number;
  staleCount: number;
  staleValue: number;
  dormant: boolean;
  daysInactive: number | null;
  emailStatus: "ok" | "warning" | "critical" | "unchecked";
  syncError: string | null;
  lastSyncedAt: string | null;
  pipelines: number | null;
  noShows3d?: number;
  unconfirmed48?: number;
};

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function attentionItems(a: AccountInput, now = Date.now()): Item[] {
  const items: Item[] = [];
  const stale = changeOf(a.series, "stale");
  const fresh = changeOf(a.series, "new30", 5);
  const score = changeOf(a.series, "score", 4);

  if (a.syncError) {
    items.push({ kind: "sync", weight: 80, title: "SubSync could not read this account", detail: `${a.syncError.slice(0, 120)}. Numbers below may be out of date. Check the app is still installed there.` });
  } else if (a.lastSyncedAt && now - Date.parse(a.lastSyncedAt) > 36 * 3_600_000) {
    items.push({ kind: "sync", weight: 60, title: "This account's data is more than a day old", detail: `Last read ${Math.round((now - Date.parse(a.lastSyncedAt)) / 3_600_000)} hours ago.` });
  }
  if (a.unanswered > 0) {
    const oldest = a.oldestWaitingHours;
    items.push({
      kind: "sla", weight: Math.min(95, 40 + a.unanswered * 3 + (oldest ? Math.min(30, oldest / 24) : 0)),
      title: `${plural(a.unanswered, "conversation")} waiting past your ${a.slaHours}h reply target`,
      detail: oldest ? `The oldest has waited ${oldest >= 48 ? Math.round(oldest / 24) + " days" : oldest + " hours"}.` : "Reply to the oldest first.",
    });
  }
  if (a.dormant) {
    items.push({ kind: "dormant", weight: 70, title: "No activity for a long time", detail: a.daysInactive !== null ? `Nothing for ${a.daysInactive} days. Check in with the client.` : "No activity recorded yet." });
  }
  if (stale?.unusual === "up") {
    items.push({ kind: "stale_jump", weight: 62, title: `More deals are going stale than usual (${stale.today} vs about ${Math.round(stale.avg7 ?? 0)})`, detail: `${money(a.staleValue)} is sitting in stale deals. Move them forward or close them out.` });
  } else if (a.staleCount >= 5 && a.staleValue > 0) {
    items.push({ kind: "stale", weight: 35 + Math.min(20, a.staleValue / 50_000), title: `${plural(a.staleCount, "stale deal")} worth ${money(a.staleValue)}`, detail: "No movement for a while. These are the likeliest lost revenue." });
  }
  if (fresh?.unusual === "down") {
    items.push({ kind: "lead_drop", weight: 55, title: "New leads are below this account's normal", detail: `${fresh.today} new contacts in 30 days, against a usual ${Math.round(fresh.avg7 ?? 0)}. Check ads, forms and tracking.` });
  }
  if (score?.unusual === "down" && (score.avg7 ?? 0) - score.today >= 4) {
    items.push({ kind: "score_drop", weight: 50, title: `Engagement score fell to ${score.today} (usually ${Math.round(score.avg7 ?? 0)})`, detail: "Something changed in the last day or two. Open the account to see which part of the score dropped." });
  }
  if (a.emailStatus === "critical" || a.emailStatus === "warning") {
    items.push({ kind: "email", weight: a.emailStatus === "critical" ? 65 : 40, title: "Email sending setup needs fixing", detail: "Sender authentication is failing or incomplete, so emails may land in spam." });
  }
  if ((a.noShows3d ?? 0) >= 2) {
    items.push({ kind: "noshow", weight: 52 + Math.min(20, (a.noShows3d ?? 0) * 3), title: `${a.noShows3d} no-shows in the last 3 days`, detail: "Call them while the booking is fresh: most will rebook if asked today." });
  }
  if ((a.unconfirmed48 ?? 0) >= 3) {
    items.push({ kind: "unconfirmed", weight: 38, title: `${a.unconfirmed48} appointments in the next 2 days are unconfirmed`, detail: "A reminder now cuts no-shows." });
  }
  if (a.pipelines === 0) items.push({ kind: "setup", weight: 25, title: "No pipeline set up yet", detail: "Without a pipeline there is no deal tracking for this client." });
  return items.sort((x, y) => y.weight - x.weight);
}

export type Attention = {
  locationId: string; name: string; weight: number; severity: "critical" | "warning" | "info"; items: Item[];
};

// Only items heavy enough to matter are listed; an account with none is "fine".
export const THRESHOLD = 30;

export function rank(accounts: AccountInput[], now = Date.now()): { attention: Attention[]; fine: Array<{ locationId: string; name: string; checked: string[]; learning: boolean }> } {
  const attention: Attention[] = [];
  const fine: Array<{ locationId: string; name: string; checked: string[]; learning: boolean }> = [];
  for (const a of accounts) {
    const items = attentionItems(a, now).filter((i) => i.weight >= THRESHOLD);
    if (items.length === 0) {
      fine.push({
        locationId: a.locationId, name: a.name, learning: a.series.length < 5,
        checked: ["reply times", "deal movement", "new leads", "activity", "email setup", "data freshness"],
      });
      continue;
    }
    const weight = Math.round(items[0].weight + items.slice(1, 3).reduce((s, i) => s + i.weight * 0.2, 0));
    attention.push({ locationId: a.locationId, name: a.name, weight, severity: items[0].weight >= 70 ? "critical" : items[0].weight >= 45 ? "warning" : "info", items: items.slice(0, 4) });
  }
  attention.sort((x, y) => y.weight - x.weight);
  return { attention, fine };
}

// ---------- the portfolio-level "what changed" strip ----------

export type Headline = { key: string; label: string; money: boolean; change: Change };

export function portfolioHeadlines(perAccount: SeriesPoint[][]): Headline[] {
  if (perAccount.every((s) => s.length === 0)) return [];
  const make = (key: keyof Omit<SeriesPoint, "day" | "dealsOk">, label: string, isMoney: boolean, minAbs: number): Headline => {
    // A deal figure is summed only over days counted under today's rules: a day counted the old way is not a day to compare with.
    const lists = perAccount.map((s) => sameRules(s, key));
    const days = [...new Set(lists.flatMap((s) => s.map((p) => p.day)))].sort();
    const values = days.map((d) => lists.reduce((s, series) => s + ((series.find((p) => p.day === d)?.[key] as number | undefined) ?? 0), 0));
    return { key, label, money: isMoney, change: compare(values.slice(0, -1), values[values.length - 1] ?? 0, minAbs, isMoney ? MIN_MONEY_BASE_FOR_PERCENT : MIN_BASE_FOR_PERCENT) };
  };
  return [
    make("openValue", "Open pipeline", true, 5000),
    make("stale", "Stale deals", false, 3),
    make("new30", "New contacts (30 days)", false, 5),
    make("unread", "Unread conversations", false, 3),
  ];
}

// ---------- text for Slack ----------

export function digestText(agency: string, d: { attention: Attention[]; fine: number; headlines: Headline[]; freshnessLabel: string }, appUrl: string): string {
  const lines = [`*Daily brief for ${agency}*`];
  const bit = (h: Headline) => {
    const c = h.change;
    const v = h.money ? money(c.today) : String(Math.round(c.today));
    const arrow = c.vsYesterday === null ? "" : ` (${c.vsYesterday > 0 ? "+" : ""}${c.vsYesterday}% vs yesterday)`;
    return `${h.label}: ${v}${arrow}`;
  };
  lines.push(d.headlines.map(bit).join(" · "));
  if (d.attention.length === 0) {
    lines.push("", "Nothing needs attention today. Every account is within its own normal range.");
  } else {
    lines.push("", `*${plural(d.attention.length, "account")} need${d.attention.length === 1 ? "s" : ""} attention*`);
    for (const a of d.attention.slice(0, 6)) {
      lines.push(`• *${a.name}*: ${a.items[0].title}${a.items[1] ? `; ${a.items[1].title.toLowerCase()}` : ""}`);
    }
    if (d.attention.length > 6) lines.push(`…and ${d.attention.length - 6} more in the app`);
  }
  if (d.fine > 0) lines.push("", `${plural(d.fine, "account")} fine.`);
  lines.push(`_${d.freshnessLabel}._ ${appUrl}/app#today`);
  return lines.join("\n");
}

// ---------- scheduling ----------

// The local hour (0 to 23), calendar date and weekday in a time zone, or null when the zone is not valid. Daylight-saving changes are the
// platform's own (Intl), so a spring-forward day has no 02:00 hour and a fall-back day has 01:00 twice; the callers cope (see inSendWindow and the
// once-a-day check on the date).
export function localClock(now: Date, timeZone: string): { hour: number; date: string; weekday: string } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hour: "2-digit", hour12: false, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return { hour: Number(get("hour")) % 24, date: `${get("year")}-${get("month")}-${get("day")}`, weekday: get("weekday") };
  } catch {
    return null;
  }
}

// The local hour (0 to 23) and calendar date in a time zone, or null when the zone is not valid.
export function localParts(now: Date, timeZone: string): { hour: number; date: string } | null {
  const c = localClock(now, timeZone);
  return c ? { hour: c.hour, date: c.date } : null;
}

// Is it time to send? True from the chosen local hour until SEND_CATCHUP_HOURS later if today's digest has not gone out yet, so a scheduler run
// that is a few minutes late (or skipped once) still sends the same morning, but a brief chosen for 08:00 is never sent in the evening.
export function dueNow(now: Date, timeZone: string, hour: number, lastSentOn: string | null): boolean {
  const local = localParts(now, timeZone);
  if (!local) return false;
  return inSendWindow(local.hour, hour) && lastSentOn !== local.date;
}
