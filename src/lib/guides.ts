// Short guides, one per page: what it shows, how to read it, what to do next. About 60 seconds each. Plain words for agency owners, setters and business owners.
// Pure data. `view` is the menu page the guide belongs to (the ? button and the empty-state link find it from the address).
export type Guide = { id: string; view: string; title: string; shows: string; read: string[]; next: string; tabs?: string[] };

export const GUIDES: readonly Guide[] = [
  { id: "today", view: "today", title: "Today", shows: "What needs you first, ranked, with the reason and a link to the person or deal.", tabs: ["Today", "Proof", "Numbers"],
    read: ["Start at the top row: it is the most urgent.", "Each line says why it is there, for example a lead nobody has answered for 3 hours.", "Proof lists what you cleared, so you can show it to a client."], next: "Open the first item, deal with it, and it moves to Proof." },
  { id: "speed", view: "speed", title: "Speed to lead", shows: "How long each new lead waited for the first reply from a person.", tabs: ["Speed to lead", "Waiting on the client", "Unanswered"],
    read: ["The big number is the typical wait. Lower is better.", "Red rows waited longer than your reply target.", "Unanswered lists customer messages still waiting.", "Waiting on the client ranks client accounts by the people they have not answered: tap a number to see exactly who. An automatic reply does not count as an answer.", "Start calling (Race) and Send to power dialer (Call mode) tag up to 25 leads, show you a preview first, then open your CRM's call queue in a new tab. Your CRM places the calls, never SubSync."], next: "Open the oldest waiting lead and reply, or open the worst client account and ask them to call back. Change the targets under Settings, Targets." },
  { id: "appointments", view: "appointments", title: "Appointments", shows: "Bookings, the ones with no outcome marked, and no-shows worth winning back.", tabs: ["Overview", "Needs outcome", "No-show recovery"],
    read: ["Needs outcome: the time has passed and nobody marked showed or no-show.", "No-show recovery: people who missed and have not rebooked.", "Show rate is only shown once there are enough marked appointments."], next: "Mark the outcomes, then call the no-shows." },
  { id: "clients", view: "clients", title: "Clients", shows: "Every client account with its health, plan and what needs attention.", tabs: ["Overview", "Money and plans", "Health", "Reports and proof"],
    read: ["The pages are grouped under four names. Pick a name, then the page under it.", "Health is a 0 to 100 score; the reasons are one tap away.", "Accounts that need you float to the top.", "Open an account for notes, plan and next steps."], next: "Open the account at the top of the attention list." },
  { id: "payments", view: "payments", title: "Payments", shows: "Failed, late and disputed payments across your client accounts.", tabs: [],
    read: ["Each line is one payment and how long it has been a problem.", "SubSync only reads payments. It cannot charge or refund anything.", "Without the payments permission the page says: Needs permission: reconnect."], next: "Chase the oldest failed payment first." },
  { id: "people", view: "people", title: "Find a lead", shows: "Every contact in every client account, searchable.", tabs: ["Search and filters", "Smart lists"],
    read: ["Type a name, email or phone number.", "Use filters (tag, owner, last activity) then save the list.", "Open a person to see their timeline."], next: "Save the list you use every week as a Smart list." },
  { id: "audit", view: "audit", title: "Account audit", shows: "Problems found in each account and the money at risk.", tabs: [],
    read: ["Counted facts are kept apart from estimates; estimates are labelled.", "Share makes a link that hides client names and stops after 14 days.", "History shows how an account changed since its first audit."], next: "Fix the top problem, or share the audit with a prospect." },
  { id: "cleanup", view: "cleanup", title: "Clean-up", shows: "Duplicate contacts and data quality problems.", tabs: ["Duplicates", "Data quality", "History", "Rules"],
    read: ["Nothing changes until you preview and confirm.", "People who asked not to be contacted, and people with open deals or booked appointments, are protected.", "History lists every change with the details of anything removed.", "How merging works: one contact is the primary and is kept, the other is merged into it and removed. SubSync never guesses which: if it cannot read payments, automations or courses, or two copies look equally important, you choose.", "What we never do: merge or delete people on Do Not Disturb, with an open deal, a coming appointment or a payment; merge people whose names or emails look different; or merge in bulk unless it is completely sure. A merge cannot be undone in your CRM, so SubSync lists what it will do and what it skipped, and asks you to type the number of groups."], next: "Start with Duplicates, one account at a time." },
  { id: "team", view: "team", title: "Team", shows: "Who replies, books and closes, per person.", tabs: ["Today", "Scorecards", "Roles"],
    read: ["Scorecards compare a person with their own recent past.", "Roles are labels only you and your team see. They are not sent anywhere.", "Settings, Team and roles says who can see what."], next: "Give each person a role so the lists make sense." },
  { id: "pipeline", view: "pipeline", title: "Pipeline and deals", shows: "Open deals by stage, and deals that stopped moving.", tabs: ["Overview", "Money and forecast", "Stage history", "People and accounts", "Proof"],
    read: ["The pages are grouped under five names. Pick a name, then the page under it.", "A deal with no value is counted as a deal but not as money, and the page says how many.", "A deal is stale when it has not moved for your stale-days setting.", "Forecasts need enough closed deals; until then the page says not enough data.", "Step history and Stuck in a step use the moves SubSync wrote down itself, so they start from the day recording began. Settings, Replies, Pipeline history sets the smallest sample."], next: "Open the biggest stale deal." },
  { id: "meetings", view: "meetings", title: "Meeting notes", shows: "Summaries from the meeting tool each person connects.", tabs: [],
    read: ["A note is saved on a contact only when the guest matches exactly one contact.", "Everything else waits in your private inbox.", "You are responsible for telling people a meeting is recorded."], next: "Connect your own Fathom under Settings, Connections." },
  { id: "workflows", view: "workflows", title: "Workflows", shows: "Automations that failed or sat idle in each client account.", tabs: [],
    read: ["Failed means steps stopped with an error in the last 30 days.", "Idle means it has not run for a long time."], next: "Open the failing workflow in your CRM." },
  { id: "data-health", view: "data-health", title: "Data health", shows: "Contacts with missing or wrong details.", tabs: [],
    read: ["Each row says what is wrong and how many contacts it affects."], next: "Fix the largest group first." },
  { id: "settings", view: "settings", title: "Settings", shows: "Targets, alerts, connections, permissions and your data.", tabs: [],
    read: ["Use the search box at the top to jump to a setting.", "Changes that alter your numbers say so before you save."], next: "Set your reply target under Targets." },
];

export const GUIDE_IDS: ReadonlySet<string> = new Set(GUIDES.map((g) => g.id));
export const guideForView = (view: string): Guide | null => GUIDES.find((g) => g.view === view) ?? (view === "duplicates" ? GUIDES.find((g) => g.id === "cleanup")! : view === "inbox" ? GUIDES.find((g) => g.id === "speed")! : null);

export type Extra = { id: string; title: string; body: string; done: boolean; view: string; cta: string; section?: string };
export type ProgressFacts = { permissionsMissing: number; rolesAssigned: number; slackConnected: boolean; fathomConnected: boolean; auditOpened: boolean; digestSent: boolean };

/** The extra checklist steps of the new Getting started. Each ticks only from a fact the server read. */
export function extraSteps(f: ProgressFacts, canManage: boolean): Extra[] {
  const out: Extra[] = [
    { id: "x-permissions", title: "Approve every permission", body: f.permissionsMissing === 0 ? "Every permission is approved." : `${f.permissionsMissing} permission${f.permissionsMissing === 1 ? " is" : "s are"} not approved yet. Pages that need one say: Needs permission: reconnect.`, done: f.permissionsMissing === 0, view: "settings", cta: "Open Permissions", section: "permissions" },
    { id: "x-audit", title: "Run your first audit", body: "The audit lists what is wrong and the money at risk.", done: f.auditOpened, view: "audit", cta: "Open Account audit" },
    { id: "x-digest", title: "Receive your first daily brief", body: "It arrives once a day by email or Slack, once you set it up.", done: f.digestSent, view: "settings", cta: "Open Alerts", section: "alerts" },
    { id: "x-fathom", title: "Connect your own Fathom (optional)", body: "Each person connects their own. Summaries go on the right contact only when it is certain.", done: f.fathomConnected, view: "settings", cta: "Open Connections", section: "connections" },
  ];
  if (canManage) out.splice(1, 0,
    { id: "x-roles", title: "Give your team roles", body: f.rolesAssigned > 0 ? `${f.rolesAssigned} people have a role.` : "Label each person Setter, Closer and so on, so lists and scorecards make sense.", done: f.rolesAssigned > 0, view: "team", cta: "Open Team" },
    { id: "x-slack", title: "Connect Slack (optional)", body: "One Slack channel for the whole team gets alerts and the daily brief.", done: f.slackConnected, view: "settings", cta: "Open Connections", section: "connections" });
  return out;
}
