// Today module (front page), response types of GET /api/app/today3?part=... (types only: no imports of code, safe for the browser).
// REAL synced data only. Every count here is the same count the Clients screen holds for the same account and the same seven days, and every count opens exactly its rows
// (part=list). Money figures are estimates and say so. History figures carry `historyStarts` (YYYY-MM-DD). Definitions: docs/METRICS.md "Today 3".

export const TD3_PARTS = ["today", "list", "proof", "numbers", "settings", "export", "options"] as const;
export type Td3Part = (typeof TD3_PARTS)[number];

export const TD3_FLAGS = ["td_module", "td_today", "td_proof", "td_numbers", "td_email", "td_record"] as const;
export type Td3Flag = (typeof TD3_FLAGS)[number];

/** What an item is about. Each one is a count that opens its rows (part=list&kind=...). The last two only exist for the "my queue" of one team member. */
export const TD3_KINDS = [
  "waiting_old", "waiting", "unmarked", "noshows", "stale_deals", "needs_permission", "sync_old", "leads_down", "staff_quiet", "no_owner", "no_phone",
] as const;
export type Td3Kind = (typeof TD3_KINDS)[number];

/** Lists that are not an item of the ranked list: the tiles of Numbers and "my queue". */
export const TD3_LIST_ONLY = ["open_deals", "all_waiting", "all_noshows", "all_unmarked", "open_noshows", "all_stale", "mine_waiting", "mine_unmarked", "mine_stale"] as const;
export type Td3ListKind = Td3Kind | (typeof TD3_LIST_ONLY)[number];

/** Which screen of the app holds the full working list for a kind (the one button links there). */
export type Td3Module = "speed" | "appointments" | "pipeline" | "clients" | "team" | "data-health" | "settings";

export type Td3Meta = { generatedAt: string; cached: boolean; canSee: boolean; level: "all" | "account" | "self"; flags: Record<string, boolean>; problem: string | null; timezone: string };

export type Td3Account = { locationId: string; name: string; count: number };

export type Td3Item = {
  kind: Td3Kind; label: string; why: string; count: number; accounts: number;
  /** Estimate in whole dollars of the open deals behind this item, or null when there is no dollar value to give. Always shown as an estimate. */
  money: number | null;
  /** Hours the oldest thing behind this item has waited, or null when not known. */
  oldestHours: number | null;
  /** One plain line saying why this item is where it is in the list. */
  rankWhy: string;
  module: Td3Module;
  /** The biggest accounts behind the count (at most 3), for an owner with many accounts. */
  top: Td3Account[];
};

export type Td3Done = { kind: Td3Kind; label: string; cleared: number; lastAt: string | null };

export type Td3Mine = { waiting: number; unmarked: number; stale: number; total: number; button: { label: string; list: Td3ListKind; count: number } | null };

export type Td3Today = {
  headline: string;
  button: { label: string; kind: Td3Kind; count: number; module: Td3Module; locationId: string | null } | null;
  /** At most five, ranked. */
  items: Td3Item[];
  /** The two appointment numbers on the Today cards, over EVERY client account in view (not only the flagged ones), worked out with the same rule as Appointments (Needs outcome, No-show recovery), so each number equals the rows it opens. */
  counts: { unmarked: number; noshows: number };
  /** What the owner put aside for now (SubSync only). Counts stay real; the items just leave the list. */
  snoozed: Array<{ id: string; kind: Td3Kind; label: string; count: number; until: string; locationId: string | null }>;
  /** Cleared today (the account's own day) from our record. Empty until the record has a day. */
  done: Td3Done[];
  allClear: { fixedSinceYesterday: number; lastFixedAt: string | null } | null;
  accounts: number;
  /** The one-line scope: "All 20 client accounts" or the account name. */
  scope: string;
  /** For a team member (their own queue); null for an owner or an account admin. */
  mine: Td3Mine | null;
  /** Accounts we could not fully read ("Needs permission: reconnect"). */
  needsPermission: number;
  historyStarts: string | null;
  /** The time zone the day boundaries use (the main account's). */
  timezone: string;
};

export type Td3Row = { locationId: string; accountName: string; contactId: string | null; contactName: string; detail: string | null; at: string | null; value: number | null; url: string | null };
export type Td3Page<T> = { rows: T[]; total: number; page: number; size: number; pages: number; truncated: boolean };
export type Td3List = Td3Page<Td3Row> & { kind: Td3ListKind; label: string };

export type Td3ProofRow = { locationId: string; name: string; found: number; cleared: number; stillOpen: number; medianFixMinutes: number | null; fixes: number };
export type Td3Proof = {
  weekStart: string; weekEnd: string; weeks: string[];
  /** The whole business (or the one account) for the week. `enough` is false until the record holds at least one full day after its start. */
  total: { found: number; cleared: number; stillOpen: number; medianFixMinutes: number | null; fixes: number; enough: boolean };
  /** Per kind, plain words. */
  byKind: Array<{ kind: Td3Kind; label: string; found: number; cleared: number }>;
  rows: Td3Page<Td3ProofRow>;
  /** Plain lines safe to paste to a client (no internal terms). */
  lines: string[];
  /** The Clients receipt lines for the same week (came in, answered, booked, won), for one account only. */
  clientLines: string[];
  historyStarts: string | null;
  /** Names the account when one is chosen, else null. */
  accountName: string | null;
};

export type Td3Tile = {
  id: "reply" | "waiting" | "showrate" | "open_deals" | "stale" | "attention";
  label: string;
  /** The number as text ("12 min", "37%", "$48,200"), or the reason there is none. */
  value: string;
  enough: boolean;
  /** A small line under the number: what is needed when there is not enough yet ("Needs 5 answered leads (0 so far)"), else null. */
  caption: string | null;
  /** One line of what it is and what it counts. */
  formula: string;
  /** "+12%" style change against the period before, only when both periods have enough. */
  change: string | null;
  estimate: boolean;
  /** What a tap opens: a list of rows, or another screen. */
  opens: { list: Td3ListKind } | { module: Td3Module };
  count: number;
};
export type Td3Numbers = { tiles: Td3Tile[]; days: number; /** The first and last day counted (YYYY-MM-DD), the date bar's window. */ from?: string; to?: string; historyStarts: string | null; testDealsLeftOut: number };

export type Td3Settings = {
  emailOn: boolean; emailHour: number; quietDays: number[]; recipients: string[]; timezone: string; canEdit: boolean;
  /** Plain note: the email is shown to you but only sent when sending is switched on for this business. */
  sendingNote: string | null;
};

export type Td3Options = { accounts: { locationId: string; name: string }[] };
