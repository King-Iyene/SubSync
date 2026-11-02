// What SubSync watches and what it does not watch yet (note N5, stage F5). One list, in two columns. It used to sit at the bottom of Today as a card;
// it now lives in Settings as the "What SubSync watches" panel, so Today stays clean and the honesty stays.
//
// Rules: a line is in WATCHING only when code reads real data for it today, and it moves across from NOT_YET when it ships (move the object, nothing else).
// A line in NOT_YET always says which of the three causes holds (docs/CAPABILITIES.md, N64): not built yet although the data is there, needs a permission
// SubSync does not ask for, or the platform does not provide it. Plain words only: this is read by agency owners and business owners.

export type CoverageCause = "not_built" | "permission" | "platform";

export type Watching = { id: string; what: string; how: string; needs?: string };
export type NotYet = { id: string; what: string; cause: CoverageCause; why: string };

export const WATCHING: Watching[] = [
  { id: "speed", what: "New leads waiting for a first reply", how: "How long each new lead has waited, against your reply target, and which leads were never answered." },
  { id: "waiting", what: "Conversations waiting for a reply", how: "Messages where the customer wrote last and nobody has answered, in the last 30 days, oldest first.", needs: "Permission to read conversations" },
  { id: "stale", what: "Deals that stopped moving", how: "Open deals with a value and an owner that have not changed for the number of days you set, counted from your CRM." },
  { id: "appointments", what: "Appointments with no outcome, no-shows, unconfirmed bookings", how: "Past appointments nobody marked showed or no-show, no-shows not booked again, and bookings in the next two days that are not confirmed.", needs: "Permission to read calendars" },
  { id: "normal", what: "New leads and stalled deals against each account's own normal", how: "Each client account is compared with its own last week, so a quiet account is not flagged for being quiet." },
  { id: "quiet", what: "Accounts that have gone quiet", how: "Client accounts with no activity for a long time." },
  { id: "email", what: "Email sending setup", how: "Whether the sender setup of a client account is complete, from the checks you run on Setup." },
  { id: "sync", what: "Whether SubSync can still read an account", how: "A read that fails, or data older than a day, is flagged on that account.", },
  { id: "setup", what: "Client accounts with no pipeline", how: "An account with no pipeline has no deal tracking." },
];

export const NOT_YET: NotYet[] = [
  { id: "missed_calls", what: "Missed calls", cause: "not_built", why: "calls do appear in the platform's data (as messages of type call), so this can be built; it is not built yet" },
  { id: "workflows", what: "Failing workflows", cause: "permission", why: "needs a permission SubSync does not ask for, and the platform limits who can use the workflows interface" },
  { id: "billing", what: "Low wallet balance and failed payments", cause: "permission", why: "needs billing permissions SubSync does not ask for" },
  { id: "a2p", what: "Phone registration (A2P) status", cause: "platform", why: "not available from the platform through the interface SubSync uses" },
];

export const CAUSE_LABEL: Record<CoverageCause, string> = {
  not_built: "Not built yet",
  permission: "Needs a permission we do not ask for",
  platform: "The platform does not provide it",
};

/** The old Today card's shape, kept so the daily endpoint and its check keep the same fields. */
export const notWatchedRows = (): Array<{ what: string; why: string }> => NOT_YET.map((n) => ({ what: n.what, why: n.why }));
