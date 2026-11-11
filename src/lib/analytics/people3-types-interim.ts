// Team (People) module, interim response types for GET /api/app/people3?part=... Types only (no imports, safe for the browser).
// Stand-in until the data builder's people3-types.ts lands; the UI imports these through views/pp3/data.tsx only, so swapping is one file.
// REAL synced data only. Anything under its minimum is { enough: false } (the screen says "Not enough data"). History-based figures say "history starts <date>".

export const PP_PARTS = ["options", "today", "scorecards", "handoffs", "workload", "nextlead", "leaderboard", "money", "coaching", "access", "proof", "person", "list"] as const;
export type PpPart = (typeof PP_PARTS)[number];

export type PpRate = { value: number | null; n: number; of: number; enough: boolean };
export type PpDelta = { current: number; previous: number; change: number | null; enough: boolean };
/** A page read by keyset: `next` is the cursor of the next page (null on the last page). */
export type PpPage<T> = { rows: T[]; total: number; next: string | null; truncated: boolean };
export type PpMeta = { flags: Record<string, boolean>; ownRowOnly: boolean; canSeeEveryone: boolean; needsUsersPermission: boolean; problem: string | null; historyStarts: string | null; generatedAt: string | null };
export type PpWith<T> = T & PpMeta;

export type PpRole = "owner" | "admin" | "staff";
export type PpReason = "waiting" | "idle" | "no_outcome" | "overloaded" | "single_point" | "new_person" | "no_account";
export type PpAccountRef = { locationId: string; name: string };

export type PpOptions = { accounts: PpAccountRef[]; minLeads: number; minDays: number; staff: number; idleHours: number };

export type PpTodayLine = { userId: string; name: string; locationId: string | null; accountName: string | null; text: string; reason: PpReason; count: number };
export type PpToday = { headline: string; lines: PpTodayLine[]; button: { label: string; reason: PpReason; userId: string | null; locationId: string | null; count: number } | null; ownQueue: boolean };

/** One row per person, rolled up across their accounts. */
export type PpPerson = {
  userId: string; name: string; unnamed: boolean; email: string | null; role: PpRole; deleted: boolean; awayUntil: string | null;
  accounts: number; accountNames: string[];
  leadsHandled: number; firstReplyMinutes: number | null; inTime: PpRate; appointmentsSet: PpDelta & { estimated: boolean }; showed: PpRate; wonCount: number; wonValue: PpDelta;
  /** 8 weekly points of the share of first replies sent in time, oldest first. */
  spark: number[]; lastActivityAt: string | null; idle: boolean; enough: boolean; url: string | null;
};
export type PpHandoff = { contactName: string; accountName: string; locationId: string; bookedBy: string; closedBy: string; days: number; value: number | null; estimated: boolean; url: string | null };

export type PpLoadLevel = "over" | "under" | "normal" | "unknown";
export type PpLoadRow = { userId: string; name: string; locationId: string; accountName: string; openLeads: number; waiting: number; openDeals: number; upcoming: number; level: PpLoadLevel; /** The team's own normal in this account. */ median: number; why: string | null; enough: boolean };
export type PpNextLead = { locationId: string; accountName: string; userId: string | null; name: string | null; because: string | null; sample: number; enough: boolean; waitingNow: number };

export type PpRank = { userId: string; name: string; rank: number | null; leads: number; value: number | null; why: string; enough: boolean; you: boolean };
export type PpBoardGroup = { locationId: string; accountName: string; mix: string; people: number; rows: PpRank[]; hidden: number; note: string | null };
export type PpBoard = PpPage<PpBoardGroup> & { board: "setters" | "closers"; metric: string; minLeads: number; minDays: number };

export type PpMoneyRow = { userId: string; name: string; locationId: string | null; accountName: string | null; wonValue: number; wonCount: number; openValue: number; staleValue: number; waitingCount: number; waitingValue: number };
export type PpMoney = PpPage<PpMoneyRow> & { totals: { wonValue: number; openValue: number; staleValue: number; waitingValue: number }; formulas: Record<string, string> };

export type PpTarget = { metric: string; label: string; value: number; unit: string };
export type PpNote = { id: string; title: string; text: string; author: string; at: string; shared: boolean; mine: boolean };
export type PpCoach = { userId: string; name: string; lowest: { label: string; now: string; before: string } | null; focus: string | null; targets: PpTarget[]; notes: number; lastNoteAt: string | null; moves: Array<{ label: string; from: string; to: string }>; enough: boolean };

export type PpAccessPerson = { userId: string; name: string; role: PpRole; scope: "all" | "some" | "none"; accountCount: number; accounts: PpAccountRef[]; connected: boolean; lastSeenAt: string | null; newPerson: boolean };
export type PpAccessAccount = { locationId: string; name: string; people: number; active: number; topName: string | null; topShare: PpRate; flags: Array<"nobody_active" | "single_point"> };
export type PpAccess = PpPage<PpAccessPerson | PpAccessAccount> & { by: "person" | "account" };

export type PpProof = {
  locationId: string; accountName: string; from: string; to: string; sentence: string; answered: PpRate; medianMinutes: number | null; inTime: PpRate;
  appointments: { booked: number; held: number; noShow: number }; showed: PpRate; naming: boolean; staff: Array<{ name: string; answered: number; medianMinutes: number | null }> | null; historyStarts: string | null;
};

export type PpPanel = {
  person: PpPerson; headline: string; weeks: string[]; trends: { response: number[]; booked: number[]; showed: number[]; won: number[] };
  accounts: Array<{ locationId: string; name: string; role: string; openLeads: number; waiting: number; openDeals: number; upcoming: number; url: string | null }>;
  focus: string | null; notes: PpNote[]; nextLead: { locationId: string; accountName: string; because: string } | null; historyStarts: string | null;
};
export type PpListRow = { contactName: string; accountName: string; locationId: string; detail: string | null; value: number | null; at: string | null; url: string | null };
