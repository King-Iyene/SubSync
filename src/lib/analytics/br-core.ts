import { digestDue } from "./cash-intel.ts";

// The 7 am brief, pure rules (no database, unit tested). ONE calm brief per agency owner: the five things that need attention today across the modules, each with a one-line why and a link to
// the exact list, and one dollar line. Built only from numbers SubSync already computes; this file only chooses, ranks and words them. Definitions: docs/METRICS.md "The 7 am brief".
// Every dollar figure is an ESTIMATE and says so. Nothing here changes the CRM or messages a lead. No vendor words: "client accounts", "your CRM".

export const SECTIONS = ["attention", "save", "recover", "deals", "wallet", "payments"] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABEL: Record<Section, string> = {
  attention: "Needs a look today", save: "Accounts to save", recover: "Missed leads to win back", deals: "Deals going quiet", wallet: "Credit balances", payments: "Payments at risk",
};
export const BRIEF_MAX = 5;

export type BriefItem = {
  key: string; section: Section; title: string; why: string; count: number;
  /** Estimated dollars behind the item, or null when there is no honest figure. */
  dollars: number | null;
  /** 1 = something stops working today, 2 = money is at risk, 3 = people are waiting, 4 = tidy-up. */
  tier: 1 | 2 | 3 | 4;
  /** The hash address of the exact list in the app, for example "#today?tab=recover". */
  hash: string;
};

export type BriefInputs = {
  /** Today's ranked items (the same list the Today screen shows). */
  attention: Array<{ kind: string; label: string; why: string; count: number; accounts: number; money: number | null; hash: string; topName: string | null }>;
  save: { accounts: Array<{ locationId: string; name: string; evidence: string[]; dollarText: string; hash: string }>; more: number } | null;
  recover: { total: number; estValue: number | null } | null;
  deals: { slipping: number; value: number | null; lost: number; lostNoReason: number } | null;
  wallet: { empty: number; low: number; spike: number; names: string[] } | null;
  payments: { count: number; amount: number | null } | null;
  accounts: number;
};

export type Brief = {
  day: string; headline: string; items: BriefItem[]; more: number;
  dollar: { amount: number | null; text: string }; formula: string; accounts: number;
  /** Per section how many candidate items there were, so a person can see what a switched-off section would have said. */
  bySection: Record<Section, number>;
};

export const FORMULA =
  "Adds the estimates of missed leads, deals past their usual time in a stage, and failed or late payments. A deal that is in two lists may be counted twice, so read it as a ceiling, not a promise. Each part is an estimate from your own history.";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const s = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
/** Today kinds that another section of the brief already covers, so one problem never appears twice. */
const COVERED_BY: Record<string, Section> = { waiting_old: "recover", waiting: "recover", noshows: "recover", stale_deals: "deals" };

/** Every candidate item for the sections a person kept switched on. Pure. */
export function candidates(i: BriefInputs, on: ReadonlySet<Section>): BriefItem[] {
  const out: BriefItem[] = [];
  if (on.has("wallet") && i.wallet) {
    const w = i.wallet, who = w.names.slice(0, 2).join(", ");
    if (w.empty > 0) out.push({ key: "wallet_empty", section: "wallet", title: `${s(w.empty, "client account has", "client accounts have")} run out of credit`, why: `Texts, calls and emails can stop until it is topped up${who ? ` (${who}${w.empty > 2 ? "..." : ""})` : ""}.`, count: w.empty, dollars: null, tier: 1, hash: "#clients?tab=wallet" });
    if (w.low > 0) out.push({ key: "wallet_low", section: "wallet", title: `${s(w.low, "client account is", "client accounts are")} running low on credit`, why: "At the usual spend they run out soon (estimate).", count: w.low, dollars: null, tier: 2, hash: "#clients?tab=wallet" });
    if (w.spike > 0) out.push({ key: "wallet_spike", section: "wallet", title: `${s(w.spike, "client account is", "client accounts are")} spending far more than usual`, why: "A surprise bill is building. Open the account to see what the credit went on.", count: w.spike, dollars: null, tier: 3, hash: "#clients?tab=wallet" });
  }
  if (on.has("payments") && i.payments && i.payments.count > 0) {
    const p = i.payments;
    out.push({ key: "payments", section: "payments", title: `${s(p.count, "payment has", "payments have")} failed or gone late`, why: "Chase them before they are written off.", count: p.count, dollars: p.amount, tier: 2, hash: "#payments" });
  }
  if (on.has("recover") && i.recover && i.recover.total > 0) {
    out.push({ key: "recover", section: "recover", title: `${s(i.recover.total, "person is", "people are")} waiting to be won back`, why: "They wrote, called or booked and nobody followed up.", count: i.recover.total, dollars: i.recover.estValue, tier: 2, hash: "#today?tab=recover" });
  }
  if (on.has("deals") && i.deals && i.deals.slipping > 0) {
    out.push({ key: "deals", section: "deals", title: `${s(i.deals.slipping, "deal is", "deals are")} past their usual time in a stage`, why: "They have gone quiet for longer than your usual deals do.", count: i.deals.slipping, dollars: i.deals.value, tier: 2, hash: "#pipeline" });
  }
  if (on.has("save") && i.save) {
    for (const a of i.save.accounts.slice(0, 2)) out.push({ key: `save:${a.locationId}`, section: "save", title: `Save ${a.name}`, why: `${a.evidence.slice(0, 2).join("; ")}.`, count: 1, dollars: null, tier: 2, hash: a.hash });
  }
  if (on.has("attention")) {
    for (const a of i.attention) {
      const cover = COVERED_BY[a.kind];
      if (cover && on.has(cover)) continue;
      out.push({ key: `today:${a.kind}`, section: "attention", title: a.label, why: a.why, count: a.count, dollars: a.money, tier: a.kind === "waiting_old" || a.kind === "needs_permission" ? 2 : a.kind === "unmarked" || a.kind === "waiting" || a.kind === "noshows" ? 3 : 4, hash: a.hash });
    }
  }
  return out;
}

const bySection = (items: readonly BriefItem[]): Record<Section, number> => Object.fromEntries(SECTIONS.map((x) => [x, items.filter((y) => y.section === x).length])) as Record<Section, number>;

/** The brief: the BRIEF_MAX most important candidates (stops working today first, then money at risk, then people waiting, then tidy-up; within a tier the most dollars first), the dollar line, one headline. Pure. */
export function buildBrief(i: BriefInputs, on: ReadonlySet<Section>, day: string): Brief {
  const all = candidates(i, on);
  const ranked = all.slice().sort((a, b) => a.tier - b.tier || (b.dollars ?? -1) - (a.dollars ?? -1) || b.count - a.count || a.title.localeCompare(b.title));
  const items = ranked.slice(0, BRIEF_MAX);
  const dollarParts = all.filter((x) => (x.section === "recover" || x.section === "deals" || x.section === "payments") && x.dollars !== null && x.dollars > 0).map((x) => x.dollars as number);
  const amount = dollarParts.length ? dollarParts.reduce((t, x) => t + x, 0) : null;
  const dollar = { amount, text: amount !== null ? `Up to about ${money(amount)} could be at stake across these lists (estimate).` : all.length ? "No dollar estimate yet: not enough deal history in these accounts." : "Nothing to estimate." };
  const headline = i.accounts === 0 ? "No client accounts yet." : items.length === 0 ? "Nothing needs you today. Every list is clear." : items.length === 1 && all.length === 1 ? "One thing needs you today." : `${items.length}${all.length > items.length ? ` of ${all.length}` : ""} things need you today.`;
  return { day, headline, items, more: Math.max(0, all.length - items.length), dollar, formula: FORMULA, accounts: i.accounts, bySection: bySection(all) };
}

// ---- words ----

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const link = (base: string, it: BriefItem) => `${base.replace(/\/+$/, "")}/app${it.hash}`;

/** Plain text, for the email's text part, for pasting into a message or for a client. No links that carry anyone's data. */
export function briefText(b: Brief, base: string): string {
  const out = [b.headline, ""];
  b.items.forEach((it, n) => out.push(`${n + 1}. ${it.title}`, `   ${it.why}${it.dollars !== null && it.dollars > 0 ? ` About ${money(it.dollars)} (estimate).` : ""}`, `   Open the list: ${link(base, it)}`, ""));
  if (b.more > 0) out.push(`And ${b.more} more in the app: ${base.replace(/\/+$/, "")}/app#today`, "");
  out.push(b.dollar.text);
  return out.join("\n");
}

/** The same brief as chat markup (bold with asterisks, links as <address|words>), to paste into Slack. */
export function briefSlack(b: Brief, base: string): string {
  const out = [`*${b.headline}*`, ""];
  b.items.forEach((it, n) => out.push(`${n + 1}. *${it.title}*`, `${it.why}${it.dollars !== null && it.dollars > 0 ? ` About ${money(it.dollars)} (estimate).` : ""} <${link(base, it)}|Open the list>`, ""));
  if (b.more > 0) out.push(`And ${b.more} more in the app.`);
  out.push(`_${b.dollar.text}_`);
  return out.join("\n");
}

export function briefEmail(b: Brief, o: { appUrl: string; stopUrl: string; settingsUrl: string }): { subject: string; text: string; html: string } {
  const subject = b.items.length === 0 ? "Your 7 am brief: nothing needs you today" : `Your 7 am brief: ${b.headline.replace(/\.$/, "")}`;
  const html: string[] = [`<p style="margin:0 0 14px;font-size:16px"><b>${esc(b.headline)}</b></p>`];
  b.items.forEach((it, n) => html.push(`<div style="margin:0 0 12px;padding:12px;border:1px solid #ddd;border-radius:8px"><b>${n + 1}. ${esc(it.title)}</b><p style="margin:6px 0;color:#444">${esc(it.why)}${it.dollars !== null && it.dollars > 0 ? ` About ${esc(money(it.dollars))} (estimate).` : ""}</p><a href="${esc(link(o.appUrl, it))}" style="display:inline-block;padding:8px 14px;background:#1a56db;color:#fff;border-radius:6px;text-decoration:none">Open the list</a></div>`));
  if (b.more > 0) html.push(`<p>And ${b.more} more. <a href="${esc(o.appUrl.replace(/\/+$/, ""))}/app#today">Open your list</a>.</p>`);
  html.push(`<p style="margin:12px 0;color:#444">${esc(b.dollar.text)}</p>`);
  const foot = "You get one brief a day, at the time you chose. Dollar figures are estimates. Nothing here changes your CRM or messages your leads.";
  html.push(`<p style="color:#777;font-size:12px">${esc(foot)} <a href="${esc(o.settingsUrl)}">Change the time or sections</a>. <a href="${esc(o.stopUrl)}">Stop these emails</a>.</p>`);
  return { subject, text: `${briefText(b, o.appUrl)}\n\n${foot}\nChange the time or sections: ${o.settingsUrl}\nStop these emails: ${o.stopUrl}`, html: html.join("") };
}

// ---- when it goes ----

/** True at the person's chosen hour of their own day (or up to 2 hours late), not on a quiet weekday, once per local day. Safe to call every hour. */
export const briefDue = (nowMs: number, tz: string, hour: number, quietDays: readonly number[], lastKey: string | null) => digestDue(nowMs, tz, hour, quietDays, null, null, lastKey);

/** The sections a person kept on, from stored text. Anything unknown is dropped; an empty list means every section. */
export function sectionsOf(v: unknown): Set<Section> {
  const list = Array.isArray(v) ? v.filter((x): x is Section => (SECTIONS as readonly string[]).includes(String(x))) : [];
  return new Set(list.length ? list : SECTIONS);
}
