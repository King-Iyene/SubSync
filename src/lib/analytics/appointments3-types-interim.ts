// INTERIM copy of the API response types the Appointments UI uses. Slice AD owns the real file (appointments3-types.ts); names match so the UI barrel
// (src/app/app/views/ap3/types.ts) switches with one line. Money is whole cents. Rates are 0..1 or null when there is not enough data.

export type ApOutcome = "won" | "lost" | "showed" | "noshow" | "cancelled" | "unmarked";
export type ApStatus = "booked" | "confirmed" | "showed" | "noshow" | "cancelled" | "invalid" | "completed";
export type ApPart = "overview" | "needs-outcome" | "no-show-recovery" | "booking-share" | "flow-tree" | "health" | "sources" | "calendars" | "reminders" | "proof" | "list";

/** Filters every part accepts. Dates are ISO days. */
export type ApScope = { from: string; to: string; locationId?: string; calendarId?: string; source?: string; userId?: string };
export type ApPage<T> = { total: number; page: number; pageSize: number; rows: T[] };

export type ApRow = {
  id: string; locationId: string; accountName: string; contactId: string; contactName: string; startAt: string; calendarName: string;
  status: ApStatus; ownerId: string | null; ownerName: string | null; bookerId: string | null; bookerName: string | null; source: string | null;
  dealValueCents: number | null; dealStatus: "open" | "won" | "lost" | "none"; hoursPast: number | null; flags: Array<"double-booked" | "no-reminder" | "unconfirmed" | "no-deal">;
};

export type ApOverview = {
  headline: { needsOutcome: number; noShowsToRecover: number; reportedShowRate: number | null; trueShowRate: number | null; trueRange: [number, number] | null; marked: number; booked: number };
  revenueAtRisk: { lowCents: number; highCents: number; basis: string } | null;
  journey: Array<{ key: "booked" | "confirmed" | "showed" | "won"; label: string; count: number }>;
  cards: { worstAccount: { id: string; name: string; noShowRate: number } | null; topSetter: { id: string; name: string; showRate: number } | null; leak: string | null };
  needsPermission: boolean;
};

export type ApStats = { bookings: number; showRate: number | null; noShowRate: number | null; closeRate: number | null; burned: number; revenueCents: number; avgLeadToBookedHours: number | null };
export type ApFlowCloser = ApStats & { id: string; name: string; outcomes: Record<ApOutcome, number> };
export type ApFlowSetter = ApStats & { id: string; name: string; closers: ApFlowCloser[]; hiddenClosers: number };
export type ApFlowTree = {
  booked: number; periodLabel: string; setters: ApFlowSetter[]; hiddenSetters: number;
  totals: Record<ApOutcome, number>; overall: { showRate: number | null; noShowRate: number | null; closeRate: number | null };
  /** Fewest bookings before a person gets a colour (below it the branch is grey: not enough data). */
  minBookings: number;
};

export type ApPersonRow = ApStats & { id: string; name: string; role: "setter" | "closer" | "both"; unassigned?: boolean; trend: number[] };
export type ApHealthRow = { locationId: string; name: string; booked: number; showRate: number | null; noShowRate: number | null; cancelRate: number | null; unmarked: number; rescheduleRate: number | null };
export type ApSourceRow = { source: string; booked: number; showRate: number | null; medianFirstReplyMinutes: number | null; won: number };
export type ApSpeedBand = { label: string; booked: number; showRate: number | null };
export type ApConflictRow = { id: string; kind: "double-booking" | "forced-overlap" | "disconnected"; accountName: string; calendarName: string; when: string | null; people: string[]; note: string };
export type ApReminderRow = ApRow & { reminderState: "none" | "sent" | "confirmed" | "failed"; hoursToStart: number };
export type ApProof = { weekOf: string; accountName: string; booked: number; showed: number; recovered: number; stillUnmarked: number; trueShowRate: number | null; caught: number; fixed: number };
export type ApSavedView = { id: string; name: string; scope: Partial<ApScope> & { q?: string } };
