// The public documentation (/support/<slug>), built from the SAME guides the app shows (src/lib/guides.ts and src/lib/concept-guides.ts). A page's summary,
// "what you will see" bullets and "what to do next" are read from its guides, so the app and the website cannot say different things. This file only adds what a
// guide has no room for: who it is for, the steps, what is read and what can change, the numbers explained, common questions and related pages.
// Pure data: no database, no React. A test (src/lib/__tests__/site-docs.test.ts) proves every guide id maps to a page that exists.
import { GUIDES, type Guide } from "../guides.ts";

export type DocGroup = "Start here" | "Pages" | "Connections and settings" | "Ideas explained";
export type DocPage = {
  slug: string; title: string; group: DocGroup;
  /** The guides this page is built from, in order. */
  guideIds: string[];
  /** One sentence: what it is. Falls back to the first guide's "what it shows". */
  summary?: string;
  who?: string;
  steps?: string[];
  reads?: string;
  changes?: string;
  numbers?: Array<[string, string]>;
  faq?: Array<[string, string]>;
  related?: string[];
  keywords?: string[];
  /** The menu page the "Try it now" idea refers to (shown as a plain sentence on the website; a button in the app). */
  tryView?: string;
  /** Screenshot name in public/site (without size and extension). */
  shot?: string;
  /** Extra bullets for a page that has no guide of its own. */
  sees?: string[];
};

const READS_STANDARD = "SubSync reads the counts and times it needs from your CRM with the permissions you approved. It never copies the words of your customers' messages.";
const CHANGES_NONE = "Nothing. This page only reads.";

export const DOC_PAGES: readonly DocPage[] = [
  // ---------- Start here
  { slug: "getting-started", title: "Getting started", group: "Start here", guideIds: [], tryView: "help",
    summary: "Install SubSync, open it from your CRM, and see what needs attention in about five minutes.",
    who: "Everyone: an owner of one business, an owner of many client accounts, a setter, a client's own staff.",
    sees: ["A checklist that ticks itself off from what you really did, never from what you clicked.", "A progress bar, and for each step a button that opens the right page and a link to its guide.", "Optional steps (your own AI, Slack, Fathom) are marked optional and can be skipped.", "A short start-here path of the first four steps (about two minutes) and the full path."],
    steps: ["Install SubSync from the marketplace with the Install SubSync button, approve the permissions you are comfortable with (the optional ones can be left off), and wait for the first read of your accounts.", "Open SubSync from your CRM's left menu. You land on Today.", "Pick your date range at the top of the page.", "Save an email address under Settings, Notifications so alerts and the daily brief can reach you.", "Open Today and deal with the top row.", "Give your team roles (setter, closer) under Team.", "Mark appointments that have no outcome, check duplicates, and set your call queue tag when you are ready.", "Optional: connect Slack, your own Fathom and your own AI."],
    reads: READS_STANDARD, changes: "Installing changes nothing in your CRM. Later changes happen only after a preview and a confirm.",
    faq: [["How long does the first read take?", "A few minutes for most accounts. A big account keeps filling in while you look around, and Settings, Sync status shows progress."], ["Do I have to connect anything else?", "No. Slack, Fathom and your own AI are optional."]],
    related: ["today", "settings-notifications", "permissions", "billing-and-plans"], keywords: ["install", "start", "begin", "setup", "checklist", "onboarding", "first"] },

  // ---------- Pages
  { slug: "today", title: "Today", group: "Pages", guideIds: ["today"], tryView: "today", shot: "today",
    who: "Agency owners and business owners every morning; setters for their own list.",
    steps: ["Open Today.", "Read the top row: it is the most urgent and says why.", "Open the person or deal and deal with it.", "Check the Proof tab to see what you cleared.", "The Numbers tab holds the totals behind the page."],
    reads: READS_STANDARD, changes: "Done, Snooze and Assign on an item are stored in SubSync only. Anything that changes your CRM asks for a preview and a confirm first.",
    numbers: [["Lead flow", "New leads in your date range, followed to where each one is now: replied to, booked, showed up, won. The three reply states add up to the new leads."], ["Expected revenue", "Open deal value times that account's own win rate. Shown only after the account has at least 5 closed deals, and always marked as an estimate."]],
    faq: [["Why does Today say still learning?", "Changes are judged against an account's own last week, so a new account needs a few days of history."], ["What is the 7 am brief?", "The five things that need you today, each with one line of why and a button to the list. It arrives by email at your hour and sits at the top of Today."]],
    related: ["speed-to-lead", "appointments", "alerts", "what-is-speed-to-lead"], keywords: ["home", "morning", "brief", "proof", "numbers", "attention", "ask your data"] },
  { slug: "speed-to-lead", title: "Speed to lead", group: "Pages", guideIds: ["speed", "what-is-speed-to-lead", "call-queue-tags"], tryView: "speed", shot: "speed-to-lead",
    who: "Setters and owners. It is the page that shows whether new leads are really being answered.",
    steps: ["Open Speed to lead and read the big number: the typical wait.", "Open Unanswered to see customer messages still waiting.", "Open Waiting on the client to see which client accounts are not answering.", "Press Start calling to send up to 25 waiting leads to your CRM's call queue after one preview and confirm.", "Change your targets under Settings, Replies."],
    reads: "New leads, and for each the conversation's direction, channel and time, and whether a person or an automation wrote. Never the words.",
    changes: "Start calling tags up to 25 leads after a preview and a confirm. Replying by text or email exists behind a switch that is off until an owner turns it on for an account, and it checks do-not-contact again before each send.",
    numbers: [["Typical wait", "The median time from a new lead arriving to the first reply from a person."], ["Reply target", "4 hours by default. Rows older than this are red."], ["Waiting on the client", "Leads and customer messages a client account has not answered, ranked by account."]],
    faq: [["Does an automatic reply count?", "Not unless you switch on Count automatic touches in Settings, Replies."], ["Who places the calls?", "Your CRM does. SubSync only tags the leads."]],
    related: ["what-is-speed-to-lead", "call-queue-tags", "workflows", "settings-replies"], keywords: ["reply", "response time", "unanswered", "leads", "call mode", "dialer", "sla", "wait"] },
  { slug: "appointments", title: "Appointments", group: "Pages", guideIds: ["appointments", "show-rate"], tryView: "appointments", shot: "appointments",
    who: "Setters, closers and owners who want honest show-rate numbers.",
    steps: ["Open Appointments, Needs outcome.", "Mark each past appointment as showed or no-show (you see a preview first).", "Open No-show recovery and call the people who missed and have not rebooked.", "Open the flow tree to see where booked leads end up."],
    reads: READS_STANDARD + " It reads appointments and their status.", changes: "Marking an outcome, moving or reassigning an appointment happens only after a preview and a confirm, is logged, and can be put back where the page says so.",
    numbers: [["Needs outcome", "The time has passed and nobody marked showed or no-show."], ["True show rate", "Showed divided by appointments with a marked outcome. Shown only when there are enough marked appointments."], ["No-show recovery", "No-shows from the last days who have not rebooked."]],
    faq: [["Why is my show rate different from my CRM?", "Your CRM leaves out appointments nobody marked. SubSync lists them so you can mark them."]],
    related: ["show-rate", "calendars", "funnel-and-pipeline"], keywords: ["booking", "no-show", "show rate", "calendar", "outcome", "flow tree", "recovery"] },
  { slug: "clients", title: "Clients", group: "Pages", guideIds: ["clients"], tryView: "clients", shot: "clients",
    who: "Owners of more than one client account. A single business sees its own account.",
    steps: ["Open Clients and pick one of the four names: Overview, Money and plans, Health, Reports and proof.", "Open the account at the top of the attention list.", "Add notes, a plan and next steps for that client.", "Share a monthly report from Reports and proof."],
    reads: READS_STANDARD, changes: "Notes, fees and next steps are stored in SubSync only and are visible only to you and your team.",
    numbers: [["Health score", "0 to 100 from five parts: recent activity, new contacts, pipeline health, reply speed and data quality. Each part shows why it scored as it did."], ["Gone quiet", "No real activity longer than your quiet-account setting (30 days by default)."]],
    faq: [["Can a client see this page?", "No. A client's staff see a read-only view of their own account only, never other clients, your fees or your notes."]],
    related: ["reports-and-sharing", "money-and-wallet", "settings-team"], keywords: ["accounts", "health", "retention", "churn", "plans", "notes", "report"] },
  { slug: "money-and-wallet", title: "Money and wallet", group: "Pages", guideIds: ["payments"], tryView: "payments", shot: "money",
    who: "Owners who bill clients and want to chase failed payments and watch credit balances.",
    steps: ["Open Money.", "Read Client payments: each line is one payment and how long it has been a problem.", "Open Plans and churn for each client's plan and payment status.", "Open the credit balance watchlist: the lowest days left come first.", "Open Payouts for commission lines per setter and closer."],
    sees: ["The credit balance watchlist ranks every client account by days left, with alerts before it runs out or spending jumps."],
    reads: "Payment status, amount and customer of each failed payment, late invoice and paid plan, and each account's credit balance. Never a card or bank number.", changes: "Nothing in your CRM. SubSync cannot charge or refund anything. Notes you make on a payment are stored in SubSync only.",
    numbers: [["Days left", "An estimate: the balance divided by the average daily spend."]],
    faq: [["Why does it say Needs permission: reconnect?", "The payments permission is optional. Approve it from your CRM's apps page to see this page."]],
    related: ["clients", "billing-and-plans", "alerts"], keywords: ["payments", "failed", "invoice", "wallet", "credit", "balance", "payout", "commission", "dispute"] },
  { slug: "find-a-lead", title: "Find a lead", group: "Pages", guideIds: ["people"], tryView: "people", shot: "find-a-lead",
    who: "Anyone who needs to find a person fast across every account.",
    steps: ["Type a name, email or phone number.", "Add filters (tag, owner, last activity) and save the list as a Smart list.", "Open a person to see their timeline, deals, recorded calls and conversation.", "Call, text or email from the panel after a preview. Texting and emailing is off until an owner switches it on."],
    reads: READS_STANDARD, changes: "Adding a deal, a note or a tag happens after a preview and a confirm and is logged. People who asked not to be contacted are never messaged.",
    related: ["speed-to-lead", "safety-and-sending", "meeting-notes"], keywords: ["search", "contact", "lookup", "smart list", "filters", "timeline"] },
  { slug: "account-audit", title: "Account audit", group: "Pages", guideIds: ["audit"], tryView: "audit", shot: "account-audit",
    who: "Owners who want a fast read on an account, and a page to show a prospect.",
    steps: ["Open Account audit and pick an account.", "Read the problems found and the money at risk. Counted facts are kept apart from estimates.", "Open History to see how the account changed since its first audit.", "Press Share to send a link that hides client names and stops after 14 days."],
    reads: READS_STANDARD, changes: CHANGES_NONE,
    numbers: [["Money at risk", "An estimate, labelled as one, with the formula one tap away."]],
    related: ["report-sharing", "clients", "data-health"], keywords: ["audit", "problems", "money at risk", "share", "prospect", "history"] },
  { slug: "clean-up", title: "Clean-up and duplicates", group: "Pages", guideIds: ["cleanup", "duplicate-certainty"], tryView: "cleanup", shot: "clean-up",
    who: "Owners and admins who want a tidy CRM without risking real customers.",
    steps: ["Open Clean-up, Duplicates and pick one account.", "Review a group: the page shows each contact's last conversation, deals and appointments.", "Choose the primary contact, preview, and confirm. Bigger merges ask you to type a confirmation.", "Open History to see every change and what was removed.", "Open Rules to set your data quality rules."],
    reads: READS_STANDARD, changes: "Merges and fixes happen only after a preview and a typed or pressed confirmation, are logged with the value before, and phone and name fixes can be undone for 24 hours. A merge cannot be undone in your CRM.",
    numbers: [["Certain, likely, possible", "How sure SubSync is that two contacts are one person. Only certain matches can be merged in bulk, and only after you review the list."]],
    faq: [["Will it delete people who asked not to be contacted?", "Never. They are protected, together with anyone who has an open deal, a coming appointment or a payment."]],
    related: ["duplicate-certainty", "data-health", "safety-and-sending"], keywords: ["duplicates", "merge", "dedupe", "data quality", "cleanup", "history"] },
  { slug: "team", title: "Team", group: "Pages", guideIds: ["team"], tryView: "team", shot: "team",
    who: "Owners and managers who want to see who replies, books and closes.",
    steps: ["Open Team, Today to see who needs help right now.", "Open Scorecards to compare each person with their own recent past.", "Open Roles and label each person.", "Set a target for a person, or mark someone away."],
    reads: READS_STANDARD, changes: "Roles, targets and coaching notes are stored in SubSync only. Coaching notes are private to you and your administrators unless you share one.",
    related: ["roles", "settings-team", "speed-to-lead"], keywords: ["staff", "setters", "closers", "scorecard", "coaching", "performance"] },
  { slug: "funnel-and-pipeline", title: "Funnel and pipeline", group: "Pages", guideIds: ["pipeline", "stale-deals", "pipeline-river", "pipeline-replay"], tryView: "pipeline", shot: "pipeline-funnel",
    who: "Closers and owners who want to see where deals stall and where money leaks.",
    steps: ["Open Pipeline and deals and pick one of the five names: Overview, Money and forecast, Stage history, People and accounts, Proof.", "Open Money flow to see the funnel and the river, and click the biggest leak.", "Press Replay to play your recorded step changes day by day.", "Open Stuck deals and add a suggested next step as an internal task after a preview.", "Look at Deals without a value to fix the missing amounts."],
    reads: READS_STANDARD + " It reads deals, pipelines and stages.", changes: "Changing a deal's stage, owner, value or status happens only after a preview and a confirm, is logged, and can be put back. Nothing is ever sent to a lead from here.",
    numbers: [["Stale", "No movement for longer than your stale-days setting (30 by default), judged against that pipeline step."], ["Forecast", "Needs enough closed deals; until then the page says not enough data. It is an estimate and the formula is one tap away."]],
    related: ["stale-deals", "pipeline-river", "pipeline-replay", "money-and-wallet"], keywords: ["deals", "opportunities", "pipeline", "funnel", "river", "replay", "forecast", "stuck", "win loss", "deals without a value"] },
  { slug: "meeting-notes", title: "Meeting notes and Fathom", group: "Pages", guideIds: ["meetings", "fathom-unmatched"], tryView: "meetings", shot: "meeting-notes",
    who: "Anyone who records calls and wants the summary on the right contact.",
    steps: ["Connect your own Fathom under Settings, Integrations.", "Open Meeting notes to see each recorded call on its contact or waiting for you.", "Pick the contact for any call that did not match, or ignore it.", "Use next steps and follow-up lists after each call."],
    reads: "Meeting summaries and action items from the tool each person connects.", changes: "With the add-notes permission, a summary is added as a note on a contact only when the match is certain, you can switch this off, and each note is logged so it can be undone.",
    faq: [["Who can see my meetings?", "Only you. Admins see how many people connected, never the content."]],
    related: ["fathom-unmatched", "connections", "settings-data"], keywords: ["fathom", "meetings", "notes", "summary", "recording", "action items", "zoom"] },
  { slug: "workflows", title: "Workflows", group: "Pages", guideIds: ["workflows", "call-queue-tags"], tryView: "workflows",
    who: "Owners who want to know which automations quietly stopped.",
    steps: ["Open Workflows to see automations that failed or sat idle in each account.", "Open the failing workflow in your CRM and fix it there.", "To use Start calling, set up the call queue workflow: Speed to lead, Call mode, Call queue setup. If automatic setup is not possible, follow the five hand steps shown there."],
    reads: READS_STANDARD + " It reads workflow names, states and run counts.", changes: "Setting up the call queue workflow creates one folder and one workflow in an account after a preview and a confirm, and only when the account has allowed it. SubSync never edits or deletes a workflow of yours without a saved copy.",
    numbers: [["Failed", "Steps stopped with an error in the last 30 days."], ["Idle", "Has not run for a long time."]],
    related: ["call-queue-tags", "speed-to-lead"], keywords: ["automation", "workflow", "call queue", "failed", "idle", "tag"] },
  { slug: "data-health", title: "Data health", group: "Pages", guideIds: ["data-health"], tryView: "data-health",
    who: "Anyone who wants reports they can trust.",
    steps: ["Open Data health.", "Read each row: what is wrong and how many contacts it affects.", "Fix the largest group first, or open Clean-up for fixes with a preview."],
    reads: READS_STANDARD, changes: "Fixes from here happen only after a preview and are logged with the value before.",
    numbers: [["Data quality score", "A daily score for each account from four parts, counts and points only."]],
    related: ["clean-up", "account-audit"], keywords: ["quality", "missing", "phone", "email", "junk"] },

  // ---------- Connections and settings
  { slug: "connections", title: "Connections", group: "Connections and settings", guideIds: ["conn-ai", "conn-slack", "conn-fathom", "conn-email", "conn-calendars"], tryView: "settings",
    who: "Owners and administrators for shared tools; each person for their own tools.",
    steps: ["Open Settings, Integrations.", "Read What's connected, then the list of tools.", "Press Connect on a tool, sign in on its own page, and come back.", "Use How this works on any row for its guide."],
    reads: "Only what the connected tool is for: Slack receives alerts, Fathom sends meeting summaries, your AI provider receives short summaries of counts.", changes: "Nothing in your CRM.",
    sees: ["A personal tool (such as your meeting notes tool) belongs to the person who connected it: one connection per person, never visible to anyone else.", "A workspace tool (Slack, the sending address) belongs to the account and needs an administrator."],
    faq: [["Do I need an AI account?", "No. AI is optional and uses your own key, so SubSync never pays for it and you control the spend."]],
    related: ["email-sender-health", "calendars", "alerts", "permissions"], keywords: ["ai", "slack", "fathom", "email", "calendars", "integrations", "openrouter", "anthropic", "openai", "google"] },
  { slug: "email-sender-health", title: "Email sender health", group: "Connections and settings", guideIds: ["conn-email"], tryView: "settings",
    who: "Owners whose clients send email from their own domain.",
    steps: ["Open Settings, Integrations, Email.", "Save the address for alerts and summaries.", "Press Check records to look up SPF, DKIM and DMARC for your sending domain.", "Press Send me a test to see what an email looks like."],
    reads: "Only public records of a domain. SubSync never signs in to anyone's email.", changes: "Nothing.",
    related: ["connections", "alerts"], keywords: ["spf", "dkim", "dmarc", "spam", "deliverability", "domain", "email"] },
  { slug: "calendars", title: "Calendars", group: "Connections and settings", guideIds: ["conn-calendars"], tryView: "settings",
    who: "Owners who want show rate by person to work.",
    steps: ["Open Settings, Integrations, Calendars.", "Find any calendar marked No person assigned.", "Press Fix in your CRM to open that calendar's settings and add a team member."],
    reads: "Calendars and their bookings.", changes: "SubSync books an appointment only when you press Book, after a preview, and it is logged.",
    related: ["appointments", "connections"], keywords: ["calendar", "booking", "assigned", "team member"] },
  { slug: "settings", title: "Settings", group: "Connections and settings", guideIds: ["settings", "settings-replies", "settings-brand", "settings-notifications", "settings-integrations", "settings-team", "settings-data", "settings-sync", "settings-advanced"], tryView: "settings",
    who: "Owners and administrators.",
    steps: ["Open Settings and use the search box at the top to jump to a setting.", "Pick a section: Replies, Brand, Notifications, Integrations, Team, Data, Sync status or Advanced.", "Read the line under a setting before you save: a change that alters your numbers says so."],
    reads: READS_STANDARD, changes: "Every change to a setting is recorded with who changed it and when.",
    related: ["permissions", "billing-and-plans", "safety-and-sending"], keywords: ["settings", "targets", "brand", "notifications", "advanced", "sync", "data", "delete"] },

  // ---------- Ideas explained (own pages; the page guides above carry the rest)
  { slug: "roles", title: "Roles (setters and closers)", group: "Ideas explained", guideIds: ["roles"], tryView: "team", related: ["team", "settings-team"], keywords: ["setter", "closer", "role", "label"] },
  { slug: "alerts", title: "Alerts and notifications", group: "Ideas explained", guideIds: ["alerts"], tryView: "settings", related: ["settings-notifications", "connections", "email-sender-health"], keywords: ["alert", "bell", "email", "slack", "brief", "digest", "notification", "quiet hours"] },
  { slug: "reports-and-sharing", title: "Reports and sharing", group: "Ideas explained", guideIds: ["report-sharing", "print-and-pdf"], tryView: "clients", related: ["clients", "account-audit", "settings-brand"], keywords: ["report", "share link", "print", "pdf", "proof", "audit", "client report"] },
  { slug: "safety-and-sending", title: "Safety and sending rules", group: "Ideas explained", guideIds: ["safety"], tryView: "settings", related: ["permissions", "clean-up", "find-a-lead"], keywords: ["safety", "preview", "confirm", "undo", "audit log", "dnd", "do not disturb", "sending", "consent", "text", "email"] },
  { slug: "permissions", title: "What each permission is for", group: "Ideas explained", guideIds: ["permissions"], tryView: "settings", related: ["settings-integrations", "safety-and-sending"], keywords: ["permission", "scope", "reconnect", "needs permission", "reinstall"] },
  { slug: "billing-and-plans", title: "Billing and plans", group: "Ideas explained", guideIds: ["billing-and-plans"], tryView: "settings", related: ["getting-started", "money-and-wallet"], keywords: ["price", "pricing", "trial", "growth", "billing", "plan", "cost", "$11.50"] },
  { slug: "feedback", title: "Feedback and reporting a problem", group: "Ideas explained", guideIds: ["feedback"], tryView: "settings", related: ["whats-new"], keywords: ["feedback", "problem", "bug", "contact", "roadmap"] },
  { slug: "whats-new", title: "What's new", group: "Ideas explained", guideIds: ["whats-new"], tryView: "roadmap", related: ["feedback"], keywords: ["new", "changelog", "release", "updates"] },
  { slug: "what-is-speed-to-lead", title: "What speed to lead means", group: "Ideas explained", guideIds: ["what-is-speed-to-lead"], tryView: "speed", related: ["speed-to-lead"], keywords: ["speed to lead", "median", "first reply"] },
  { slug: "show-rate", title: "Show rate and true show rate", group: "Ideas explained", guideIds: ["show-rate"], tryView: "appointments", related: ["appointments"], keywords: ["show rate", "true show rate", "no-show"] },
  { slug: "stale-deals", title: "Stale deals", group: "Ideas explained", guideIds: ["stale-deals"], tryView: "pipeline", related: ["funnel-and-pipeline"], keywords: ["stale", "deal", "stuck"] },
  { slug: "duplicate-certainty", title: "Duplicate certainty levels", group: "Ideas explained", guideIds: ["duplicate-certainty"], tryView: "cleanup", related: ["clean-up"], keywords: ["duplicate", "certain", "likely", "possible", "merge"] },
  { slug: "call-queue-tags", title: "The call queue tag and workflow", group: "Ideas explained", guideIds: ["call-queue-tags"], tryView: "speed", related: ["speed-to-lead", "workflows"], keywords: ["tag", "call-now", "power dialer", "call queue", "workflow"] },
  { slug: "pipeline-replay", title: "How Replay works", group: "Ideas explained", guideIds: ["pipeline-replay"], tryView: "pipeline", related: ["funnel-and-pipeline", "pipeline-river"], keywords: ["replay", "history", "step changes"] },
  { slug: "pipeline-river", title: "What the river shows", group: "Ideas explained", guideIds: ["pipeline-river"], tryView: "pipeline", related: ["funnel-and-pipeline", "pipeline-replay"], keywords: ["river", "money flow", "leak", "funnel"] },
  { slug: "fathom-unmatched", title: "Fathom and unmatched meetings", group: "Ideas explained", guideIds: ["fathom-unmatched"], tryView: "settings", related: ["meeting-notes", "connections"], keywords: ["fathom", "unmatched", "inbox", "meeting"] },
  { slug: "report-sharing", title: "What a share link shows", group: "Ideas explained", guideIds: ["report-sharing"], tryView: "clients", related: ["reports-and-sharing"], keywords: ["share link", "report", "audit link", "14 days"] },
  { slug: "print-and-pdf", title: "Printing and PDF", group: "Ideas explained", guideIds: ["print-and-pdf"], tryView: "clients", related: ["reports-and-sharing"], keywords: ["print", "pdf", "download"] },
  { slug: "settings-replies", title: "Settings: Replies", group: "Connections and settings", guideIds: ["settings-replies"], tryView: "settings", related: ["settings", "speed-to-lead"], keywords: ["targets", "reply target", "stale days", "business hours"] },
  { slug: "settings-brand", title: "Settings: Brand", group: "Connections and settings", guideIds: ["settings-brand"], tryView: "settings", related: ["settings", "reports-and-sharing"], keywords: ["brand", "logo", "colour", "white label"] },
  { slug: "settings-notifications", title: "Settings: Notifications", group: "Connections and settings", guideIds: ["settings-notifications"], tryView: "settings", related: ["settings", "alerts"], keywords: ["notifications", "email address", "daily brief", "quiet days"] },
  { slug: "settings-integrations", title: "Settings: Integrations", group: "Connections and settings", guideIds: ["settings-integrations"], tryView: "settings", related: ["settings", "connections"], keywords: ["integrations", "tools", "connect"] },
  { slug: "settings-team", title: "Settings: Team", group: "Connections and settings", guideIds: ["settings-team"], tryView: "settings", related: ["settings", "team"], keywords: ["client access", "test accounts", "team"] },
  { slug: "settings-data", title: "Settings: Data", group: "Connections and settings", guideIds: ["settings-data"], tryView: "settings", related: ["settings", "safety-and-sending"], keywords: ["delete my data", "stored", "privacy"] },
  { slug: "settings-sync", title: "Settings: Sync status", group: "Connections and settings", guideIds: ["settings-sync"], tryView: "settings", related: ["settings"], keywords: ["sync", "fresh", "full resync"] },
  { slug: "settings-advanced", title: "Settings: Advanced", group: "Connections and settings", guideIds: ["settings-advanced"], tryView: "settings", related: ["settings"], keywords: ["advanced", "api keys", "login address", "history"] },
];

/**
 * Where each in-app guide lives on the website. One guide, one page; several guides can share a page. The in-app "Read the full guide" links and the test both read this.
 * (The pages above list their guides, so this is derived, never typed twice.)
 */
export const GUIDE_DOC: Readonly<Record<string, string>> = (() => {
  const out: Record<string, string> = {};
  for (const p of DOC_PAGES) for (const id of p.guideIds) if (!(id in out) || p.guideIds.length === 1) out[id] = p.slug;
  return out;
})();

export const docHref = (slug: string, anchor?: string) => `/support/${slug}${anchor ? `#${anchor}` : ""}`;
/** The public page that explains an in-app guide, or null when the guide has none. */
export const guideDocHref = (guideId: string): string | null => (GUIDE_DOC[guideId] ? docHref(GUIDE_DOC[guideId], guideId) : null);

export const pageBySlug = (slug: string): DocPage | undefined => DOC_PAGES.find((p) => p.slug === slug);
export const guidesOf = (p: DocPage): Guide[] => p.guideIds.map((id) => GUIDES.find((g) => g.id === id)).filter((g): g is Guide => !!g);

export type DocView = {
  slug: string; title: string; group: DocGroup; summary: string; who: string; sees: Array<{ id?: string; title?: string; bullets: string[]; next?: string }>;
  steps: string[]; reads: string; changes: string; numbers: Array<[string, string]>; faq: Array<[string, string]>; related: string[]; keywords: string[]; tryView?: string; shot?: string;
};

/** The finished page: the guides' words plus the page's own extras. */
export function viewOf(p: DocPage): DocView {
  const guides = guidesOf(p);
  const first = guides[0];
  const sees: DocView["sees"] = [];
  if (p.sees) sees.push({ bullets: p.sees });
  for (const g of guides) sees.push({ id: g.id, title: guides.length > 1 ? g.title : undefined, bullets: [...g.read, ...(g.more ? [`${g.more.title}: ${g.more.read.join(" ")}`] : [])], next: g.next });
  return {
    slug: p.slug, title: p.title, group: p.group,
    summary: p.summary ?? first?.shows ?? "",
    who: p.who ?? "Anyone who uses SubSync.",
    sees,
    steps: p.steps ?? guides.map((g) => g.next),
    reads: p.reads ?? READS_STANDARD,
    changes: p.changes ?? "Nothing changes in your CRM until you see a preview and confirm it. Every change is logged.",
    numbers: p.numbers ?? [], faq: p.faq ?? [], related: p.related ?? [], keywords: p.keywords ?? [],
    tryView: p.tryView, shot: p.shot,
  };
}

export const CRM_NOTE = "Open SubSync from your CRM's left menu, then choose the page in SubSync's own menu. If you cannot see SubSync there, ask the owner of the account to install it or to switch it on for you.";

export type SearchEntry = { slug: string; title: string; group: DocGroup; summary: string; text: string };
export function searchIndex(): SearchEntry[] {
  return DOC_PAGES.map((p) => {
    const v = viewOf(p);
    return { slug: p.slug, title: p.title, group: p.group, summary: v.summary, text: [p.title, v.summary, ...(p.keywords ?? []), ...v.sees.flatMap((s) => s.bullets)].join(" ").toLowerCase() };
  });
}

export const GLOSSARY: ReadonlyArray<[string, string]> = [
  ["Client account", "One business whose leads, appointments and deals SubSync watches. If you run one business, you have one."],
  ["Setter", "A person who answers new leads and books appointments."],
  ["Closer", "A person who runs the appointment and turns it into a sale."],
  ["Speed to lead", "How long a new lead waits before a person first answers them."],
  ["Show rate", "The share of booked appointments where the person turned up."],
  ["True show rate", "The show rate worked out only from appointments with a marked outcome, shown when there are enough of them."],
  ["No-show recovery", "Calling people who missed an appointment and have not rebooked."],
  ["Stale deal", "An open deal that has not moved for longer than your stale setting, judged against its own pipeline step."],
  ["Duplicate group", "Two or more contacts that look like the same person."],
  ["Certain, likely, possible", "How sure SubSync is about a duplicate group. Only certain ones can be merged in bulk."],
  ["Primary contact", "The contact kept when duplicates are merged. The others are merged into it and removed."],
  ["Preview and confirm", "Before SubSync changes anything in your CRM it shows exactly what will happen and waits for you."],
  ["Audit log", "The record of every change SubSync made: who, what, when and the value before."],
  ["Do not contact", "A contact who asked not to be contacted. SubSync keeps them out of every send, and never deletes or merges them."],
  ["Call queue", "A list of waiting leads handed to your CRM's calling tool with a tag."],
  ["Replay", "Playing back your recorded deal step changes day by day."],
  ["Health score", "0 to 100 for a client account, from recent activity, new contacts, pipeline health, reply speed and data quality."],
  ["Estimate", "A number worked out from your own data with a formula, and always labelled as an estimate."],
  ["Needs permission: reconnect", "The feature needs a permission that was not approved. Approve it from your CRM's apps page."],
];
