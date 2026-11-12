// INTERIM copy of the API response types the Appointments UI uses. Slice AD owns the real file (appointments3-types.ts); names match so the UI barrel
// (src/app/app/views/ap3/types.ts) switches with one line. Money is whole cents. Rates are 0..1 or null when there is not enough data.

export type ApOutcome = "won" | "lost" | "showed" | "noshow" | "cancelled" | "unmarked";
export type ApStatus = "booked" | "confirmed" | "showed" | "noshow" | "cancelled" | "invalid" | "completed";
export type ApPart = "overview" | "needs-outcome" | "no-show-recovery" | "booking-share" | "flow-tree" | "health" | "sources" | "calendars" | "options" | "compare" | "proof" | "list";

/** Filters every part accepts. Dates are ISO days. */
export type ApScope = { from: string; to: string; locationId?: string; calendarId?: string; source?: string; userId?: string };
import type { PersonRollup } from "./appointments3-intel.ts";
export type ApPage<T> = { total: number; page: number; pageSize: number; rows: T[] };

export type ApRow = {
  id: string; locationId: string; accountName: string; contactId: string; contactName: string; startAt: string; calendarName: string; calendarGroup?: string | null;
  status: ApStatus; ownerId: string | null; ownerName: string | null; bookerId: string | null; bookerName: string | null; source: string | null;
  dealValueCents: number | null; dealStatus: "open" | "won" | "lost" | "none"; phone?: string | null; hoursPast: number | null; url?: string | null; calendarId?: string | null; /** The contact asked not to be contacted. */ dnd?: boolean; flags: Array<"double-booked" | "no-deal">;
};

export type ApOverview = {
  today?: { doubleBookings: number; idlePeople: number };
  headline: { needsOutcome: number; noShowsToRecover: number; reportedShowRate: number | null; trueShowRate: number | null; trueRange: [number, number] | null; marked: number; booked: number;
    /** Appointments confirmed as shown, and everything that has passed (showed + no-show + no outcome): the two numbers behind the true show rate. */ showed: number; passed: number;
    /** The appointments the revenue-at-risk figure is made of. */ atRisk: number };
  revenueAtRisk: { lowCents: number; highCents: number; basis: string } | null;
  journey: Array<{ key: "booked" | "showed" | "won"; label: string; count: number }>;
  cards: {
    worstAccount: { id: string; name: string; noShowRate: number; noShows: number; of: number } | null;
    topSetter: { id: string; name: string; showRate: number; showed: number; of: number } | null;
    /** Bookings with no booker recorded (left out of "who books the best"). */ unrecordedBookers: number;
    leak: { text: string; count: number; params: { booker?: string; owner?: string; outcome?: string }; names: { booker?: string; owner?: string } } | null;
  };
  needsPermission: boolean;
};

export type ApStats = { bookings: number; showRate: number | null; noShowRate: number | null; closeRate: number | null; revenueCents: number; avgLeadToBookedHours: number | null };
export type ApFlowCloser = ApStats & { id: string; name: string; outcomes: Record<ApOutcome, number>; /** The calendar this pair booked on (a name, or "N calendars"). Shown as a chip on each leaf. */ calendar?: string | null };
export type ApFlowSetter = ApStats & { id: string; name: string; closers: ApFlowCloser[]; hiddenClosers: number };
export type ApFlowTree = {
  booked: number; periodLabel: string; setters: ApFlowSetter[]; hiddenSetters: number;
  totals: Record<ApOutcome, number>; overall: { showRate: number | null; noShowRate: number | null; closeRate: number | null };
  /** Fewest bookings before a person gets a colour (below it the branch is grey: not enough data). */
  minBookings: number;
};

export type ApPersonRow = ApStats & { id: string; name: string; role: "setter" | "closer" | "both"; /** The row for bookings with no booker recorded. */ unassigned?: boolean; /** On that row: bookings with no owner. */ noOwner?: number; trend: number[];
  /** Plain team role, whether they have bookings in these dates, and the calendars they are on / booked into. */
  roleLabel?: string | null; state?: "booked" | "none_this_period" | "never"; owned?: number; lastBookingAt?: string | null; inTeam?: boolean; teamActive?: boolean;
  calendars?: Array<{ calendarId: string; name: string | null; groupName: string | null; active: boolean }>;
  byCalendar?: Array<{ calendarId: string | null; name: string | null; groupName: string | null; booked: number; owned: number }>;
  /** Sales credited to the closer, their value in cents, sales from meetings this person booked, sales as a share of meetings taken, meetings taken that showed, and calendars the person is on. */
  sold?: number; soldCents?: number; setRole?: string | null; soldFromBookings?: number; soldRate?: number | null; ownedShowed?: number; calendarCount?: number; showed?: number; noShow?: number };
export type ApSaleInfo = { basis: "deal_won" | "payment" | "assigned_closer"; countWithoutValue: boolean; available: boolean; phrase: string; rule: string; reason: string | null; roleFallback: boolean };
export type ApShareView = { rows: ApPersonRow[]; total: number; rosterTotal: number; roles: Array<{ key: string; label: string; n: number }>; historyStarts?: string; counts?: { withBookings: number; none: number };
  sections?: { active: number; oncal: number; off: number }; summary?: { peopleBooked: number; booked: number; showed: number; showRate: number | null; sold: number; soldCents: number }; sale?: ApSaleInfo };
export type ApHealthRow = { locationId: string; name: string; booked: number; showRate: number | null; noShowRate: number | null; cancelRate: number | null; unmarked: number };
export type ApSourceRow = { source: string; booked: number; showRate: number | null; medianFirstReplyMinutes: number | null; won: number };
export type ApSpeedBand = { label: string; booked: number; showRate: number | null };
export type ApConflictRow = { id: string; kind: "double-booking"; accountName: string; calendarName: string; when: string | null; people: string[]; note: string };
export type ApCalendarRow = { locationId: string; accountName: string; calendarId: string; calendarName: string; bookings: number; lastBookingAt: string | null; daysSince: number | null; groupName?: string | null; active?: boolean };
export type ApPersonCalRow = PersonRollup;
export type ApProblem = { key: string; label: string; tone: "red" | "amber"; count: number; why: string; available: boolean };
export type ApCalendarsView = { /** All double bookings found (the rows are the first page of them). */ conflictTotal?: number; rows: ApConflictRow[]; calendars: ApCalendarRow[]; people: ApPersonCalRow[]; problems: ApProblem[]; calendarsSkipped?: number; historyStarts?: string };
export type ApProof = { weekOf: string; weekEnd?: string; locationId?: string | null; accountName: string; booked: number; showed: number; recovered: number; stillUnmarked: number; trueShowRate: number | null; caught: number; fixed: number };
export type ApSavedView = { id: string; name: string; scope: Partial<ApScope> & { q?: string } };
