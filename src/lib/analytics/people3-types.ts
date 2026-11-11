// Team (People) module: response types of GET /api/app/people3?part=... Types only: no imports, safe for the browser. Builder PU codes the screens against these; builder PB reads
// the PB tables named at the bottom. REAL synced data only. Anything under its minimum is { enough: false } (the screen says "Not enough data"). Trends come from our own
// timestamps; history-based figures carry `historyStarts` (YYYY-MM-DD). Idle always means "no activity recorded in your CRM", never "not working". Definitions: docs/METRICS.md "Team 3".

export const PP3_PARTS = [
  "today", "scorecards", "workload", "leaderboard", "money", "coaching", "access", "proof", "person", "handoff", "nextlead", "list", "options", "export",
] as const;
export type Pp3Part = (typeof PP3_PARTS)[number];

/** Flags of the module (default off in code; switched on after the tenancy check). */
export const PP3_FLAGS = [
  "pp_module", "pp_today", "pp_scorecards", "pp_workload", "pp_leaderboard", "pp_money", "pp_coaching", "pp_access", "pp_proof", "pp_nextlead", "pp_idle", "pp_rollup", "pp_actions", "pp_roles",
] as const;
export type Pp3Flag = (typeof PP3_FLAGS)[number];

/** Shared query parameters (all optional). Every account id (location) and person id (user) is checked on the server against the caller's own accounts and people; an id that is not theirs
 *  is answered like nothing there and never echoed. from/to: ISO dates (default last 28 days). after: the keyset cursor a page returned as `next` (never built by the screen).
 *  role: setter | closer (leaderboard, scorecards filter). all=1: the owner asks for the full ranking instead of the top half. admins=1: include owner and admin rows in rankings. */
export type Pp3Query = {
  part: Pp3Part; from?: string; to?: string; location?: string; user?: string; q?: string; sort?: Pp3Sort; dir?: "asc" | "desc"; after?: string; size?: 25 | 50 | 100;
  role?: "setter" | "closer"; source?: string; reason?: Pp3Reason; all?: 1; admins?: 1; named?: 1; week?: string; what?: "scorecards";
};
export const PP3_SORTS = ["name", "answered", "reply", "in_time", "appts", "showed", "won", "waiting"] as const;
export type Pp3Sort = (typeof PP3_SORTS)[number];

/** Each reason is a count that opens exactly its rows (part=list&reason=...&user=...&location=...). */
export const PP3_REASONS = ["waiting", "waiting_old", "stale_deals", "open_deals", "needs_outcome", "upcoming", "no_owner"] as const;
export type Pp3Reason = (typeof PP3_REASONS)[number];

export type Rate = { value: number | null; n: number; of: number; enough: boolean };
export type Delta = { current: number; previous: number; change: number | null; enough: boolean };
/** Keyset page: `next` is the cursor for the following page, null at the end. total is the full count for the filter. */
export type Page<T> = { rows: T[]; total: number; size: number; next: string | null; truncated: boolean };

// ---- people ----

/** What a person is in the CRM (from the users list): owner and admin rows are shown but left out of rankings by default. */
export type Pp3Role = "agency_admin" | "agency_staff" | "account_admin" | "account_user" | "unknown";
/** named: the name came from the CRM or was typed. unnamed: seen in activity but no name (offer "Name them"). former: no longer in the CRM (history kept, greyed). needs_permission: the users list could not be read. */
export type Pp3NameState = "named" | "unnamed" | "former" | "needs_permission";

export type Pp3AccountRef = { locationId: string; name: string };

export type Pp3Person = {
  userId: string; name: string; nameState: Pp3NameState; initials: string; photoUrl: string | null;
  role: Pp3Role; isAdmin: boolean;
  /** Agency admins and owners reach every account; for them `accounts` lists the accounts they were active in and allAccounts is true. */
  allAccounts: boolean; accountCount: number; accounts: Pp3AccountRef[];
  /** Only for the agency owner and admins, never for a person's own row of a client staff session. */
  email: string | null;
  deleted: boolean; firstSeen: string | null; lastSeen: string | null;
  /** Last recorded human touch in any account in view. Never "last login": the CRM does not give that. */
  lastActivityAt: string | null;
  /** SubSync-only flag set by the team lead (PB table user_away). */
  away: { until: string } | null;
  /** A person seen in activity but not in the users list yet. */
  isNew: boolean;
};

// ---- scorecards ----

/** One person for the chosen period (all accounts in view, or the one account asked for). Rates carry n and enough. Trends compare with the equal period before. */
export type Pp3Scorecard = {
  person: Pp3Person;
  answeredFirst: Delta; // leads whose FIRST human reply was this person (by lead date)
  typicalReplySeconds: number | null; typicalReplyPrev: number | null; // middle of the daily middles; business hours rule of the Speed screen
  inTime: Rate; // answeredFirst replied within the account's target
  apptsSet: Delta; // appointments this person created (the creator the CRM records)
  apptsSetEstimated: number; // appointments with no recorded creator where this person is the likely one (last human touch before it). An estimate.
  showed: Rate; // of the appointments they OWN (at the time) that were held or no-show
  setShowed: Rate; // of the appointments they SET that were held or no-show
  wonCount: number; wonValue: Delta; lostCount: number;
  touches: { sms: number; email: number; call: number; other: number };
  waiting: number; // leads waiting for a reply from them right now (live)
  accounts: number; enough: boolean; historyStarts: string | null;
  /** 8 weekly points of first replies, oldest first, for the small trend line. */
  spark: number[];
};

export type Pp3Scorecards = Page<Pp3Scorecard> & {
  period: { from: string; to: string; days: number };
  /** Activity nobody can be credited with: automatic messages, and messages with no person recorded. Shown beside the table, never as a person. */
  unattributed: { automated: number; unknown: number };
  people: number;
};

// ---- workload ----

export type Pp3LoadState = "over" | "under" | "normal" | "unknown";
export type Pp3WorkloadRow = {
  person: Pp3Person; location: Pp3AccountRef;
  waiting: number; waitingOld: number; // waiting for a reply; of those, waiting over 2 hours
  openDeals: number; openValue: number; staleDeals: number; staleValue: number;
  upcoming: number; needsOutcome: number;
  /** Open items (waiting + open deals + upcoming) against the team's own middle in the same account. */
  load: Pp3LoadState; /** One plain line, for example "2.4 times the team's middle (9 open items)". Null when unknown. */ loadWhy: string | null;
  lastTouchAt: string | null;
  /** Idle = no human touch recorded in working hours for the set hours while leads wait. Null when the rule is off or not enough to judge. */
  idle: { hours: number; waitingLeads: number } | null;
};
export type Pp3Workload = Page<Pp3WorkloadRow> & { medianOpen: number | null; over: number; under: number; idleCount: number; idleHours: number; historyStarts: string | null };

// ---- leaderboard ----

/** One ranked person inside ONE account, compared only with people who answered the same sources. */
export type Pp3Ranked = {
  rank: number | null; // null = under the minimum or tied: shown, not ranked
  person: Pp3Person; n: number; enough: boolean;
  /** Setters: share answered in time. Closers: share of closed deals won. */
  value: Rate;
  /** The same share the account's other people would have had on the SAME mix of sources. */
  expected: number | null; /** value minus expected, in points. The thing the board sorts on. */ vsMix: number | null;
  /** One plain line saying why, for example "Answers 18 points more of their leads in time than the team does on the same sources". */
  why: string;
};
export type Pp3Board = {
  location: Pp3AccountRef; kind: "setters" | "closers";
  /** top_half: owner default (research warns that full rankings demotivate); all: the owner asked. */
  visibility: "top_half" | "all"; ranked: number; shown: Pp3Ranked[]; hidden: number;
  /** For a person asking about themselves: their own place. */ you: { rank: number | null; of: number; why: string } | null;
  minLeads: number; minDays: number; enough: boolean; note: string | null;
};
export type Pp3Leaderboard = { period: { from: string; to: string; days: number }; boards: Pp3Board[]; page: { total: number; next: string | null }; minLeads: number; minDays: number; historyStarts: string | null };

// ---- money ----

export type Pp3MoneyRow = {
  person: Pp3Person; location: Pp3AccountRef | null;
  wonCount: number; wonValue: number; lostValue: number;
  openValue: number; staleValue: number;
  /** Open deals' value on leads still waiting for a reply from someone. */
  waitingValue: number;
  /** Stale or waiting, each deal counted once. An estimate: the formula is in `formula`. */
  atRiskValue: number;
  /** Counted deals only: a value above zero and an owner (the same rule as the Pipeline). */
  enough: boolean;
};
export type Pp3Money = Page<Pp3MoneyRow> & {
  period: { from: string; to: string; days: number };
  totals: { wonValue: number; openValue: number; atRiskValue: number };
  formula: string; isEstimate: true; historyStarts: string | null;
};

// ---- coaching (PB owns the notes, targets and away tables; this part reads them) ----

export type Pp3Note = { id: string; userId: string; locationId: string | null; authorName: string; title: string; body: string; shared: boolean; createdAt: string; canDelete: boolean };
export type Pp3Target = { userId: string; locationId: string | null; metric: "reply_minutes" | "in_time_share" | "appointments_week" | "show_share" | "won_value_month"; value: number; label: string };
export type Pp3Move = { metric: string; label: string; current: number | null; previous: number | null; unit: "minutes" | "pct" | "count" | "money"; better: boolean | null; line: string };
export type Pp3Coaching = {
  person: Pp3Person | null;
  /** The weekly "one thing to work on": their own weakest metric against their own previous four weeks. Null when there is not enough history. */
  oneThing: { metric: string; line: string; evidence: string } | null;
  moves: Pp3Move[];
  notes: Pp3Note[]; targets: Pp3Target[];
  /** People with no coaching note in 30 days, for the owner's list (agency owner and admins only). */
  people: Array<{ person: Pp3Person; lastNoteAt: string | null }>;
  historyStarts: string | null;
};

// ---- access ----

export type Pp3AccessRow = {
  person: Pp3Person;
  /** Verified = we hold a verified sign-in record (account people). Null = not tracked for agency staff. */
  verified: boolean | null;
  flags: Array<"no_account" | "deleted" | "unnamed" | "new">;
};
export type Pp3AccountRisk = { location: Pp3AccountRef; kind: "nobody_active" | "single_point"; person: { userId: string; name: string } | null; sharePct: number | null; line: string };
export type Pp3Access = Page<Pp3AccessRow> & {
  risks: Pp3AccountRisk[];
  /** Accounts whose users list could not be read: "Needs permission: reconnect". */
  needsPermission: Pp3AccountRef[];
  newPeople: number; deletedPeople: number;
  /** Accounts in view with their people count (matrix columns). */
  accounts: Array<Pp3AccountRef & { people: number }>;
};

// ---- proof (client-facing receipt of how the team handled a client's leads) ----

export type Pp3ProofStaff = { name: string; answered: number; typicalReplyMinutes: number | null };
export type Pp3Proof = {
  location: Pp3AccountRef | null; period: { from: string; to: string; days: number };
  leads: number; answered: number; answeredPct: Rate; typicalReplyMinutes: number | null; targetMinutes: number | null; inTime: Rate;
  appointments: number; showed: number; noShow: number; showedPct: Rate;
  /** Only when the agency chose to name staff for this client AND the caller may (agency owner or admin). */
  staff: Pp3ProofStaff[] | null; naming: "team" | "named";
  lines: string[]; historyStarts: string | null; generatedAt: string;
};

// ---- person panel ----

export type Pp3Week = { start: string; answeredFirst: number; typicalReplySeconds: number | null; inTimePct: number | null; apptsSet: number; showedPct: number | null; wonValue: number };
export type Pp3PersonPanel = {
  person: Pp3Person; headline: string;
  weeks: Pp3Week[]; // 8 weeks, oldest first
  accounts: Array<{ location: Pp3AccountRef; role: Pp3Role; waiting: number; waitingOld: number; openDeals: number; openValue: number; staleDeals: number; upcoming: number; needsOutcome: number; lastTouchAt: string | null; load: Pp3LoadState }>;
  scorecard: Pp3Scorecard | null;
  /** Workload now against 8 weeks ago (our own daily snapshots). Null until two snapshots exist. */
  workloadTrend: Array<{ day: string; open: number }>;
  nextLeadEligible: boolean;
  openInCrmUrl: string | null;
  /** The ids of the previous and next person in the current sort, for the panel arrows. */
  prev: string | null; next: string | null;
  historyStarts: string | null;
};

// ---- handoff (booked by A, closed by B) ----

export type Pp3HandoffRow = { setter: { userId: string | null; name: string }; closer: { userId: string | null; name: string }; deals: number; wonValue: number; medianDays: number | null; location: Pp3AccountRef | null };
export type Pp3Handoff = Page<Pp3HandoffRow> & { period: { from: string; to: string; days: number }; windowDays: number; note: string };

// ---- who should get the next lead (an estimate, never auto-assigns) ----

export type Pp3NextLead = {
  location: Pp3AccountRef | null; source: string | null; isEstimate: true;
  suggestion: { userId: string; name: string; reasons: string[]; sample: number } | null;
  /** Why there is no suggestion: not_enough_data | nobody_available | no_account. */
  hidden: "not_enough_data" | "nobody_available" | "no_account" | null;
  /** Everyone considered, with the reason each was or was not first. */
  considered: Array<{ userId: string; name: string; waiting: number; answersSourceMinutes: number | null; sample: number; away: boolean }>;
};

// ---- today ----

export type Pp3TodayLine = { text: string; kind: "waiting" | "idle" | "overload" | "single_point" | "new_person" | "nobody_active"; count: number; userId: string | null; locationId: string | null; reason: Pp3Reason | null };
export type Pp3Today = {
  /** One to three plain lines, worst first. Empty = nothing needs you. For a person without full access these are their own queue. */
  lines: Pp3TodayLine[];
  button: { label: string; userId: string | null; locationId: string | null; reason: Pp3Reason | null; count: number } | null;
  people: number; accounts: number; waitingOld: number; idleCount: number; overCount: number;
  headline: string; historyStarts: string | null;
};

export type Pp3Options = {
  viewer: { level: "all" | "account" | "self"; userId: string | null; canSeeEmail: boolean; canRankAll: boolean };
  accounts: Pp3AccountRef[]; minLeads: number; minDays: number; idleHours: number;
  usersState: "ok" | "needs_permission" | "unknown";
};

/** One row of part=list: the exact item a count was made from. url opens it in the CRM (the account's own domain). */
export type Pp3ListRow = { id: string; /** The contact behind the row (used to move a lead to another owner); null when the row has none. */ contactId: string | null; kind: "lead" | "deal" | "appointment"; title: string; locationId: string; locationName: string; ageHours: number | null; value: number | null; at: string | null; url: string | null };
export type Pp3List = Page<Pp3ListRow> & { reason: Pp3Reason; label: string };

/** The response envelope added by the route to every body. */
export type Pp3Envelope = { generatedAt: string; cached: boolean; canSee: boolean; flags: Record<string, boolean>; problem: string | null };

// ---- tables owned by the PB (actions) builder, read here (supabase/migrations/20261203090000_people_actions.sql) ----
//   coaching_notes(installation_id, id, subject_user_id, location_id, title, body, shared_with_subject, author_user_id, author_name, created_at, removed_at)
//   user_targets(installation_id, user_id, location_id ('' = every account), metric, target)   metrics: reply_minutes | in_time_share | appointments_week | show_share | won_value_month
//   user_away(installation_id, user_id, kind 'away' | 'idle_snooze', starts_at, until, released_at)
// A missing table never breaks a screen: the part answers with empty notes, targets and no away flag.
