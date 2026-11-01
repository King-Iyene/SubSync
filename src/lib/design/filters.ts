// The one filter model behind the role-aware filter bar (stage D0, notes N8 and N34). Pure: no React, no network. The bar, the link the page lives
// at and the query sent to the server are all made from the same value, so what is on screen, in the address and in the numbers cannot drift apart.

export type FilterKind = "agency" | "business" | "client";
export type RangeKey = "" | "7d" | "30d" | "90d";
export const RANGES: Array<{ key: RangeKey; label: string }> = [{ key: "", label: "Any time" }, { key: "7d", label: "Last 7 days" }, { key: "30d", label: "Last 30 days" }, { key: "90d", label: "Last 90 days" }];

export type FilterValue = {
  /** Client accounts picked in the selector (agency only). Empty means all. */
  accounts: string[];
  industry: string; owner: string; hideTest: boolean;
  /** Filters that one account's staff use. They are carried in the link; a page applies them when it can. */
  user: string; calendar: string; pipeline: string; source: string; range: RangeKey;
};
export const EMPTY_FILTER: FilterValue = { accounts: [], industry: "", owner: "", hideTest: false, user: "", calendar: "", pipeline: "", source: "", range: "" };

type Choice = { key: string; label: string; count?: number };
/** One client account as the filter bar knows it. `test` is a name that says test; `ignored` is set by the owner; industry and owner let the bar say why an account is left out. */
export type AccountOption = { id: string; name: string; test?: boolean; ignored?: boolean; industry?: string | null; owner?: string | null };

export type FilterOptions = {
  accounts?: AccountOption[];
  industries?: Choice[]; owners?: Choice[]; users?: Choice[]; calendars?: Choice[]; pipelines?: Choice[]; sources?: Choice[];
  testAccounts?: number;
  /** The page can narrow by date range. */
  ranges?: boolean;
};
export type ControlId = "accounts" | "industry" | "owner" | "test" | "user" | "calendar" | "pipeline" | "source" | "range";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const WORD = /^[A-Za-z0-9_ .'&-]{1,60}$/;
export const MAX_PICKED_ACCOUNTS = 50;

export function sanitizeFilter(v: Partial<FilterValue>): FilterValue {
  const accounts = Array.isArray(v.accounts) ? [...new Set(v.accounts.filter((x) => typeof x === "string" && /^[A-Za-z0-9_-]{3,64}$/.test(x)))].slice(0, MAX_PICKED_ACCOUNTS) : [];
  const word = (x: unknown) => (typeof x === "string" && WORD.test(x) ? x : "");
  const id = (x: unknown) => (typeof x === "string" && ID.test(x) ? x : "");
  return {
    accounts, industry: typeof v.industry === "string" && /^[a-z_]{2,30}$/.test(v.industry) ? v.industry : "", owner: word(v.owner), hideTest: v.hideTest === true,
    user: id(v.user), calendar: id(v.calendar), pipeline: id(v.pipeline), source: id(v.source), range: RANGES.some((r) => r.key === v.range) ? (v.range as RangeKey) : "",
  };
}

export const isFiltered = (v: FilterValue) => JSON.stringify(sanitizeFilter(v)) !== JSON.stringify(EMPTY_FILTER);

// The parts the server understands today (every read endpoint narrows by these; see segmentSet in src/lib/api/router.ts).
export function filterToQuery(v: FilterValue): string {
  const s = sanitizeFilter(v);
  return [s.accounts.length && `accounts=${s.accounts.join(",")}`, s.industry && `industry=${encodeURIComponent(s.industry)}`, s.owner && `owner=${encodeURIComponent(s.owner)}`, s.hideTest && "hideTest=1"].filter(Boolean).join("&");
}

// Everything, for the address bar, so a link keeps the filter and a page reloads to the same view.
export function filterToLink(v: FilterValue): string {
  const s = sanitizeFilter(v);
  return [filterToQuery(s), s.user && `user=${s.user}`, s.calendar && `calendar=${s.calendar}`, s.pipeline && `pipeline=${s.pipeline}`, s.source && `source=${s.source}`, s.range && `range=${s.range}`].filter(Boolean).join("&");
}

export function filterFromLink(query: string): FilterValue {
  const p = new URLSearchParams(query);
  return sanitizeFilter({
    accounts: (p.get("accounts") ?? "").split(",").filter(Boolean), industry: p.get("industry") ?? "", owner: p.get("owner") ?? "", hideTest: p.get("hideTest") === "1",
    user: p.get("user") ?? "", calendar: p.get("calendar") ?? "", pipeline: p.get("pipeline") ?? "", source: p.get("source") ?? "", range: (p.get("range") ?? "") as RangeKey,
  });
}

// The accounts a request may narrow to, read on the server. Any id that is not a well-formed id is dropped; the caller then intersects the rest
// with the company's own accounts, so an id from someone else's company can never widen or leak anything.
export function parsePickedAccounts(param: string | null | undefined): string[] {
  if (!param) return [];
  return [...new Set(param.split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{3,64}$/.test(x)))].slice(0, MAX_PICKED_ACCOUNTS);
}

// Which controls the bar shows. A control is only shown when there is something to choose between (N1: a filter that does nothing is worse than none),
// and what a person sees depends on who they are (N34): an agency picks client accounts; a client's staff never get an account picker because they
// have one account, but do get their own people, calendars, pipelines and sources. `singleAccount` is a page that is about one account only: the
// account-level controls are absent there (N8).
export function visibleControls(kind: FilterKind, o: FilterOptions, singleAccount = false): ControlId[] {
  const out: ControlId[] = [];
  const many = (c?: Choice[]) => (c?.length ?? 0) >= 2;
  const agencyScope = kind === "agency" && !singleAccount;
  if (agencyScope && (o.accounts ?? []).filter((a) => !a.ignored).length >= 2) out.push("accounts");
  if (agencyScope && many(o.industries)) out.push("industry");
  if (agencyScope && (o.owners?.length ?? 0) >= 1) out.push("owner");
  if (agencyScope && (o.testAccounts ?? 0) >= 1) out.push("test");
  if (many(o.users)) out.push("user");
  if (many(o.calendars)) out.push("calendar");
  if (many(o.pipelines)) out.push("pipeline");
  if (many(o.sources)) out.push("source");
  if (o.ranges) out.push("range");
  return out;
}

// KF-2: WHICH accounts are in, and which are left out and why. Worked out in the browser from the same options the bar shows; the server applies the
// same rules to the numbers (segmentSet in src/lib/api/router.ts), so the list and the numbers cannot disagree.
export type AccountScope = { included: AccountOption[]; left: Array<AccountOption & { reason: string }> };
export function scopeOf(v: FilterValue, o: FilterOptions): AccountScope {
  const s = sanitizeFilter(v);
  const picked = new Set(s.accounts);
  const included: AccountOption[] = [];
  const left: AccountScope["left"] = [];
  for (const a of o.accounts ?? []) {
    const reason = a.ignored ? "set to ignore, never counted"
      : picked.size > 0 && !picked.has(a.id) ? "not picked"
      : s.hideTest && a.test ? "test account, hidden"
      : s.industry && a.industry !== s.industry ? "another kind of business"
      : s.owner && a.owner !== s.owner ? "belongs to another owner"
      : null;
    if (reason) left.push({ ...a, reason }); else included.push(a);
  }
  return { included, left };
}

/** "Ada, Ben and 3 more". */
export function nameList(names: string[], max = 3): string {
  if (names.length <= max) return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

export type HiddenNote = { text: string; clear: Partial<FilterValue> };
// Says what the filter is hiding and gives the way to undo each part, in plain words (N1: "1 account hidden: ... Show it").
export function describeHidden(v: FilterValue, o: FilterOptions): HiddenNote[] {
  const s = sanitizeFilter(v);
  const out: HiddenNote[] = [];
  const live = (o.accounts ?? []).filter((a) => !a.ignored);
  if (s.accounts.length > 0 && live.length > 0) {
    const names = scopeOf({ ...EMPTY_FILTER, accounts: s.accounts }, o).included.map((a) => a.name);
    out.push({ text: `Showing ${names.length} of ${live.length} client accounts: ${nameList(names)}.`, clear: { accounts: [] } });
  }
  if (s.hideTest && (o.testAccounts ?? 0) > 0) {
    // Say WHICH accounts (N1: "1 account hidden: KD Squares Test. Show it"), when the options carry their names.
    const names = (o.accounts ?? []).filter((a) => a.test && !a.ignored).map((a) => a.name);
    out.push({ text: `${o.testAccounts} test ${o.testAccounts === 1 ? "account is" : "accounts are"} hidden because ${o.testAccounts === 1 ? "its" : "their"} name says test${names.length > 0 ? `: ${nameList(names)}` : ""}.`, clear: { hideTest: false } });
  }
  if (s.industry) out.push({ text: `Only ${o.industries?.find((i) => i.key === s.industry)?.label ?? s.industry} clients are shown.`, clear: { industry: "" } });
  if (s.owner) out.push({ text: `Only the clients of ${s.owner} are shown.`, clear: { owner: "" } });
  return out;
}
