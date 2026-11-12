// "Client is ignoring leads": the pure rules (no database). The SQL in ignored-leads-sql.ts follows these words exactly; docs/METRICS.md, "Clients ignoring leads".
// A person is ignored when the client account has not answered them: a lead nobody answered, a customer who wrote and got no reply (or only an automatic one), or a missed call nobody returned.

export const REASONS = ["missed", "never", "reply_nobody", "reply_auto"] as const;
export type Reason = (typeof REASONS)[number];
export const isReason = (v: unknown): v is Reason => typeof v === "string" && (REASONS as readonly string[]).includes(v);
export const REASON_LABEL: Readonly<Record<Reason, string>> = {
  missed: "Nobody called back", never: "New leads never answered", reply_nobody: "Wrote and got no reply", reply_auto: "Only an automatic reply",
};
export const REASON_HINT: Readonly<Record<Reason, string>> = {
  missed: "A caller phoned, was missed, and nobody called or texted them back.",
  never: "A new contact that nobody on the team has called or messaged.",
  reply_nobody: "The customer's latest message has had no reply at all.",
  reply_auto: "The customer's latest message was answered only by an automatic message, not by a person.",
};

export type IgnoredPref = { enabled: boolean; minPeople: number; waitHours: number; to: "agency" | "account" };
export const IGNORED_DEFAULTS: IgnoredPref = { enabled: true, minPeople: 5, waitHours: 24, to: "agency" };
const clamp = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, n)) : d; };

/** Cleans what the settings send. Anything missing keeps the default (the company choice, or the built-in one). */
export function cleanIgnoredPref(raw: unknown, base: IgnoredPref = IGNORED_DEFAULTS): IgnoredPref {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : base.enabled,
    minPeople: clamp(o.minPeople, 1, 500, base.minPeople),
    waitHours: clamp(o.waitHours, 1, 168, base.waitHours),
    to: o.to === "account" ? "account" : o.to === "agency" ? "agency" : base.to,
  };
}
/** One account's own choice wins over the company's, which wins over the built-in one. */
export const effectivePref = (company: unknown, account: unknown): IgnoredPref => cleanIgnoredPref(account, cleanIgnoredPref(company));

/** What happened to the customer's latest message. An automatic reply is not an answer unless the account chose to count automatic messages. */
export function classifyReply(a: { human: boolean; auto: boolean; countAuto: boolean }): "answered" | Extract<Reason, "reply_nobody" | "reply_auto"> {
  if (a.human || (a.auto && a.countAuto)) return "answered";
  return a.auto ? "reply_auto" : "reply_nobody";
}

export type AccountCount = { locationId: string; name: string; people: number; missed: number; never: number; replyNobody: number; replyAuto: number; oldestAt: number | null; dollars: number; unpriced: number; previous?: number | null };
/** Worst first: most people, then the oldest wait, then the name (so the order never jumps between reads). */
export function rankAccounts<T extends Pick<AccountCount, "people" | "oldestAt" | "name">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.people - a.people || (a.oldestAt ?? Infinity) - (b.oldestAt ?? Infinity) || a.name.localeCompare(b.name));
}

export const shouldAlert = (people: number, p: IgnoredPref) => p.enabled && people >= p.minPeople;

export function alertTitle(account: string, people: number, oldestHours: number | null): string {
  const wait = oldestHours === null ? "" : oldestHours >= 48 ? `, the longest for ${Math.floor(oldestHours / 24)} days` : `, the longest for ${oldestHours} hours`;
  return `${account} is not answering ${people.toLocaleString("en-US")} ${people === 1 ? "person" : "people"}${wait}`;
}

/** "Up 4 on the 30 days before" / "same" / null when there is no earlier history to compare with. */
export function trendWords(current: number, before: number | null | undefined, days: number): string | null {
  if (before === null || before === undefined) return null;
  const d = current - before;
  return d === 0 ? `Same as the ${days} days before.` : `${d > 0 ? "Up" : "Down"} ${Math.abs(d)} on the ${days} days before.`;
}

/** The money line: counted open deals only. When nobody flagged has a counted deal it says so instead of showing zero. */
export function moneyWords(dollars: number, people: number, unpriced: number): string {
  if (people === 0) return "";
  if (dollars <= 0) return "Unpriced: none of these people has an open deal with a value.";
  const usd = "$" + Math.round(dollars).toLocaleString("en-US");
  return `${usd} of open deals (counted).${unpriced > 0 ? ` ${unpriced.toLocaleString("en-US")} ${unpriced === 1 ? "person has" : "people have"} no priced deal.` : ""}`;
}
export const ignoredDedupeKey = (locationId: string) => `ignored-leads:${locationId}`;
