// The pure half of the four lead AI jobs (docs/METRICS.md, "AI lead jobs"). No database, no network, no model: every figure, every ranking and every pattern count is worked out HERE, from rows
// our own queries produced, and is unit tested. The model only writes words around these figures (see lead-run.ts), and the safety layer rejects any figure it was not given.

const H = 3_600_000;

/** "less than an hour", "5 hours", "3 days": the one way durations are written to the model and to the screen. */
export function agoWords(ms: number): string {
  const h = Math.max(0, ms) / H;
  if (h < 1) return "less than an hour";
  if (h < 48) { const n = Math.floor(h); return `${n} ${n === 1 ? "hour" : "hours"}`; }
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"}`;
}
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);
export type Facts = { text: string; fields: string[]; includesNames: boolean };

// ---------------------------------------------------------------- 1. lead summary

export type LeadFacts = {
  name: string | null; account: string | null; source: string | null; tags: string[]; hasOwner: boolean; dnd: boolean;
  createdAgoMs: number | null;
  inbound: number; humanOut: number; autoOut: number; missedCalls: number;
  lastInboundAgoMs: number | null; lastHumanOutAgoMs: number | null; firstReplyMinutes: number | null;
  callsLogged: number; lastCallOutcome: string | null;
  appointments: { upcoming: number; showed: number; noShow: number; total: number };
  deals: { open: number; openValue: number; lost: number; won: number; stage: string | null };
  /** The latest messages, oldest first. Only ever filled for an account that opted in to names and message text. */
  messages?: Array<{ dir: "in" | "out"; text: string }>;
};

const MSG_LINES = 6;
const MSG_CHARS = 300;

/** The exact text sent to the model for one lead. Counts, ages and tags by default; the name, the account name and the message text only when `shareNames` (the account's own opt-in). */
export function leadSummaryFacts(f: LeadFacts, shareNames: boolean): Facts {
  const L: string[] = [];
  if (shareNames && f.name) L.push(`Lead: ${f.name}`);
  if (shareNames && f.account) L.push(`Business: ${f.account}`);
  L.push(`Arrived: ${f.createdAgoMs === null ? "unknown" : `${agoWords(f.createdAgoMs)} ago`}`);
  L.push(`Source: ${f.source ? clip(f.source, 60) : "not recorded"}`);
  L.push(`Tags: ${f.tags.length ? f.tags.slice(0, 12).map((t) => clip(t, 40)).join(", ") : "none"}`);
  L.push(`Has an owner: ${f.hasOwner ? "yes" : "no"}`);
  L.push(`Messages from the lead: ${f.inbound}; last one ${f.lastInboundAgoMs === null ? "none" : `${agoWords(f.lastInboundAgoMs)} ago`}`);
  L.push(`Messages or calls from a person on the team: ${f.humanOut}; last one ${f.lastHumanOutAgoMs === null ? "none" : `${agoWords(f.lastHumanOutAgoMs)} ago`}`);
  L.push(`Automatic messages sent: ${f.autoOut}`);
  L.push(`Missed calls from the lead: ${f.missedCalls}`);
  if (f.firstReplyMinutes !== null) L.push(`First reply by a person took: ${f.firstReplyMinutes} ${f.firstReplyMinutes === 1 ? "minute" : "minutes"}`);
  else L.push("No person has replied yet: yes");
  L.push(`Calls logged in Call mode: ${f.callsLogged}${f.lastCallOutcome ? `; last result: ${f.lastCallOutcome}` : ""}`);
  L.push(`Appointments: ${f.appointments.total} in all; upcoming ${f.appointments.upcoming}; showed up ${f.appointments.showed}; no-show ${f.appointments.noShow}`);
  L.push(`Deals: open ${f.deals.open}${f.deals.open > 0 ? ` worth an estimated ${money(f.deals.openValue)}` : ""}${f.deals.stage ? `, in the step called ${clip(f.deals.stage, 40)}` : ""}; won ${f.deals.won}; lost ${f.deals.lost}`);
  const msgs = shareNames && f.messages?.length ? f.messages.slice(-MSG_LINES) : [];
  if (msgs.length) L.push("<messages>", ...msgs.map((m) => `${m.dir === "in" ? "Lead" : "Team"}: ${clip(m.text.replace(/\s+/g, " ").trim(), MSG_CHARS)}`), "</messages>");
  const fields = ["how long ago the lead arrived, the source and the tags", "counts of messages, calls, appointments and deals, and how long ago the last one was", "whether the lead has an owner"];
  if (shareNames && (f.name || f.account)) fields.push("the lead's name and the business name");
  if (msgs.length) fields.push(`the text of the last ${msgs.length} messages (each cut to ${MSG_CHARS} characters)`);
  return { text: L.join("\n"), fields, includesNames: shareNames && Boolean(f.name || f.account || msgs.length) };
}

// ---------------------------------------------------------------- 2. who to call first (rule-based, no AI needed)

/** Tags that signal a buyer. Plain code, so the score is explainable ("hot tag: quote"). Not a list the model sees as instructions. */
export const HOT_TAG = /\b(hot|warm|ready|interested|urgent|quote|estimate|demo|vip|buyer|asap|high[- ]?intent|hot[- ]?lead)\b/i;
export type Factor = { key: "wait" | "hot" | "deal" | "replied"; points: number; text: string };
export type RankIn = { key: string; ageHours: number | null; tags: readonly string[]; openValue: number; replies: number; dnd: boolean };
export type Ranked<T> = T & { score: number; factors: Factor[]; reason: string };

/** Points for how long the person has been waiting. Fresh leads matter, waiting leads matter more, and very old ones fade (they are cold, not urgent). Max 30. */
export const waitPoints = (h: number | null): number => (h === null ? 0 : h < 1 ? 8 : h < 4 ? 16 : h < 24 ? 24 : h <= 72 ? 30 : 22);
/** Max 30 for a tag that signals a buyer (a second one adds 5). */
export const hotPoints = (tags: readonly string[]): { points: number; tag: string | null } => {
  const hot = tags.filter((t) => HOT_TAG.test(t));
  return { points: hot.length === 0 ? 0 : hot.length === 1 ? 25 : 30, tag: hot[0] ?? null };
};
/** Max 25, log scale: about 18 for $1,000, 24 for $10,000. Nothing for a deal worth nothing. */
export const dealPoints = (v: number): number => (v > 0 ? Math.min(25, Math.round(Math.log10(v + 1) * 6)) : 0);
/** Max 15: one earlier reply from the lead is 10, two or more is 15. */
export const replyPoints = (n: number): number => (n <= 0 ? 0 : n === 1 ? 10 : 15);

/** The rank, with the facts behind it. DND people are not ranked (never offered for a call). Ties break by the longer wait, then by key, so the order is stable. */
export function rankCallFirst<T extends RankIn>(rows: readonly T[]): { ranked: Array<Ranked<T>>; leftOutDnd: number } {
  const out: Array<Ranked<T>> = [];
  let leftOutDnd = 0;
  for (const r of rows) {
    if (r.dnd) { leftOutDnd++; continue; }
    const f: Factor[] = [];
    const w = waitPoints(r.ageHours);
    if (w > 0 && r.ageHours !== null) f.push({ key: "wait", points: w, text: `waiting ${agoWords(r.ageHours * H)}` });
    const h = hotPoints(r.tags);
    if (h.points > 0) f.push({ key: "hot", points: h.points, text: `hot tag: ${clip(h.tag ?? "", 30)}` });
    const d = dealPoints(r.openValue);
    if (d > 0) f.push({ key: "deal", points: d, text: `open deal of about ${money(r.openValue)}` });
    const p = replyPoints(r.replies);
    if (p > 0) f.push({ key: "replied", points: p, text: `replied ${r.replies} ${r.replies === 1 ? "time" : "times"} before` });
    const score = f.reduce((a, x) => a + x.points, 0);
    out.push({ ...r, score, factors: f, reason: f.length ? f.map((x) => x.text).join("; ") : "On the list; no other signal yet" });
  }
  out.sort((a, b) => b.score - a.score || (b.ageHours ?? -1) - (a.ageHours ?? -1) || a.key.localeCompare(b.key));
  return { ranked: out, leftOutDnd };
}

export type CallFirstFact = { n: number; name: string | null; source: string | null; reason: string; tags: readonly string[] };
/** What the model sees for the top of the ranking: a number, the facts behind the rank and (opt-in only) the name. The order and the score are decided before the model is asked. */
export function callFirstFacts(top: readonly CallFirstFact[], shareNames: boolean): Facts {
  const L = [`Leads ranked by code, best first (${top.length}):`];
  for (const t of top) L.push(`#${t.n}: ${t.reason}${t.source ? `; source: ${clip(t.source, 40)}` : ""}${t.tags.length ? `; tags: ${t.tags.slice(0, 6).map((x) => clip(x, 30)).join(", ")}` : ""}${shareNames && t.name ? `; name: ${t.name}` : ""}`);
  const fields = ["for each lead: how long it has waited, hot tags, open deal value, earlier replies, source", "the order our code ranked them in"];
  if (shareNames && top.some((t) => t.name)) fields.push("each lead's name");
  return { text: L.join("\n"), fields, includesNames: shareNames && top.some((t) => Boolean(t.name)) };
}

/** Keeps only lines that name a lead we asked about, once each, and cuts them to one line. Anything else the model wrote is dropped. */
export function cleanLines(answer: unknown, askedIds: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = (answer as { lines?: unknown })?.lines;
  if (!Array.isArray(lines)) return out;
  for (const l of lines) {
    const id = String((l as { id?: unknown })?.id ?? "").replace(/^#/, ""), line = (l as { line?: unknown })?.line;
    if (askedIds.includes(id) && !(id in out) && typeof line === "string" && line.trim()) out[id] = line.trim().replace(/\s+/g, " ").slice(0, 150);
  }
  return out;
}

// ---------------------------------------------------------------- 3. why leads go cold (patterns from our data, words from the model)

export type ColdLead = { key: string; locationId: string; contactId: string; name: string; leadAt: number; humanAt: number | null; autoAt: number | null; hasOwner: boolean; source: string | null; timeZone: string | null; dnd: boolean };
export type Pattern = { key: string; label: string; cold: number; of: number; ratePct: number };
export type ColdReport = { windowDays: number; waitHours: number; judged: number; cold: number; coldPct: number | null; patterns: Pattern[] };

/** Is this lead one the team has not answered? A lead is judged once it is older than the wait; "cold" means no person has replied. DND people are never counted. */
export const isJudged = (r: ColdLead, now: number, waitHours: number) => !r.dnd && r.leadAt <= now - waitHours * H;
export const isCold = (r: ColdLead) => r.humanAt === null;

function localHour(ms: number, tz: string | null): number | null {
  if (!tz) return null;
  try { const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date(ms)).replace(/\D/g, "")); return Number.isFinite(h) ? h % 24 : null; } catch { return null; }
}
const sourceKey = (s: string | null) => `source:${(s ?? "").trim().toLowerCase() || "none"}`;
const sourceName = (s: string | null) => (s ?? "").trim() || "No source recorded";

type Def = { key: string; label: string; has: (r: ColdLead) => boolean | null };
const BASE: Def[] = [
  { key: "after_hours", label: "Arrived outside 8am to 9pm their time", has: (r) => { const h = localHour(r.leadAt, r.timeZone); return h === null ? null : !(h >= 8 && h < 21); } },
  { key: "no_owner", label: "Nobody owns the lead", has: (r) => !r.hasOwner },
  { key: "auto_only", label: "Only an automatic message went out", has: (r) => r.autoAt !== null },
];
const MIN_OF = 5, MIN_COLD = 3, MAX_SOURCES = 3, MAX_PATTERNS = 6;

/** The patterns, from the judged leads. A pattern is shown only with enough leads behind it (at least 5 judged, at least 3 cold). The count of a pattern is exactly the number of rows `rowsOf` returns. */
export function coldReport(rows: readonly ColdLead[], now: number, opts: { waitHours?: number; windowDays?: number } = {}): ColdReport {
  const waitHours = opts.waitHours ?? 24, windowDays = opts.windowDays ?? 30;
  const judged = rows.filter((r) => isJudged(r, now, waitHours));
  const cold = judged.filter(isCold);
  const make = (key: string, label: string, has: (r: ColdLead) => boolean | null): Pattern | null => {
    const inP = judged.filter((r) => has(r) === true);
    const c = inP.filter(isCold).length;
    return inP.length >= MIN_OF && c >= MIN_COLD ? { key, label, cold: c, of: inP.length, ratePct: Math.round((c / inP.length) * 100) } : null;
  };
  const patterns = BASE.map((d) => make(d.key, d.label, d.has)).filter((p): p is Pattern => p !== null);
  const bySource = new Map<string, { name: string; n: number }>();
  for (const r of cold) { const k = sourceKey(r.source), x = bySource.get(k) ?? { name: sourceName(r.source), n: 0 }; x.n++; bySource.set(k, x); }
  for (const [k, v] of [...bySource].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, MAX_SOURCES)) {
    const p = make(k, `Source: ${v.name}`, (r) => sourceKey(r.source) === k);
    if (p) patterns.push(p);
  }
  patterns.sort((a, b) => b.cold - a.cold || a.key.localeCompare(b.key));
  return { windowDays, waitHours, judged: judged.length, cold: cold.length, coldPct: judged.length ? Math.round((cold.length / judged.length) * 100) : null, patterns: patterns.slice(0, MAX_PATTERNS) };
}

/** Exactly the rows a pattern's count counts (or all cold leads for key "all"). Null for a key that is not one of the report's patterns. */
export function rowsOf(rows: readonly ColdLead[], report: ColdReport, key: string, now: number): ColdLead[] | null {
  const judged = rows.filter((r) => isJudged(r, now, report.waitHours));
  const cold = judged.filter(isCold);
  if (key === "all") return cold;
  if (!report.patterns.some((p) => p.key === key)) return null;
  const base = BASE.find((d) => d.key === key);
  const has = base ? base.has : (r: ColdLead) => sourceKey(r.source) === key;
  return cold.filter((r) => has(r) === true);
}

/** The aggregate counts sent to the model. No names, no account names. */
export function coldFacts(r: ColdReport): Facts {
  const L = [
    `Period: the last ${r.windowDays} days`,
    `Leads old enough to judge (older than ${r.waitHours} hours): ${r.judged}`,
    `Leads no person on the team ever replied to: ${r.cold}${r.coldPct !== null ? ` (${r.coldPct}%)` : ""}`,
    ...r.patterns.map((p) => `Pattern "${p.label}": ${p.cold} of ${p.of} such leads never got a person's reply (${p.ratePct}%)`),
  ];
  return { text: L.join("\n"), fields: ["counts of leads that never got a person's reply, in total and for each pattern (after hours, no owner, only an automatic message, source)", "the source names as recorded in your CRM"], includesNames: false };
}

// ---------------------------------------------------------------- 4. reply drafts

export type ReplySituation = {
  channel: "SMS" | "Email"; firstName: string | null; business: string | null; source: string | null;
  lastInboundAgoMs: number | null; humanOut: number; noShow: boolean; upcomingAppointment: boolean; openDeal: boolean;
  messages?: Array<{ dir: "in" | "out"; text: string }>;
};
/** The exact text sent to the model for a draft. Without the opt-in there are no names and no message text: the model is told to write with [name] and [business] left as they are. */
export function replyFacts(s: ReplySituation, shareNames: boolean): Facts {
  const L = [
    `Write as: ${s.channel === "SMS" ? "a text message" : "a short email body"}`,
    `Lead's first name: ${shareNames && s.firstName ? s.firstName : "[name]"}`,
    `Business name: ${shareNames && s.business ? s.business : "[business]"}`,
    `Source: ${s.source ? clip(s.source, 60) : "not recorded"}`,
    s.lastInboundAgoMs === null ? "The lead has not written to us yet" : `The lead's last message came ${agoWords(s.lastInboundAgoMs)} ago`,
    `Messages or calls from a person on the team so far: ${s.humanOut}`,
    ...(s.noShow ? ["The lead missed an appointment"] : []),
    ...(s.upcomingAppointment ? ["The lead has an upcoming appointment"] : []),
    ...(s.openDeal ? ["The lead has an open deal"] : []),
  ];
  const msgs = shareNames && s.messages?.length ? s.messages.slice(-MSG_LINES) : [];
  if (msgs.length) L.push("<messages>", ...msgs.map((m) => `${m.dir === "in" ? "Lead" : "Team"}: ${clip(m.text.replace(/\s+/g, " ").trim(), MSG_CHARS)}`), "</messages>");
  const fields = ["the channel, the source and how long ago the lead last wrote", "how many times the team has contacted them and whether an appointment was missed or is coming"];
  if (shareNames && (s.firstName || s.business)) fields.push("the lead's first name and the business name");
  if (msgs.length) fields.push(`the text of the last ${msgs.length} messages (each cut to ${MSG_CHARS} characters)`);
  return { text: L.join("\n"), fields, includesNames: shareNames && Boolean(s.firstName || s.business || msgs.length) };
}

/** Shown next to every draft: it is only text in the box; sending, do-not-contact and calling-hours checks are unchanged. */
export const DRAFT_NOTE = "This is an AI draft. Read it and edit it. Nothing is sent until you choose Send, and the usual do-not-contact and calling-hours checks still apply.";
