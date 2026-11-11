// Appointments module, round 3: the response types of GET /api/app/appointments?part=... (types only: no imports, safe for the browser).
// Money fields are ESTIMATES unless named "won"; every estimate carries `estimate: true` and the formula in `formula`. Anything under its
// minimum sample is { enough: false } and the screen says "not enough data", never a made-up number. Definitions: docs/METRICS.md "Appointments 3".

export const APPT3_PARTS = [
  "overview", "needs-outcome", "noshow-recovery", "booking-share", "flow-tree", "health", "sources", "calendars", "reminders", "receipt", "list", "detail",
] as const;
export type Appt3Part = (typeof APPT3_PARTS)[number];

/** Shared query parameters (all optional): from, to (ISO dates), location, calendar, user (person), source, page (0-based), size (20|50|100), sort, q, dir. */
export type Appt3Query = {
  part: Appt3Part; from?: string; to?: string; location?: string; calendar?: string; user?: string; source?: string;
  page?: number; size?: 20 | 50 | 100; sort?: string; q?: string; bucket?: Appt3Bucket;
  /** Flow tree and lists: a booker id or "none" (setter), an owner id or "none" (closer); compare = "idA,idB" (two setters); top = how many setters to show (3 to 30, default 12); week = Monday date (YYYY-MM-DD) for the receipt. */
  setter?: string; closer?: string; compare?: string; top?: number; week?: string;
};

/** Our own groups of statuses. `unmarked` = time passed (by 3h) with no outcome. `no_deal` = no deal linked to the contact. */
export type Appt3Bucket = "booked" | "unmarked" | "showed" | "noshow" | "cancelled" | "invalid" | "completed" | "won" | "lost" | "open" | "no_deal" | "upcoming" | "confirmed" | "recovered" | "burned";

export type Estimate = { value: number | null; low: number | null; high: number | null; enough: boolean; estimate: true; formula: string; minNote: string | null };
export type Rate = { value: number | null; n: number; of: number; enough: boolean };

export type Appt3Row = {
  appointmentId: string; locationId: string; accountName: string | null;
  contactId: string | null; contactName: string; url: string | null;
  calendarId: string | null; calendarName: string | null;
  startAt: string; endAt: string | null; status: string; bucket: Appt3Bucket;
  ownerId: string | null; ownerName: string | null; bookerId: string | null; bookerName: string | null;
  source: string | null; dealStatus: "won" | "lost" | "open" | null; dealValue: number | null;
  leadToBookedMinutes: number | null; firstReplyMinutes: number | null;
  rescheduleCount: number; reminders: number; confirmed: boolean; hasConflict: boolean;
  /** Why it is on this list, in plain words (for example "Time passed 2 days ago, no outcome"). */
  why: string | null;
  dnd: boolean;
};

export type Page<T> = { rows: T[]; total: number; page: number; size: number; pages: number; truncated: boolean };

export type Appt3Overview = {
  headline: string; button: { label: string; part: Appt3Part; bucket: Appt3Bucket | null; count: number } | null;
  booked: number; unmarked: number; trueShowRate: Rate; reportedShowRate: Rate;
  noshowToRecover: number; recoveredLast30: number; noDealLinked: number; upcoming: number;
  revenueAtRisk: Estimate; revenueWon: { value: number; n: number };
  /** Booked, confirmed, showed, closed: the numbers of the animated journey. Each step's count equals its list. */
  journey: Array<{ key: "booked" | "confirmed" | "showed" | "won"; label: string; count: number; bucket: Appt3Bucket }>;
  cards: Array<{ key: string; title: string; value: number | string; sub: string | null; part: Appt3Part; bucket: Appt3Bucket | null }>;
  trend: Array<{ day: string; booked: number; showed: number; noshow: number; unmarked: number }>;
  windowDays: number; dealWindowDays: number; accounts: number;
};

export type Appt3NeedsOutcome = Page<Appt3Row> & {
  /** Our own suggestion from a later deal move or message; shown, never applied automatically. */
  suggestions: Record<string, { outcome: "showed" | "noshow"; reason: string }>;
  oldestDays: number | null;
};

export type Appt3Recovery = Page<Appt3Row & { rebooked: boolean; snoozedUntil: string | null; daysSince: number }> & {
  recovered: { count: number; value: number; rebookedWithin24hRate: Rate };
};

export type Appt3PersonShare = {
  userId: string | null; name: string; role: "setter" | "closer" | "both" | "none";
  booked: number; owned: number; showed: number; noshow: number; unmarked: number; won: number; lost: number;
  showRate: Rate; noshowRate: Rate; closeRate: Rate; wonValue: number; leadToBookedMedianMinutes: number | null;
  burned: number; trend: Array<{ week: string; booked: number; showRate: number | null }>;
};
export type Appt3BookingShare = Page<Appt3PersonShare> & {
  unassigned: number; ownerless: number;
  /** Round-robin fairness per appointment, not per day: share of owned bookings per closer against an even split. */
  fairness: { enough: boolean; maxSharePct: number | null; evenSharePct: number | null; closers: number };
};

/** One node of the Flow Tree. Width = count. health: 0 (red) to 1 (green) or null when there is not enough data. */
export type FlowNode = {
  id: string; level: "root" | "setter" | "closer" | "leaf"; label: string; userId: string | null; parentId: string | null;
  count: number; health: number | null; best: boolean;
  badges: null | { bookings: number; showRate: Rate; noshowRate: Rate; closeRate: Rate; burned: number; wonValue: number; leadToBookedMedianMinutes: number | null };
  leaf?: "showed" | "noshow" | "cancelled" | "unmarked" | "won" | "lost" | "open";
  /** What a click opens: the exact appointment list (count equals rows). */
  open: { setter?: string | null; closer?: string | null; bucket?: Appt3Bucket };
};
export type Appt3FlowTree = {
  nodes: FlowNode[]; period: { from: string; to: string }; totalBooked: number; topN: number; hiddenPeople: number;
  /** The single biggest drop, in plain words, with the node to open. */
  leak: null | { text: string; nodeId: string; lostAppointments: number };
  /** Who should get the next lead: an ESTIMATE from past conversion, null under the minimum. */
  nextLead: null | { userId: string; name: string; estimate: true; formula: string };
  compare?: null | { a: FlowNode; b: FlowNode };
};

export type Appt3Health = Page<{
  locationId: string; accountName: string | null; vertical: string | null;
  booked: number; showRate: Rate; cancelRate: Rate; noshowRate: Rate; unmarked: number; rescheduleRate: Rate; target: number | null; belowTarget: boolean;
  worstReason: string | null;
}> & { verticals: Array<{ vertical: string; accounts: number; showRate: Rate }> };

export type Appt3Sources = {
  bySource: Array<{ source: string; booked: number; showRate: Rate; closeRate: Rate }>;
  bySpeed: Array<{ band: "under_5m" | "5_to_30m" | "30m_to_2h" | "over_2h" | "none"; label: string; booked: number; showRate: Rate }>;
  byLeadTime: Array<{ band: string; booked: number; showRate: Rate }>;
  byWeekday: Array<{ weekday: number; booked: number; showRate: Rate }>;
  byHour: Array<{ hour: number; booked: number; showRate: Rate }>;
  bestSlots: Array<{ weekday: number; hour: number; showRate: number; n: number }>;
  sourceBlank: number;
};

export type Appt3Conflict = {
  kind: "double_booking" | "forced_overlap"; locationId: string; accountName: string | null; calendarName: string | null;
  a: Appt3Row; b: Appt3Row; overlapMinutes: number;
};
export type Appt3Calendars = {
  conflicts: Page<Appt3Conflict>;
  disconnected: Array<{ locationId: string; accountName: string | null; calendarId: string; calendarName: string | null; lastBookingAt: string | null; reason: "no_bookings_30d" | "needs_permission" | "sync_stale" }>;
  trend: Array<{ week: string; booked: number; rescheduled: number; cancelled: number }>;
  roundRobin: Array<{ calendarId: string; calendarName: string | null; locationId: string; members: Array<{ userId: string | null; name: string; owned: number; sharePct: number }> }>;
  capacity: Array<{ month: string; booked: number }>;
  /** Every calendar seen for these accounts, with a count that may be zero (idle calendars are listed too). */
  calendarsAll?: Array<{ locationId: string; accountName: string | null; calendarId: string; calendarName: string | null; bookings: number; lastBookingAt: string | null; daysSince: number | null }>;
  /** Every named person (and anyone who owns a booking), with a count that may be zero. `everBooked` = owned any booking at all. */
  peopleAll?: Array<{ userId: string; name: string; bookings: number; sharePct: number; lastBookingAt: string | null; daysSince: number | null; everBooked: boolean }>;
  /** Calendar problems at a glance. `available: false` = the platform does not give us that data yet (never a guess). */
  problems?: Array<{ key: string; label: string; tone: "red" | "amber"; count: number; why: string; available: boolean }>;
  needsPermission: boolean;
};

export type Appt3Reminders = {
  noReminder: Page<Appt3Row>; notConfirmed24h: Page<Appt3Row>;
  effectiveness: { enough: boolean; withReminder: Rate; without: Rate; minNote: string | null };
  riskFlags: Array<{ appointmentId: string; locationId: string; flags: Array<"not_confirmed" | "no_reminder" | "first_time_no_show_history" | "short_notice"> }>;
  historyDays: number;
};

export type Appt3Receipt = {
  weekStart: string; weekEnd: string; locationId: string | null; accountName: string | null;
  booked: number; showed: number; noshow: number; recovered: number; stillUnmarked: number; fixedByUs: number;
  trueShowRate: Rate; won: { value: number; n: number }; headline: string; verifyHash: string | null;
};

/** One appointment with its full append-only history, for the right-side panel. */
export type Appt3Detail = {
  row: Appt3Row; timeline: Array<{ at: string; kind: string; from: string | null; to: string | null; actorName: string | null; actorKind: "person" | "subsync" | "system" | "unknown"; text: string }>;
  rescheduleChain: Array<{ appointmentId: string; startAt: string; status: string }>;
  deal: null | { opportunityId: string; name: string | null; status: string; value: number | null; stage: string | null };
  reminders: Array<{ at: string; channel: string | null }>;
  blockers: Array<"dnd" | "active_payment" | "open_deal" | "upcoming">;
};

/** Every response is { ok: true, ...part } or { error }; `flags` lists which appt_* features are on so the UI can hide the rest. */
export type Appt3Envelope<T> = T & { generatedAt: string; cached: boolean; canSeeAccounts: boolean; flags: Record<string, boolean> };

export const APPT3_FLAGS = [
  "appt_overview", "appt_needs_outcome", "appt_noshow_recovery", "appt_booking_share", "appt_flow_tree", "appt_health", "appt_sources", "appt_calendars",
  "appt_reminders", "appt_meetings", "appt_proof", "appt_actions", "appt_history", "appt_record",
] as const;
export type Appt3Flag = (typeof APPT3_FLAGS)[number];
