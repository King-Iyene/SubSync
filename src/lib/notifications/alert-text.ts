// The words of an alert in Slack, email and the bell (pure, no database or network). Every alert says what happened, in which client account, the numbers
// (how many, over what window, against what usual level), the biggest causes it can show, one plain next step, and a link that opens the exact screen.
// Contact names are never put in these messages: causes are counts by source, kind and age, so nothing private leaves the app.
//
// Repeats: an alert that is still open is told once, again only when its figure moved into a different band (at least 3 hours later), or as a reminder once a
// day with what changed since the last message. When it clears, one "back to normal" note is sent. `decideSend` is the rule and is unit tested.

import { cleanValue } from "./copy.ts";

export type AlertInput = { id: string; kind: string; severity: "info" | "warning" | "critical"; title: string; locationId: string | null; detail: Record<string, unknown> };
/** Extra facts read from the data when the alert alone does not carry them. All optional: a message is still specific without them. */
export type Extra = { sources?: Array<{ name: string; count: number }>; oldestWaitMinutes?: number | null };

export type AlertLink = { view: string; locationId: string | null; query?: string };
export type Meta = { subject: string; fp: string; count: number | null; state: "new" | "changed" | "reminder" | "recovered"; account: string; what: string };
export type Described = { subject: string; fp: string; count: number | null; what: string; title: string; body: string; details: string[]; link: AlertLink; linkLabel: string };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? cleanValue(v) : "");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export function minutesWords(m: number): string {
  const r = Math.max(0, Math.round(m));
  if (r < 60) return `${r} min`;
  if (r < 48 * 60) return `${Math.floor(r / 60)} h${r % 60 ? ` ${r % 60} min` : ""}`;
  return `${Math.floor(r / 1440)} days`;
}

/** Bands for "has it really changed": small moves inside a band do not send a new message. */
export function bucket(n: number | null): number {
  if (n === null || n <= 0) return 0;
  if (n < 5) return n;
  if (n < 10) return 5;
  if (n < 20) return 10;
  if (n < 50) return 20;
  return Math.floor(n / 50) * 50;
}

const PROBLEM_WORDS: Record<string, string> = { duplicate: "duplicates", junk: "junk or test records", bad_phone: "invalid phone numbers", bad_email: "invalid email addresses" };
export const problemWords = (kinds: Record<string, number>): string[] => Object.entries(kinds).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n} ${PROBLEM_WORDS[k] ?? k.replace(/_/g, " ")}`);


/** The deep link of the bad-records list for one source: the same rows the count counts (bad records that arrived in the last 24 hours). */
export const spikeLink = (locationId: string, source: string): AlertLink => ({ view: "data-health", locationId, query: `loc=${encodeURIComponent(locationId)}&mode=source&src=${encodeURIComponent(source)}&since=24h` });

// ---------------- alert -> facts -> words ----------------
// Step 1 (`factsFor`): an alert becomes plain facts: counts, window, usual level, the biggest causes, a link. No wording. A new kind of alert needs only its facts here and one
// entry in WORDS below. Step 2 (`renderFacts`): the data-specific template turns facts into words. The same facts are what the AI writer is given (`factsText`) and what the chat
// bot reads when asked about alerts, so every figure in any version comes from the same place.

export type Cause = { label: string; count: number | null };
export type AlertFacts = {
  kind: string; subject: string; account: string; locationId: string | null;
  /** The figure the alert is about (how many); null when it has none. */
  count: number | null;
  /** What that figure counts, in words ("bad records with no source recorded"). Also the name used in the "back to normal" note. */
  what: string;
  /** Other figures: usual, created, newestMinutes, target, oldest, threshold, days, drop, open, value, staleDays, score, hours. */
  n: Record<string, number | null>;
  /** Other words: source, domain, error, status, window. */
  s: Record<string, string>;
  causes: Cause[];
  link: AlertLink;
};

export function factsFor(a: AlertInput, accountIn: string | null, extra: Extra = {}): AlertFacts {
  const account = cleanValue(accountIn ?? "") || "A client account";
  const d = a.detail ?? {};
  const loc = a.locationId;
  const acct = loc ? `accounts=${encodeURIComponent(loc)}` : "";
  const f = (subject: string, count: number | null, what: string, link: AlertLink, n: AlertFacts["n"] = {}, s: AlertFacts["s"] = {}, causes: Cause[] = []): AlertFacts =>
    ({ kind: a.kind, subject: `${a.kind}:${loc ?? "all"}:${subject}`, account, locationId: loc, count, what, n, s, causes, link });

  if (a.kind === "quality" && typeof d.source === "string" && num(d.recent) !== null) {
    const source = str(d.source), unknown = source === "Unknown source";
    const kinds = d.kinds && typeof d.kinds === "object" ? (d.kinds as Record<string, number>) : {};
    return f(slug(source), num(d.recent), `bad records ${unknown ? "with no source recorded" : `from ${source}`}`, loc ? spikeLink(loc, source) : { view: "data-health", locationId: null },
      { usual: num(d.usual) ?? 0, created: num(d.created), newestMinutes: num(d.newestMinutes) }, { source: unknown ? "" : source, window: "the last 24 hours" },
      Object.entries(kinds).filter(([, c]) => c > 0).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, c]) => ({ label: PROBLEM_WORDS[k] ?? k.replace(/_/g, " "), count: c })));
  }
  if (a.kind === "quality" && typeof d.dq === "string") return f(slug(`${d.dq}-${str(d.source)}`), null, a.title.replace(`${account}: `, ""), { view: "cleanup", locationId: loc }, {}, { title: a.title, dq: "1" });
  if (a.kind === "quality") return f("complete", num(d.completenessPct), "incomplete contact data", { view: "data-health", locationId: loc }, { threshold: 50 });
  if (a.kind === "speed") {
    return f("waiting", num(d.waiting) ?? 0, "new leads waiting for a reply", { view: "speed", locationId: loc, query: acct },
      { target: num(d.targetMinutes) ?? 15, oldest: num(d.oldestWaitMinutes) ?? extra.oldestWaitMinutes ?? null }, {}, (extra.sources ?? []).filter((x) => x.count > 0).slice(0, 3).map((x) => ({ label: x.name, count: x.count })));
  }
  if (a.kind === "appointments") return f("unmarked", num(d.unmarked) ?? 0, "past appointments with no outcome", { view: "appointments", locationId: loc, query: acct }, { threshold: 5 });
  if (a.kind === "sla") return f("unanswered", num(d.unanswered) ?? 0, "conversations waiting", { view: "speed", locationId: loc, query: [acct, "tab=unanswered"].filter(Boolean).join("&") }, { hours: num(d.slaHours) ?? 4 });
  if (a.kind === "dormant") return f("dormant", num(d.daysInactive), "account gone quiet", { view: "account", locationId: loc }, { days: num(d.daysInactive), threshold: num(d.threshold) ?? 14 });
  if (a.kind === "churn") return f("churn", null, "high churn risk", { view: "account", locationId: loc }, { score: num(d.score) }, {}, (Array.isArray(d.reasons) ? (d.reasons as unknown[]).map(str).filter(Boolean).slice(0, 3) : []).map((r) => ({ label: r, count: null })));
  if (a.kind === "leadflow") return f("leadflow", num(d.dropPct) ?? 0, "new contacts dropped", { view: "account", locationId: loc }, { drop: num(d.dropPct) ?? 0, n30: num(d.newContacts30d) });
  if (a.kind === "stale") return f("stale", num(d.staleOpps) ?? 0, "stale deals", { view: "deals", locationId: loc, query: acct }, { open: num(d.openOpps), value: num(d.value), staleDays: num(d.staleDays) });
  if (a.kind === "sync") return f("sync", null, "data could not be refreshed", { view: "settings", locationId: loc }, {}, { error: str(d.error) });
  if (a.kind === "email") return f(slug(str(d.domain)), null, `email setup on ${str(d.domain)}`, { view: "email", locationId: loc }, {}, { domain: str(d.domain), status: d.status === "critical" ? "critical" : "warning" });
  return f(slug(a.title), null, a.title, { view: "alerts", locationId: loc }, {}, { title: a.title });
}

type Words = { title: (f: AlertFacts) => string; body: string; details?: (f: AlertFacts) => string[]; linkLabel: string; fpExtra?: (f: AlertFacts) => string };
const c = (f: AlertFacts) => f.count ?? 0;
const WORDS: Record<string, (f: AlertFacts) => Words> = {
  "quality:source": () => ({
    title: (x) => `${x.account}: ${plural(c(x), "bad record")} came in ${x.s.source ? `from ${x.s.source}` : "with no source recorded"} in ${x.s.window} (usually ${x.n.usual} a day)`,
    body: "Next: open the list, fix or remove them, and check the form or import that sends them.",
    details: (x) => [x.causes.length ? `What is wrong: ${x.causes.map((k) => `${k.count} ${k.label}`).join(", ")}.` : "", x.n.created !== null ? `${c(x)} of the ${x.n.created} records that ${x.s.source ? "this source" : "have no source"} created in ${x.s.window}.` : "", x.n.newestMinutes !== null ? `The newest arrived ${minutesWords(x.n.newestMinutes as number)} ago.` : ""],
    linkLabel: "Open the bad records",
  }),
  "quality:dq": () => ({ title: (x) => x.s.title, body: "Next: open Clean-up, review the records it lists and fix or merge them.", linkLabel: "Open Clean-up" }),
  quality: () => ({ title: (x) => `${x.account}: only ${x.count ?? "?"}% of contacts have complete details (the alert starts below ${x.n.threshold}%)`, body: "Next: open Data health, press the biggest problem and fill the missing details.", linkLabel: "Open Data health" }),
  speed: () => ({
    title: (x) => `${x.account}: ${plural(c(x), "new lead")} ${c(x) === 1 ? "has" : "have"} waited more than ${x.n.target} minutes with no reply from a person`,
    body: "Next: open Speed to lead and call the longest-waiting lead first.",
    details: (x) => [x.n.oldest ? `The longest has waited ${minutesWords(x.n.oldest)}.` : "", x.causes.length ? `Most came from: ${x.causes.map((k) => `${k.label} (${k.count})`).join(", ")}.` : ""],
    linkLabel: "Open the waiting leads",
  }),
  appointments: () => ({ title: (x) => `${x.account}: ${plural(c(x), "past appointment")} ${c(x) === 1 ? "has" : "have"} no outcome recorded, so the show rate is a guess`, body: "Next: open Appointments and mark each one as showed or no-show.", details: (x) => [`The alert starts at ${x.n.threshold} appointments.`], linkLabel: "Open the appointments" }),
  sla: () => ({ title: (x) => `${x.account}: ${plural(c(x), "conversation")} ${c(x) === 1 ? "has" : "have"} waited more than ${x.n.hours} hours for a reply`, body: "Next: open Unanswered messages and reply to the oldest first.", linkLabel: "Open the unanswered messages" }),
  dormant: () => ({ title: (x) => `${x.account}: no activity ${x.n.days === null ? "recorded yet" : `for ${x.n.days} days`} (the alert starts at ${x.n.threshold} days)`, body: "Next: open the account, check the last activity, and ask the owner if something changed.", linkLabel: "Open the account" }),
  churn: () => ({ title: (x) => `${x.account}: this account is at high risk of leaving${x.n.score !== null ? ` (health score ${x.n.score})` : ""}`, body: "Next: open the account and reach out to the owner this week.", details: (x) => x.causes.map((k) => `Why: ${k.label}`), linkLabel: "Open the account" }),
  leadflow: () => ({ title: (x) => `${x.account}: new contacts are down ${x.n.drop}% on their recent average`, body: "Next: check the ad, form and import that bring leads in, and ask whether it was paused.", details: (x) => [x.n.n30 !== null ? `${x.n.n30} new contacts in the last 30 days.` : ""], linkLabel: "Open the account" }),
  stale: () => ({ title: (x) => `${x.account}: ${plural(c(x), "deal")} ${c(x) === 1 ? "has" : "have"} gone stale${x.n.value ? ` (${money(x.n.value)})` : ""}`, body: "Next: open Deals and follow up the biggest stale deals first, or close the ones that are dead.", details: (x) => [x.n.open !== null ? `${c(x)} of ${x.n.open} open deals${x.n.staleDays ? ` have had no movement for ${x.n.staleDays} days or more` : " are stale"}.` : ""], linkLabel: "Open the stale deals" }),
  sync: () => ({ title: (x) => `${x.account}: the latest data could not be refreshed${x.s.error ? ` (${x.s.error.slice(0, 120)})` : ""}`, body: "Next: open Settings, Sync status and try again. Numbers on screen may be out of date until then.", linkLabel: "Open Sync status" }),
  email: () => ({ title: (x) => `${x.account}: email sending ${x.s.status === "critical" ? "is broken" : "needs attention"} on ${x.s.domain || "a domain"}`, body: "Next: open Email health and fix the DNS records it lists, so messages are not marked as spam.", linkLabel: "Open Email health" }),
};
const wordsFor = (f: AlertFacts): Words => (f.kind === "quality" ? (f.s.dq ? WORDS["quality:dq"] : f.s.window ? WORDS["quality:source"] : WORDS.quality) : WORDS[f.kind] ?? (() => ({ title: (x: AlertFacts) => x.s.title ?? x.what, body: "Open the page to see the details and the next step.", linkLabel: "Open it" })))(f);

/** Step 2: facts to words. Data-specific, never the generic text. */
export function renderFacts(f: AlertFacts): Described {
  const w = wordsFor(f);
  return { subject: f.subject, fp: `${f.kind}|${f.locationId ?? ""}|${f.subject.split(":").slice(2).join(":")}|${bucket(f.count)}${f.kind === "dormant" && f.n.days === null ? "|none" : ""}`, count: f.count, what: f.what, title: w.title(f), body: w.body, details: (w.details?.(f) ?? []).filter(Boolean), link: f.link, linkLabel: w.linkLabel };
}

export const describeAlert = (a: AlertInput, accountIn: string | null, extra: Extra = {}): Described => renderFacts(factsFor(a, accountIn, extra));

/** The facts as plain lines: the ONLY thing the AI writer is shown, and what the chat bot reads. Every figure the AI may use is in this text. */
export function factsText(f: AlertFacts): string {
  const lines = [`Alert: ${f.what}`, `Client account: ${f.account}`];
  if (f.count !== null) lines.push(`Figure: ${f.count}`);
  const names: Record<string, string> = { usual: "Usual per day", created: "Records created in the window", newestMinutes: "Newest arrived (minutes ago)", target: "Reply target (minutes)", oldest: "Longest wait (minutes)", threshold: "Alert starts at", hours: "Reply target (hours)", days: "Days with no activity", drop: "Drop (percent)", n30: "New contacts in 30 days", open: "Open deals", value: "Value (dollars)", staleDays: "Stale after (days)", score: "Health score" };
  for (const [k, v] of Object.entries(f.n)) if (v !== null && names[k]) lines.push(`${names[k]}: ${v}`);
  if (f.s.window) lines.push(`Window: ${f.s.window}`);
  if (f.s.source) lines.push(`Source: ${f.s.source}`);
  for (const k of f.causes.slice(0, 3)) lines.push(`Cause: ${k.label}${k.count !== null ? ` (${k.count})` : ""}`);
  return lines.join("\n");
}

// ---------------- repeats ----------------

export type Prev = { fp: string; count: number | null; at: number; state: string };
export const MIN_CHANGE_GAP_MS = 3 * 3_600_000;
export const REMIND_MS = 24 * 3_600_000;

/** Tell now, or stay quiet. A new problem is told at once; a changed one when its band moved (and not twice in 3 hours); an unchanged one once a day. */
export function decideSend(prev: Prev | null, now: Pick<Described, "fp">, nowMs: number): { send: boolean; state: "new" | "changed" | "reminder" } {
  if (!prev || prev.state === "recovered") return { send: true, state: "new" };
  const age = nowMs - prev.at;
  if (prev.fp !== now.fp) return age >= MIN_CHANGE_GAP_MS ? { send: true, state: "changed" } : { send: false, state: "changed" };
  return age >= REMIND_MS ? { send: true, state: "reminder" } : { send: false, state: "reminder" };
}

const ago = (ms: number) => (ms < 90 * 60_000 ? `${Math.max(1, Math.round(ms / 60_000))} min ago` : ms < 36 * 3_600_000 ? `${Math.round(ms / 3_600_000)} h ago` : `${Math.round(ms / 86_400_000)} days ago`);

/** What changed since the last message, in one plain line. Empty for a first message. */
export function changeLine(prev: Prev | null, count: number | null, state: Meta["state"], nowMs: number): string {
  if (!prev || state === "new" || prev.state === "recovered") return "";
  const when = ago(nowMs - prev.at);
  if (prev.count !== null && count !== null && prev.count !== count) {
    const diff = Math.abs(count - prev.count);
    return `${count > prev.count ? "Up" : "Down"} from ${prev.count} (${diff} ${count > prev.count ? "more" : "fewer"}) since the last message, ${when}.`;
  }
  return `Still open and unchanged since the last message, ${when}.`;
}

export type Specific = { title: string; body: string; details: string[]; link: AlertLink; linkLabel: string; meta: Meta };

export function specificFor(d: Described, account: string, state: Meta["state"], prev: Prev | null, nowMs: number): Specific {
  const change = changeLine(prev, d.count, state, nowMs);
  const lead = state === "reminder" ? "Reminder: " : state === "changed" ? "Update: " : "";
  return { title: `${lead}${d.title}`, body: d.body, details: [change, ...d.details].filter(Boolean), link: d.link, linkLabel: d.linkLabel, meta: { subject: d.subject, fp: d.fp, count: d.count, state, account, what: d.what } };
}

/** The one note when a problem clears. */
export function recoveryFor(prev: { meta: Meta; link: AlertLink; linkLabel: string }, nowMs: number, prevAt: number): Specific {
  const m = prev.meta;
  const was = m.count !== null ? `It was ${m.count} when we last told you, ${ago(nowMs - prevAt)}.` : `We last told you ${ago(nowMs - prevAt)}.`;
  return { title: `${m.account}: back to normal, ${m.what}`, body: "Nothing to do. This alert has cleared.", details: [was], link: prev.link, linkLabel: prev.linkLabel, meta: { ...m, state: "recovered" } };
}
