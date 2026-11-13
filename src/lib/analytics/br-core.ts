import { digestDue } from "./cash-intel.ts";
import type { DomainSource } from "../links.ts";
import { resolveTarget, wordsLink, viewOfHash, linkText, linkHtml, type Resolved } from "../notifications/crm-links.ts";

// The 7 am brief, pure rules (no database, unit tested). ONE calm brief per agency owner: the five things that need attention today across the modules, each with a one-line why and a link to
// the exact list, and one dollar line. Built only from numbers SubSync already computes; this file only chooses, ranks and words them. Definitions: docs/METRICS.md "The 7 am brief".
// Every dollar figure is an ESTIMATE and says so. Nothing here changes the CRM or messages a lead. No vendor words: "client accounts", "your CRM".

export const SECTIONS = ["attention", "save", "recover", "deals", "wallet", "payments", "finance"] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABEL: Record<Section, string> = {
  attention: "Needs a look today", save: "Accounts to save", recover: "Missed leads to win back", deals: "Deals going quiet", wallet: "Credit balances", payments: "Payments at risk", finance: "Money and accounts that may leave",
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
  attention: Array<{ kind: string; label: string; why: string; count: number; accounts: number; money: number | null; hash: string; topName: string | null; /** Hours the oldest thing behind the count has waited, when known. */ oldestHours?: number | null }>;
  save: { accounts: Array<{ locationId: string; name: string; evidence: string[]; dollarText: string; hash: string }>; more: number } | null;
  recover: { total: number; estValue: number | null } | null;
  deals: { slipping: number; value: number | null; lost: number; lostNoReason: number } | null;
  wallet: { empty: number; low: number; spike: number; names: string[] } | null;
  payments: { count: number; amount: number | null } | null;
  /** Finance (stage FN): accounts that look likely to leave (with the monthly plan price behind them) and billing notes that are overdue. Optional: absent while Finance is off. */
  finance?: { highRisk: number; highRiskMrr: { amount: number; currency: string } | null; overdue: number; overdueTotal: { amount: number; currency: string } | null } | null;
  /** Clients ignoring leads (flag sp_ignored_leads): accounts past their own threshold and the people behind them. Absent while the flag is off. */
  ignored?: { accounts: number; people: number; names: string[] } | null;
  accounts: number;
};

export type Brief = {
  day: string; /** The day in plain words, for example "Thursday 12 Nov". */ dayText: string; headline: string; items: BriefItem[]; more: number;
  dollar: { amount: number | null; text: string }; formula: string; accounts: number;
  /** Per section how many candidate items there were, so a person can see what a switched-off section would have said. */
  bySection: Record<Section, number>;
};

export const FORMULA =
  "Adds the estimates of missed leads, deals past their usual time in a stage, and failed or late payments. A deal that is in two lists may be counted twice, so read it as a ceiling, not a promise. Each part is an estimate from your own history.";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-12" as "Thursday 12 Nov". Anything that is not a day is returned unchanged. */
export function dayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** Hours as the plain age of the oldest item: "5 hours", "3 days". */
export function ageWords(h: number): string { return h < 1 ? "under an hour" : h < 48 ? `${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}` : `${Math.round(h / 24)} days`; }
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const s = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
/** Today kinds that another section of the brief already covers, so one problem never appears twice. */
const COVERED_BY: Record<string, Section> = { waiting_old: "recover", waiting: "recover", noshows: "recover", stale_deals: "deals" };

/** Every candidate item for the sections a person kept switched on. Pure. */
export function candidates(i: BriefInputs, on: ReadonlySet<Section>): BriefItem[] {
  const out: BriefItem[] = [], saveEv = new Map<string, string[]>();
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
  if (on.has("finance") && i.finance) {
    const f = i.finance, cash = (m: { amount: number; currency: string }) => (m.currency === "USD" ? money(m.amount) : `${Math.round(m.amount).toLocaleString("en-US")} ${m.currency}`);
    if (f.highRisk > 0) out.push({ key: "finance_churn", section: "finance", title: `${s(f.highRisk, "client account looks", "client accounts look")} likely to leave`, why: `${f.highRiskMrr ? `About ${cash(f.highRiskMrr)} a month in plans (estimate). ` : ""}Open the watch list and call the first one.`, count: f.highRisk, dollars: null, tier: 2, hash: "#finance" });
    if (f.overdue > 0) out.push({ key: "finance_overdue", section: "finance", title: `${s(f.overdue, "billing note is", "billing notes are")} overdue`, why: `${f.overdueTotal ? `${cash(f.overdueTotal)} is waiting to come in. ` : ""}These are your own notes: send the reminders yourself.`, count: f.overdue, dollars: null, tier: 2, hash: "#finance" });
  }
  if (on.has("recover") && i.recover && i.recover.total > 0) {
    out.push({ key: "recover", section: "recover", title: `${s(i.recover.total, "person is", "people are")} waiting to be won back`, why: "They wrote, called or booked and nobody followed up.", count: i.recover.total, dollars: i.recover.estValue, tier: 2, hash: "#today?tab=recover" });
  }
  if (on.has("deals") && i.deals && i.deals.slipping > 0) {
    out.push({ key: "deals", section: "deals", title: `${s(i.deals.slipping, "deal is", "deals are")} past their usual time in a stage`, why: "They have gone quiet for longer than your usual deals do.", count: i.deals.slipping, dollars: i.deals.value, tier: 2, hash: "#pipeline" });
  }
  if (on.has("save") && i.save) {
    for (const a of i.save.accounts.slice(0, 2)) saveEv.set(`save:${a.locationId}`, a.evidence), out.push({ key: `save:${a.locationId}`, section: "save", title: `Save ${a.name}`, why: `${a.evidence.slice(0, 2).join("; ")}.`, count: 1, dollars: null, tier: 2, hash: a.hash });
  }
  if (on.has("attention") && i.ignored && i.ignored.people > 0) {
    const g = i.ignored;
    out.push({ key: "ignored_leads", section: "attention", title: `${s(g.accounts, "client account is", "client accounts are")} not answering ${g.people.toLocaleString("en-US")} ${g.people === 1 ? "person" : "people"}`, why: `${g.names.slice(0, 2).join(", ")}${g.accounts > 2 ? " and more" : ""}: leads, replies and missed calls nobody has answered.`, count: g.people, dollars: null, tier: 2, hash: "#speed?tab=ignored" });
  }
  if (on.has("attention")) {
    for (const a of i.attention) {
      const cover = COVERED_BY[a.kind];
      if (cover && on.has(cover)) continue;
      out.push({ key: `today:${a.kind}`, section: "attention", title: a.label, why: a.oldestHours ? `${a.why} The oldest has waited ${ageWords(a.oldestHours)}.` : a.why, count: a.count, dollars: a.money, tier: a.kind === "waiting_old" || a.kind === "needs_permission" ? 2 : a.kind === "unmarked" || a.kind === "waiting" || a.kind === "noshows" ? 3 : 4, hash: a.hash });
    }
  }
  // One fact, one place: a Save line that only repeats a number another item already shows (for example "23 appointments with no outcome") is cut; a Save item with nothing new left is dropped.
  const facts = out.filter((x) => x.section !== "save").map((x) => x.count).filter((n) => n >= 2);
  const repeats = (e: string) => (e.match(/\d[\d,]*/g) ?? []).map((t) => Number(t.replace(/,/g, ""))).some((n) => n >= 2 && facts.includes(n));
  return out.flatMap((x) => { if (x.section !== "save") return [x]; const ev = (saveEv.get(x.key) ?? []).filter((e) => !repeats(e)); return ev.length ? [{ ...x, why: `${ev.slice(0, 2).join("; ")}.` }] : []; });
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
  const headline = i.accounts === 0 ? "No client accounts yet." : items.length === 0 ? "Nothing needs you today. Every list is clear." : items.length === 1 && all.length === 1 ? "One thing needs you today." : all.length > items.length ? `${all.length} things need you. The ${items.length} most important are below; the other ${all.length - items.length} are in each list.` : `${items.length} things need you today.`;
  return { day, dayText: dayLabel(day), headline, items, more: Math.max(0, all.length - items.length), dollar, formula: FORMULA, accounts: i.accounts, bySection: bySection(all) };
}

// ---- words ----

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slackEsc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/**
 * Where one brief item opens. SubSync opens only inside the CRM, so every item opens the CRM on the company's own domain: an account's item (a "save" item) opens that account's
 * conversations, deals or dashboard; a cross-account item opens the CRM start page and names the SubSync menu to open next.
 */
export function briefTarget(crm: DomainSource, it: Pick<BriefItem, "key" | "hash">): Resolved {
  const view = viewOfHash(it.hash);
  const loc = /^save:([A-Za-z0-9_-]{1,64})$/.exec(it.key)?.[1] ?? null;
  const mapped = view === "pipeline" ? "pipeline" : view === "clients" ? "clients" : "speed";
  return loc ? resolveTarget(crm, { view: mapped, locationId: loc }, "Open the list") : wordsLink(crm, menuPath(view));
}
const menuPath = (view: string | null) => resolveTarget(null, { view, locationId: null }).label.replace(/^Open your CRM, then /, "");
const moreTarget = (crm: DomainSource) => wordsLink(crm, "SubSync > Today");

/** Plain text, for the email's text part, for pasting into a message or for a client. Every link opens the CRM (never SubSync) and carries no one's data. */
export function briefText(b: Brief, crm: DomainSource): string {
  const out = [b.headline, ""];
  b.items.forEach((it, n) => out.push(`${n + 1}. ${it.title}`, `   ${it.why}${it.dollars !== null && it.dollars > 0 ? ` About ${money(it.dollars)} (estimate).` : ""}`, `   ${linkText(briefTarget(crm, it))}`, ""));
  if (b.more > 0) out.push(`And ${b.more} more.`, linkText(moreTarget(crm)), "");
  out.push(b.dollar.text);
  return out.join("\n");
}

/** The same brief as chat markup (bold with asterisks, links as <address|words>), to paste into Slack. */
export function briefSlack(b: Brief, crm: DomainSource): string {
  const out = [`*${b.headline}*`, ""];
  b.items.forEach((it, n) => { const t = briefTarget(crm, it); out.push(`${n + 1}. *${it.title}*`, `${it.why}${it.dollars !== null && it.dollars > 0 ? ` About ${money(it.dollars)} (estimate).` : ""} <${t.url}|${slackEsc(t.label)}>`, ""); });
  if (b.more > 0) { const t = moreTarget(crm); out.push(`And ${b.more} more. <${t.url}|${slackEsc(t.label)}>`); }
  out.push(`_${b.dollar.text}_`);
  return out.join("\n");
}

export function briefEmail(b: Brief, o: { /** The company's CRM domain (settings.appDomain / white-label); the default host is used only when none is known. */ crmDomain?: DomainSource; stopUrl: string; /** AI wording (a suggestion around our numbers): only when the account connected its own AI and the number check passed. */ ai?: string | null }): { subject: string; text: string; html: string } {
  const subject = b.items.length === 0 ? "Your 7 am brief: nothing needs you today" : `Your 7 am brief: ${b.headline.replace(/\.$/, "")}`;
  const html: string[] = [`<p style="margin:0 0 14px;font-size:16px"><b>${esc(b.headline)}</b></p>`];
  if (o.ai) html.push(`<p style="margin:0 0 14px;padding:10px;border-left:3px solid #888888;color:#333333"><b>AI wording (a suggestion):</b> ${esc(o.ai)}</p>`);
  b.items.forEach((it, n) => html.push(`<div style="margin:0 0 12px;padding:12px;border:1px solid #dddddd;border-radius:8px"><b>${n + 1}. ${esc(it.title)}</b><p style="margin:6px 0;color:#444444">${esc(it.why)}${it.dollars !== null && it.dollars > 0 ? ` About ${esc(money(it.dollars))} (estimate).` : ""}</p>${linkHtml(briefTarget(o.crmDomain, it), "display:inline-block;padding:8px 14px;background:#5b789a;color:#ffffff;border-radius:6px;text-decoration:none")}</div>`));
  if (b.more > 0) html.push(`<p>And ${b.more} more. ${linkHtml(moreTarget(o.crmDomain))}.</p>`);
  html.push(`<p style="margin:12px 0;color:#444444">${esc(b.dollar.text)}</p>`);
  const foot = "You get one brief a day, at the time you chose. Dollar figures are estimates. Nothing here changes your CRM or messages your leads.";
  // The brief's settings live only inside SubSync, so the way there is the CRM plus words (a link to SubSync could not sign anyone in).
  const settings = wordsLink(o.crmDomain, "SubSync > Today > Brief settings");
  html.push(`<p style="color:#777777;font-size:12px">${esc(foot)} Change the time or sections: ${linkHtml(settings)}. <a href="${esc(o.stopUrl)}">Stop these emails</a>.</p>`);
  return { subject, text: `${o.ai ? `AI wording (a suggestion): ${o.ai}\n\n` : ""}${briefText(b, o.crmDomain)}\n\n${foot}\nChange the time or sections: ${linkText(settings)}\nStop these emails: ${o.stopUrl}`, html: html.join("") };
}

// ---- when it goes ----

/** True at the person's chosen hour of their own day (or up to 2 hours late), not on a quiet weekday, once per local day. Safe to call every hour. */
export const briefDue = (nowMs: number, tz: string, hour: number, quietDays: readonly number[], lastKey: string | null) => digestDue(nowMs, tz, hour, quietDays, null, null, lastKey);

/** The sections a person kept on, from stored text. Anything unknown is dropped; an empty list means every section. */
export function sectionsOf(v: unknown): Set<Section> {
  const list = Array.isArray(v) ? v.filter((x): x is Section => (SECTIONS as readonly string[]).includes(String(x))) : [];
  return new Set(list.length ? list : SECTIONS);
}
