// The plain line under the date bar that says, for each page, what the dates change and what is always "as of now" (docs/DATE_RULES.md section 2). Pure and unit tested:
// every page that draws the bar's dates has an entry, and the line always names the SAME window the page asks the server for (the bar's label).

export type DatesEntry = {
  /** What the dates count on this page, in plain words. */
  counts: string;
  /** What is as of now (never narrowed by the dates). null = nothing on the page is. */
  now: string | null;
  /** True when the page already prints its own "Dates: ..." line next to its numbers, so the shell does not repeat it. */
  own?: boolean;
};

export const DATES_NOTES: Record<string, DatesEntry> = {
  today: { counts: "New leads, replies, bookings and results are counted in these dates", now: "Open deals, leads waiting for a reply and the to-do lists are as of now" },
  overview: { counts: "New leads, replies, bookings and results are counted in these dates", now: "Open deals, leads waiting for a reply and the to-do lists are as of now" },
  myday: { counts: "Your replies and bookings are counted in these dates", now: "Your queue is as of now" },
  speed: { counts: "Leads are counted by the day they arrived (the first reply may come after the window)", now: "Leads waiting for a reply right now are as of now" },
  appointments: { counts: "Appointments are counted by the day they happen (a choice made on this screen says so and replaces the bar)", now: "Appointments nobody marked and no-shows still to win back are as of now" },
  leads: { counts: "New leads are counted by the day they were created", now: "The total number of contacts is as of now" },
  deals: { counts: "Won and lost deals are counted by the day they closed", now: "Open money, stuck deals and open deal counts are as of now" },
  accounts: { counts: "Leads, appointments and replies are counted in these dates", now: "Plan, today's health and who has gone quiet are as of now" },
  finance: { counts: "Money received, refunded and disputed is counted by the day it happened", now: "Money at risk and payments failing now are as of now" },
  "meetings-list": { counts: "Meetings are listed by the day they started", now: "The inbox of meetings not yet matched to a contact is as of now" },
  // These pages print their own "Dates: ..." line beside their numbers.
  clients: { counts: "", now: null, own: true },
  team: { counts: "", now: null, own: true },
  pipeline: { counts: "", now: null, own: true },
  payments: { counts: "", now: null, own: true },
  workflows: { counts: "", now: null, own: true },
};

/** The line, or null when the page has none to add. `label` is the bar's label (for example "16 Aug to 13 Nov"); `zone` is the zone word ("Lagos"). */
export function datesNote(view: string, label: string, zone: string): string | null {
  const e = DATES_NOTES[view];
  if (!e || e.own) return null;
  return `Dates: ${label || "..."}, ${zone} time. ${e.counts}.${e.now ? ` ${e.now}.` : ""}`;
}
