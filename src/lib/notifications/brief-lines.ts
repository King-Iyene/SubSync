// The lines under the wording of the daily brief and the weekly summary: what changed, which accounts need you, how many are fine. Pure (types only from
// the digest module), so the words are unit tested. The wording above the lines (the title and the intro) is the person's own, edited in Notifications.

import type { Headline } from "../analytics/digest-intel.ts";

type Attention = { name: string; items: Array<{ title: string }> };

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** "Open pipeline: $184,000 (+4% vs yesterday)". A percentage is only shown when it was measurable (the digest withholds it on a tiny base). */
export function headlineBit(h: Headline, versus: "yesterday" | "average"): string {
  const c = h.change;
  const value = h.money ? money(c.today) : String(Math.round(c.today));
  const pct = versus === "yesterday" ? c.vsYesterday : c.vsAvg;
  return `${h.label}: ${value}${pct === null ? "" : ` (${pct > 0 ? "+" : ""}${pct}% vs ${versus === "yesterday" ? "yesterday" : "the last 7 days"})`}`;
}

export type BriefInput = { headlines: Headline[]; attention: Attention[]; fine: number; freshnessLabel: string };

/** The daily brief's lines. */
export function dailyLines(d: BriefInput, limit = 6): string[] {
  const out: string[] = [];
  for (const h of d.headlines) out.push(headlineBit(h, "yesterday"));
  if (d.attention.length === 0) out.push("Nothing needs attention today. Every account is within its own normal range.");
  else {
    out.push(`${plural(d.attention.length, "account")} need${d.attention.length === 1 ? "s" : ""} attention:`);
    for (const a of d.attention.slice(0, limit)) out.push(`${a.name}: ${a.items[0]?.title ?? "Needs a look"}${a.items[1] ? `; ${a.items[1].title.toLowerCase()}` : ""}`);
    if (d.attention.length > limit) out.push(`...and ${d.attention.length - limit} more in the app`);
  }
  if (d.fine > 0) out.push(`${plural(d.fine, "account")} fine.`);
  out.push(`${d.freshnessLabel}.`);
  return out;
}

/** The weekly summary's lines: the same numbers measured against the last 7 days, the week's plain facts, and who needs you. */
export function weeklyLines(d: BriefInput & { facts: string[] }, limit = 8): string[] {
  const out: string[] = [];
  for (const h of d.headlines) out.push(headlineBit(h, "average"));
  if (d.facts.length) out.push("The last 14 days:", ...d.facts);
  if (d.attention.length === 0) out.push("Every account is within its own normal range.");
  else {
    out.push("Needs attention:");
    for (const a of d.attention.slice(0, limit)) out.push(`${a.name}: ${a.items[0]?.title ?? "Needs a look"}`);
    if (d.attention.length > limit) out.push(`...and ${d.attention.length - limit} more in the app`);
  }
  if (d.fine > 0) out.push(`${plural(d.fine, "account")} fine.`);
  return out;
}

/** "2 Nov" for the {date} variable, in the person's own zone. */
export function shortDate(now: Date, zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short" }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(now);
  }
}
