// What we are building next and what has shipped. Plain data so it is reviewed like code. Keep it honest:
// "planned" means not built, and nothing planned is described as if it works.
export type RoadmapItem = { key: string; title: string; body: string; status: "building" | "planned" };
export type ChangeEntry = { date: string; title: string; items: string[] };

export const ROADMAP: RoadmapItem[] = [
  { key: "stage-dwell", title: "Deal velocity and time in stage", body: "Time in stage measured from our own recorded history (today it is estimated from current deals).", status: "planned" },
  { key: "benchmarks", title: "Industry benchmarks", body: "Your show rate and reply speed against similar accounts. Opt in, aggregates only.", status: "planned" },
  { key: "ai-brief", title: "AI daily action brief", body: "A short, ranked to-do list written from your numbers.", status: "planned" },
  { key: "slack-alerts", title: "Slack alerts", body: "Breaches and daily brief in a channel of your choice.", status: "planned" },
];

export const CHANGELOG: ChangeEntry[] = [
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
