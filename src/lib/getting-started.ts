// The Getting started guide, one list per kind of person (N87). Pure: the server gathers facts and hands them here, so what each step says and when it ticks is
// unit tested without a database. A step ticks only from a fact (a page really opened, a setting really saved, a channel really connected), never from a click
// on the tick box, and "Do it now" opens the place where the step is done.
import type { AccessKind } from "./access.ts";
import type { SectionId } from "./settings-sections.ts";

export type GuideRole = "agency_owner" | "agency_staff" | "account_admin" | "account_user";

/** From the signed session: its kind and the platform's own role word ("admin" or "user"). Nothing the browser sends takes part. */
export function guideRoleOf(kind: AccessKind, rawRole: string | null | undefined): GuideRole {
  if (kind === "client") return "account_user";
  if (kind === "business") return "account_admin";
  return (rawRole ?? "").trim().toLowerCase() === "admin" ? "agency_owner" : "agency_staff";
}

export type ArtId = "connect" | "sync" | "today" | "speed" | "target" | "bell" | "mail" | "test" | "share" | "clients" | "meeting" | "search" | "calendar" | "feedback";

export type Step = {
  id: string; title: string; body: string; done: boolean; detail: string | null;
  /** The page "Do it now" opens (a menu id), and the Settings section when it is Settings. null for a step with nothing to open. */
  view: string | null; section?: SectionId; cta: string | null; optional?: boolean;
  /** Pages whose opening ticks this step. For a client's staff the company-wide counter says nothing about them, so the page ticks it from this browser instead. */
  ticksOn?: string[];
  /** Which small drawing goes with the step (drawn in the page with plain SVG, no video). */
  art: ArtId;
};

export type Facts = {
  synced: boolean; syncDetail: string;
  /** Page ids this company has opened at least once (usage counter, no personal data). */
  seen: ReadonlySet<string>;
  /** False for a client's staff: the counter is the agency's, so it is not used to tick their steps. */
  companyUsage: boolean;
  slackBrief: boolean; emailSet: boolean; clientViewOn: number;
  /** Accounts set to be left out of every number, and accounts whose name looks like a test account. */
  ignoredCount: number; testLookingCount: number;
  /** Names of settings changed, from the settings audit lines (never values). */
  changedKeys: ReadonlySet<string>;
  sharedAudits: number; feedbackGiven: number;
  meetingsPage: boolean; zoomOn: boolean;
  /** Stage C1: how many clients have a monthly fee typed in, and whether the Clients page is switched on. Left out means none and on. */
  clientFees?: number; clientsPage?: boolean;
};

const TARGET_KEYS = ["slaHours", "speedTargetMinutes", "staleDays", "dormantDays", "speedBusinessHours", "countAutomatedTouches"] as const;

export const GUIDE_TITLES: Record<GuideRole, { title: string; subtitle: string }> = {
  agency_owner: { title: "Getting started", subtitle: "A short checklist for you as the owner. It ticks itself off as you go." },
  agency_staff: { title: "Getting started", subtitle: "A short checklist for your day. It ticks itself off as you go." },
  account_admin: { title: "Getting started", subtitle: "A short checklist for your account. It ticks itself off as you go." },
  account_user: { title: "Getting started", subtitle: "Three things to try. They tick themselves off as you go." },
};

export function buildSteps(role: GuideRole, f: Facts): Step[] {
  const agency = role === "agency_owner" || role === "agency_staff";
  const seen = (v: string) => f.companyUsage && f.seen.has(v);
  const changed = TARGET_KEYS.some((k) => f.changedKeys.has(k));
  const what = agency ? "client accounts" : "account";

  const connected: Step = { id: "connected", title: "Connect SubSync", done: true, art: "connect", view: null, cta: null,
    detail: agency ? "Connected to all your client accounts." : "Connected to your account.",
    body: "You are signed in through your CRM, so there is nothing to type. SubSync mostly reads your data." };
  const synced: Step = { id: "synced", title: "Let the first sync finish", done: f.synced, art: "sync", detail: f.syncDetail, view: "overview", cta: "See how fresh your data is",
    body: `SubSync reads your ${what} in the background. The first sync takes a few minutes, longer with many contacts. Numbers fill in as it goes.` };
  const today: Step = { id: "today", title: "See what needs you today", done: seen("today") || seen("myday"), ticksOn: ["today", "myday"], art: "today", detail: null, view: "today", cta: "Open Today",
    body: "The first screen ranks what to do first, with the reason and a link. Start at the top." };
  const speed: Step = { id: "speed", title: "Find the leads still waiting", done: seen("speed"), ticksOn: ["speed"], art: "speed", detail: null, view: "speed", cta: "Open Speed to lead",
    body: "Every new lead is timed from the moment it arrives to the first reply from a person. Open the waiting list, call the oldest first, and open the lead in your CRM from there." };
  const calendar: Step = { id: "appointments", title: "Check today's appointments", done: seen("appointments"), ticksOn: ["appointments"], art: "calendar", detail: null, view: "appointments", cta: "Open Appointments",
    body: "See appointments that have passed without being marked showed or no-show, and the no-shows still to rebook." };
  const search: Step = { id: "search", title: "Find any contact", done: seen("search") || seen("people"), ticksOn: ["search", "people"], art: "search", detail: null, view: "people", cta: "Open People",
    body: `Search by name, email or phone${agency ? " across every client account at once" : ""}, and open the contact's timeline.` };
  const targets: Step = { id: "targets", title: "Set your reply targets", done: changed, art: "target", detail: null, view: "settings", section: "targets", cta: "Open reply targets",
    body: "Decide how many minutes a new lead may wait and how many hours a customer message may wait. Every late count and alert uses these." };
  const brief: Step = { id: "brief", title: "Get the daily brief in Slack", done: f.slackBrief, art: "bell", optional: false, detail: null, view: "settings", section: "notifications", cta: "Open notifications",
    body: "Connect a Slack channel and choose the hour. It arrives once a day in your time zone." };
  const email: Step = { id: "email", title: "Get alerts and the Monday email", done: f.emailSet, art: "mail", detail: null, view: "settings", section: "notifications", cta: "Open notifications",
    body: "Type one email address. New critical and warning alerts are emailed to it, and a short summary arrives every Monday. Nothing is sent until you add an address." };
  const tests: Step = { id: "tests", title: "Leave test accounts out of your numbers", optional: true, art: "test",
    done: f.ignoredCount > 0 || f.testLookingCount === 0,
    detail: f.testLookingCount > 0 && f.ignoredCount === 0 ? (f.testLookingCount === 1 ? "1 account looks like a test account." : `${f.testLookingCount} accounts look like test accounts.`) : f.ignoredCount > 0 ? `${f.ignoredCount} account${f.ignoredCount === 1 ? " is" : "s are"} left out.` : "No account looks like a test account.",
    view: "settings", section: "team", cta: "Choose accounts to leave out",
    body: "A practice or demo account in your list inflates every total. Switch it on here and it stops counting everywhere: numbers, alerts and lists." };
  const share: Step = { id: "share", title: "Share an audit with a prospect", done: f.sharedAudits > 0, optional: true, art: "share", detail: null, view: "audit", cta: "Open Account audit",
    body: "The audit lists what is wrong and the money at risk. Press Share and send the link: it hides client names and stops working after 14 days." };
  const clients: Step = { id: "clients", title: "Let a client see their own account", done: f.clientViewOn > 0, optional: true, art: "clients", detail: null, view: "settings", section: "team", cta: "Open team and access",
    body: "Switch on a read-only view for a client's own staff. They see only their own account: never other clients, fees or notes." };
  // Fees, renewal dates and industry are typed by the owner (SubSync cannot read them from the CRM), so this step says so and opens the row where they are typed.
  const fees: Step[] = f.clientsPage === false ? [] : [{ id: "client_fees", title: "Add what each client pays you (optional)", done: (f.clientFees ?? 0) > 0, ticksOn: [], optional: true, art: "clients", detail: null, view: "clients", cta: "Open Clients",
    body: "Type each client's monthly fee and renewal date on the Clients page, in the row itself. SubSync cannot read them from your CRM, so you enter them once and the revenue, renewal and value-created figures fill in." }];
  const meetings: Step[] = f.meetingsPage ? [{ id: "meetings", title: "Connect a meeting tool (optional)", done: seen("meetings"), ticksOn: ["meetings"], optional: true, art: "meeting", detail: null, view: "meetings", cta: "Open Meeting notes",
    body: `Connect ${f.zoomOn ? "Zoom or Fathom" : "Fathom"} and each meeting summary is saved in SubSync. When the guest matches one contact, it is also added to that contact's notes in your CRM, if you allow it.` }] : [];
  const feedback: Step = { id: "feedback", title: "Tell us what would help", done: f.feedbackGiven > 0 || seen("roadmap"), ticksOn: ["roadmap"], art: "feedback", optional: true, detail: null, view: "roadmap", cta: "Open What's new",
    body: "Use Give feedback at the bottom of any page, or suggest something on the What's new page. It goes to the people who build SubSync." };

  switch (role) {
    case "agency_owner": return [connected, synced, today, speed, search, targets, brief, email, tests, share, ...fees, clients, ...meetings, feedback];
    case "agency_staff": return [connected, today, speed, calendar, search, feedback];
    case "account_admin": return [connected, synced, today, speed, calendar, search, targets, brief, email, ...meetings, feedback];
    case "account_user": return [connected, today, speed, calendar, feedback];
  }
}

export const progressOf = (steps: readonly Pick<Step, "done">[]) => ({ done: steps.filter((s) => s.done).length, total: steps.length });
