// The words and the small pure helpers behind the Appointments page (stage F3). No React, no network: the explanations, the query the page sends and the
// plain sentences are all here so they can be unit tested, and so every chart carries the same three lines.
import type { Resolved } from "./range.ts";

export type Explain = { shows: string; read: string; todo: string };
export type WidgetId = "health" | "funnel" | "heat" | "recovery" | "repeat" | "source" | "velocity" | "confirm" | "fair" | "value" | "followup" | "double" | "briefs";

/** Under every chart and card of the Insights tab: what it shows, how to read it, what to do. Short, plain, and the same shape everywhere. */
export const EXPLAIN: Record<WidgetId | "status" | "numbers" | "calendar" | "person" | "account", Explain> = {
  numbers: {
    shows: "How many appointments were booked in the dates above, how many people showed up, and how many did not.",
    read: "The show rate counts only appointments where someone recorded what happened (showed or no-show). Appointments nobody marked are counted separately as no outcome recorded, not guessed.",
    todo: "Open the no outcome recorded list and mark each one in your CRM. The show rate gets truer with every one you mark.",
  },
  status: {
    shows: "Every appointment that starts in the dates above, split by its status.",
    read: "Each bar is one status. Press a bar to see the appointments behind it. Invalid ones (spam, test or mistaken bookings) are shown for completeness and counted nowhere else.",
    todo: "A long Confirmed bar with a short Showed bar means outcomes are not being recorded. Fix that first.",
  },
  calendar: {
    shows: "Booked, showed and missed appointments for each calendar in the dates above.",
    read: "The rate appears once a calendar has at least 5 recorded outcomes. Press a row to see its appointments.",
    todo: "Look for a calendar with a low show rate: add a reminder, or ask whether that kind of booking is worth keeping.",
  },
  person: {
    shows: "Booked, showed and missed appointments for each person the appointment is assigned to.",
    read: "It shows who the appointments are assigned to, not who booked them. A person with few recorded outcomes has no rate yet.",
    todo: "If one person has many appointments and few outcomes recorded, ask them to mark their appointments each day.",
  },
  account: {
    shows: "The same numbers for each client account.",
    read: "Show rate needs at least 5 recorded outcomes in that account. An account marked Needs approval has not allowed SubSync to read appointments yet.",
    todo: "Start with the account that has the most appointments with no outcome recorded.",
  },
  health: {
    shows: "A score out of 100 for how well the calendar is looked after: show rate, confirmations, outcomes recorded and a fair spread across people.",
    read: "A check with too little data says n/a and earns no points, so missing data never raises or lowers the score. The score needs at least 3 of the 4 checks.",
    todo: "Fix the check with the lowest points first. Usually that is recording outcomes.",
  },
  funnel: {
    shows: "How many leads became appointments, then showed up, then became customers. A customer here is a lead with at least one won deal.",
    read: "Each step is a count of leads. If Showed is much lower than Confirmed, outcomes were probably never marked, so Showed is understated. A biggest drop is named only when the step before it had at least 10 leads.",
    todo: "Mark outcomes first. Then look at the step with the biggest drop and open its leads.",
  },
  heat: {
    shows: "The share of people who showed up for each day of the week and hour of the day.",
    read: "Green is a high show rate, red is low. A slot is coloured only when it has at least 5 recorded outcomes, and the whole grid appears only after 30 outcomes. Times are in each account's own time zone.",
    todo: "Offer more times in the green slots and fewer in the red ones.",
  },
  recovery: {
    shows: "Of the people who missed an appointment, how many booked again and how many came the second time.",
    read: "Only no-shows between 3 and 90 days ago are counted, so people have time to rebook. A rate appears from 5 no-shows.",
    todo: "Call the no-shows from the last 7 days on the Overview tab before they go cold.",
  },
  repeat: {
    shows: "People who have missed two or more appointments.",
    read: "Each line is a person and how many they missed. Press a name for their details.",
    todo: "Ask for a deposit, a confirmation call, or move them to a shorter first meeting.",
  },
  source: {
    shows: "The show rate for each place a lead came from, such as a form or an advert.",
    read: "This uses the source saved on the contact. A source needs at least 3 appointments to be listed and 5 recorded outcomes for a rate. Contacts whose source is a calendar name are grouped on their own line.",
    todo: "Put more effort into the sources that show up, and add a reminder step to the ones that do not.",
  },
  velocity: {
    shows: "How many days pass between a lead arriving and its first appointment being booked.",
    read: "Half of booked leads were booked faster than the middle figure. A source needs 3 booked leads to be listed.",
    todo: "If the wait is long, call new leads sooner. Speed to lead shows who is slow to reply.",
  },
  confirm: {
    shows: "How many appointments in the next two days are confirmed.",
    read: "A booked appointment nobody confirmed is at higher risk of a no-show.",
    todo: "Send a reminder to the unconfirmed ones today.",
  },
  fair: {
    shows: "How the appointments are shared between the people they are assigned to.",
    read: "It flags a split only with at least 2 people and 10 appointments, and only when one person has well over or well under an even share.",
    todo: "If it is uneven on purpose, ignore it. If not, change who new bookings are assigned to.",
  },
  value: {
    shows: "What an appointment that was held has been worth in won deals, and what is coming up.",
    read: "It needs at least 10 held appointments in the last 6 months. It divides money won from people who showed by the number who showed. It is an estimate.",
    todo: "Use it to decide how much a missed appointment costs you.",
  },
  followup: {
    shows: "Appointments that were held in the last two weeks where nobody on your team has sent a message since.",
    read: "It needs at least 5 held appointments to give a share. Each line is a person still waiting to hear from you.",
    todo: "Message the people on the list today.",
  },
  double: {
    shows: "People or team members booked twice at nearly the same time in the next two weeks.",
    read: "A group session (one team member, one calendar, several people at the same start) is not a clash. Times are judged in the account's own time zone.",
    todo: "Move one of the two bookings in your CRM.",
  },
  briefs: {
    shows: "A short written note before each of your next appointments, from what SubSync already knows about the contact.",
    read: "It only states facts that are saved: source, deals, earlier appointments and last message. Nothing is guessed.",
    todo: "Read it before the call, then open the contact if you need more.",
  },
};

/** Every id that must have all three lines. A test walks this list. */
export const EXPLAINED = Object.keys(EXPLAIN) as Array<keyof typeof EXPLAIN>;

// ---------- what the page sends to the server ----------

/** `from=2026-10-03&to=2026-11-01&cmpFrom=...&cmpTo=...` for a resolved card range, or "" before today is known. */
export function windowQuery(r: Resolved | null): string {
  if (!r) return "";
  const p = [`from=${r.current.from}`, `to=${r.current.to}`];
  if (r.compare) p.push(`cmpFrom=${r.compare.from}`, `cmpTo=${r.compare.to}`);
  return p.join("&");
}

export type ApptFilterValue = { calendar: string; user: string; source: string };
export const NO_APPT_FILTER: ApptFilterValue = { calendar: "", user: "", source: "" };
export const hasApptFilter = (f: ApptFilterValue) => Boolean(f.calendar || f.user || f.source);

/** The three filters as a query string. Values are encoded; the server ignores anything longer than 80 characters. */
export function filterQueryOf(f: ApptFilterValue): string {
  return (["calendar", "user", "source"] as const).filter((k) => f[k]).map((k) => `${k}=${encodeURIComponent(f[k])}`).join("&");
}
export const joinQuery = (...parts: string[]) => parts.filter(Boolean).join("&");
export const pathWith = (path: string, query: string) => (query ? `${path}${path.includes("?") ? "&" : "?"}${query}` : path);

/** Reads the filters from an address such as `#appointments?ap.calendar=abc&ap.source=Facebook`. Anything longer than 80 characters is dropped. */
export function filterFromHash(hash: string): ApptFilterValue {
  const q = hash.indexOf("?");
  if (q === -1) return NO_APPT_FILTER;
  const p = new URLSearchParams(hash.slice(q + 1));
  const get = (k: string) => { const v = p.get(`ap.${k}`) ?? ""; return v.length <= 80 ? v : ""; };
  return { calendar: get("calendar"), user: get("user"), source: get("source") };
}
/** The address with the filters set (or removed), everything else kept. */
export function filterIntoHash(hash: string, f: ApptFilterValue): string {
  const q = hash.indexOf("?");
  const head = q === -1 ? hash : hash.slice(0, q);
  const p = new URLSearchParams(q === -1 ? "" : hash.slice(q + 1));
  for (const k of ["calendar", "user", "source"] as const) { if (f[k]) p.set(`ap.${k}`, f[k]); else p.delete(`ap.${k}`); }
  const rest = p.toString().replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%7E/g, "~");
  return rest ? `${head}?${rest}` : head;
}

// ---------- plain sentences ----------

/** "Show rate: needs 5 recorded outcomes, 2 so far." */
export const outcomesNeeded = (have: number, need = 5) => `Needs at least ${need} recorded outcomes to show a rate. ${have} so far.`;

/** Words for how a booking was made, from what the platform sent. An empty value says so instead of guessing. */
export function channelWord(channel: string | null): string {
  if (!channel) return "Not recorded by your CRM";
  const c = channel.toLowerCase().replace(/[_-]+/g, " ").trim();
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/** The line under the lists when only part of the rows were sent. */
export function leftOutNote(total: number, sent: number): string | null {
  return total > sent ? `Showing the first ${sent} of ${total}. The number above is the full count.` : null;
}
