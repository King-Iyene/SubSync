// What we are building next and what has shipped. Plain data so it is reviewed like code. Keep it honest: "planned" means not built, and nothing planned is
// described as if it works. The order and the parked items follow docs/ROADMAP_V2.md (a test, src/lib/__tests__/roadmap-truth.test.ts, checks every item against
// it). Votes help us decide what to build next; they do not fix the order, because we also sequence by risk and by what has to come first (N86, N75).
export type RoadmapStatus = "planned" | "building" | "considering" | "shipped";
export type RoadmapItem = { key: string; title: string; body: string; status: RoadmapStatus; /** The stage in docs/ROADMAP_V2.md that builds it. */ stage: string };
export type ChangeEntry = { date: string; title: string; items: string[] };

export const STATUS_LABEL: Record<RoadmapStatus, string> = { planned: "Planned", building: "In progress", considering: "Considering", shipped: "Shipped" };
/** The meaning of each label, shown on the page so nobody has to guess. */
export const STATUS_MEANING: Record<RoadmapStatus, string> = {
  planned: "We intend to build it, in the order shown. Not built yet.",
  building: "Someone is working on it now.",
  considering: "Parked until we have the data or the customers to do it well. Votes help decide if it comes back.",
  shipped: "It is live.",
};

/** Items the roadmap parks until evidence or cash (docs/ROADMAP_V2.md section 3, phase 4). They can only ever be "considering" or "shipped". */
export const PARKED_KEYS: readonly string[] = ["benchmarks", "ai-brief"];

export const ROADMAP: RoadmapItem[] = [
  { key: "slack-alerts", title: "Slack alerts and the daily brief, set up in a few clicks", body: "Choose where each kind of alert goes, and pick the hour and time zone for each notification.", status: "planned", stage: "F9" },
  { key: "fathom-notes", title: "Fathom meeting notes on the right contact", body: "Each person connects their own Fathom. A summary is saved on the contact only when the guest's email matches exactly one contact; otherwise it waits in a private inbox.", status: "planned", stage: "E2a" },
  { key: "people-lists", title: "Saved lists and faster contact search", body: "Filter by tag, owner, source and last activity, save the list, and search across every client account in seconds.", status: "planned", stage: "F10" },
  { key: "setter-closer", title: "Setter and closer performance", body: "Who books and who closes, per person and per account. We need to agree what counts as a setter before this starts.", status: "planned", stage: "T1" },
  { key: "email-health", title: "Email sender health with the numbers", body: "Bounces, failures and the leads affected, with the exact records to fix and an alert when one breaks.", status: "planned", stage: "E5" },
  { key: "stage-dwell", title: "Deal velocity and time in stage", body: "Time in stage measured from our own recorded history (today it is estimated from current deals). Needs weeks of history to be meaningful.", status: "planned", stage: "P1" },
  { key: "benchmarks", title: "Industry benchmarks", body: "Your show rate and reply speed against similar accounts. Opt in, aggregates only. Needs many installs before it is honest.", status: "considering", stage: "R1" },
  { key: "ai-brief", title: "AI daily action brief", body: "A short, ranked to-do list written from your numbers. Parked until the numbers underneath are proven.", status: "considering", stage: "R1" },
  { key: "speed-to-lead", title: "Speed to lead", body: "How long new leads wait for a first reply from a person, per account and per person, with an alert when leads wait past your target.", status: "shipped", stage: "F2" },
  { key: "account-audit", title: "Account audit", body: "Problems found and the money at risk, with counted facts kept apart from labelled estimates, and a share link.", status: "shipped", stage: "F6" },
];

export const CHANGELOG: ChangeEntry[] = [
  { date: "2026-11-01", title: "Settings in sections, a guide for each role, feedback, and a Trust page", items: [
    "Settings is split into eight sections with a menu on the left. Every change to a setting is written to a history you can read under Advanced.",
    "Getting started now has its own steps for a company owner, its staff, a business's administrator and a business's staff. Each step has a Do it now button and ticks itself off.",
    "Give feedback and Report a problem are at the bottom of every page. A problem report carries the error ID shown on the screen.",
    "The roadmap lets you suggest something, votes once per person, and shows what is planned, in progress, being considered and shipped.",
    "A Trust page says what SubSync reads and stores, why each permission is asked, which outside services handle data and how to delete it. An automated test checks it against the code.",
    "You can leave test accounts out of every number from Settings.",
  ] },
  { date: "2026-10-31", title: "Numbers you can trust, a front door, and safer sharing", items: [
    "Today now starts with the leads waiting for a reply, then appointments to fix and accounts needing attention, in plain words.",
    "One definition of open pipeline everywhere, and a win rate or forecast only once there are 20 closed deals. Deals with no value or owner are left out and counted.",
    "Speed to lead leaves out spam, test contacts, duplicates, bulk imports and people who asked not to be contacted. Phone calls count as a reply. Optional business hours.",
    "Facebook and Instagram lead forms are their own source with a 10 minute target.",
    "Appointments: invalid bookings are ignored, and no 'up' or 'down' claim is made from a handful of appointments.",
    "Inbox: one window and one count everywhere, with the channels of the conversations waiting.",
    "Share links last 14 days, count their views, can be switched off, and print cleanly on A4 and Letter.",
    "Plain words instead of jargon (Health, Gone quiet, Likely to leave), a Settings page in five groups, and a company name that replaces ours on every screen.",
  ] },
  { date: "2026-10-31", title: "Weekly email, team pace, client access by account", items: ["A Monday email with what needs you (set the address in Settings; sending starts once an email service is connected).", "Team now shows first-reply time and show rate per person.", "Choose exactly which client accounts their own staff can open."] },
  { date: "2026-10-31", title: "Today leads with what to do first", items: ["A Do this first panel on Today, taken from the account audit, with the money at risk where it can be counted."] },
  { date: "2026-10-30", title: "Speed to lead and breach alerts", items: ["How long new leads wait for a first reply from a person, per account and per person.", "An alert when three or more leads wait past your target."] },
  { date: "2026-10-30", title: "Account audit", items: ["Problems found and the money at risk, counted facts kept apart from labelled estimates.", "Appointment hygiene: unmarked outcomes and no-shows to recover."] },
];
