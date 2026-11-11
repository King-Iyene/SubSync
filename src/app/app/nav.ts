export type ViewId =
  | "data-health" | "today" | "myday" | "audit" | "speed" | "overview" | "accounts" | "account" | "search" | "deals" | "inbox" | "onboarding" | "email" | "duplicates" | "alerts" | "settings" | "help" | "pipeline" | "leads" | "calls" | "clients" | "team" | "appointments" | "meetings" | "cleanup" | "roadmap" | "people" | "connections" | "notifications" | "workflows";

export type GoFn = (view: ViewId, locationId?: string) => void;

// The pilot menu: a short list of plain groups. Active screens stay reachable under "More" or inside their module;
// deferred screens remain implemented but are absent while their feature switch is off.
export type NavGroup = "" | "Reply" | "Clients and people" | "More" | "Settings and help";

export type NavItem = {
  id: Exclude<ViewId, "account">; label: string; feature: string; group: NavGroup;
  /** A page that lives inside another module as a tab. It has no menu entry of its own; the parent's entry stays highlighted. */
  parent?: Exclude<ViewId, "account">;
  /** A page with a parent that a business or a client's staff still see in their own menu (their parent is not in their menu). */
  showWhenLimited?: boolean;
  /** A page with a parent that stays in the menu only for a kind of session whose menu has no parent (a client's staff have no Settings, so they get the Integrations entry). */
  showWhenParentHidden?: boolean;
  /** A page with a parent that keeps its own menu entry only while the parent page is switched off or not in this kind of session's menu (Unanswered messages is a tab of Speed to lead; if Speed is off, it must stay reachable). */
  showWhenParentOff?: boolean;
};

export const NAV: NavItem[] = [
  // Money-first order (stage SHELL): today's work, then replies, then appointments, then who the clients and people are, then the audit and clean-up, then everything else.
  { id: "today", label: "Today", feature: "overview", group: "" },
  { id: "speed", label: "Speed to lead", feature: "speed", group: "Reply" },
  // Unanswered messages is a tab of Speed to lead now ("Unanswered"). The id stays so every old address and link (#inbox, a notification, an email) opens Speed on that tab; the entry
  // comes back by itself only if Speed to lead is off, so the screen is never lost.
  { id: "inbox", label: "Unanswered messages", feature: "inbox", group: "Reply", parent: "speed", showWhenParentOff: true },
  { id: "appointments", label: "Appointments", feature: "appointments", group: "" },
  { id: "clients", label: "Clients", feature: "clients", group: "Clients and people" },
  { id: "people", label: "Find a lead", feature: "search", group: "Clients and people" },
  { id: "search", label: "Contact search", feature: "search", group: "Clients and people", parent: "people" },
  { id: "leads", label: "Leads", feature: "activity", group: "Clients and people", parent: "people" },
  { id: "calls", label: "Call lists", feature: "calls", group: "Clients and people", parent: "people" },
  { id: "accounts", label: "Accounts", feature: "health", group: "Clients and people", parent: "clients" },
  { id: "onboarding", label: "Setup", feature: "onboarding", group: "Clients and people", parent: "clients", showWhenLimited: true },
  { id: "audit", label: "Account audit", feature: "audit", group: "" },
  // Clean-up is ONE entry (stage CLEANUP) holding Duplicates, Data quality, History and Rules. The old ids stay, so #duplicates and #cleanup still open the right tab. A client's staff have no
  // Clean-up of their own, so for them the Duplicates page is the Clean-up entry (showWhenParentHidden); their tabs are Duplicates and History.
  { id: "cleanup", label: "Clean-up", feature: "cleanup", group: "" },
  { id: "duplicates", label: "Clean-up", feature: "duplicates", group: "", parent: "cleanup", showWhenParentHidden: true },
  { id: "overview", label: "Overview", feature: "overview", group: "More" },
  { id: "team", label: "Team", feature: "team", group: "More" },
  { id: "pipeline", label: "Pipeline and deals", feature: "pipelines", group: "More" },
  { id: "meetings", label: "Meeting notes", feature: "meetings", group: "More" },
  { id: "workflows", label: "Workflows", feature: "workflows", group: "More" },
  { id: "data-health", label: "Data health", feature: "data_health", group: "More" },
  { id: "settings", label: "Settings", feature: "settings", group: "Settings and help" },
  // Connections moved into Settings, Integrations (4 Nov 2026). The id stays so every old address (#connections) and link still works: it opens Settings on Integrations.
  // A client's staff have no Settings, so for them it stays one menu entry, called Integrations (showWhenParentHidden).
  { id: "connections", label: "Integrations", feature: "connections", group: "Settings and help", parent: "settings", showWhenParentHidden: true },
  // Notifications (F9) lives under Settings (no menu entry of its own), reached from the bell and from Settings.
  { id: "notifications", label: "Notifications", feature: "alerts", group: "Settings and help", parent: "settings" },
  { id: "help", label: "Getting started", feature: "overview", group: "Settings and help" },
  { id: "roadmap", label: "What's new", feature: "overview", group: "Settings and help" },
];

// Where a page that lives inside another page highlights in the menu, and where "back" lands when there is no trail.
export const PARENT: Partial<Record<ViewId, ViewId>> = { inbox: "speed", duplicates: "cleanup", account: "clients", accounts: "clients", onboarding: "clients", deals: "pipeline", email: "clients", alerts: "today", search: "people", leads: "people", calls: "people", notifications: "settings", connections: "settings" };

/**
 * The menu entries one kind of session sees. `allowed` is that kind's page list (NAV_FOR), `limited` is true for a business and a client's staff, `off` says whether a feature
 * is switched off. A page that lives inside another page has no entry of its own, except where its flag says it stays: Setup for a business (showWhenLimited) and
 * Integrations for a client's staff, whose menu has no Settings to hold it (showWhenParentHidden). Pure, so a test can prove each kind's menu.
 */
export function visibleNav(allowed: ReadonlySet<string>, { limited, off }: { limited: boolean; off: (feature: string) => boolean }): NavItem[] {
  const featureOf = (id: string) => NAV.find((x) => x.id === id)?.feature;
  return NAV.filter((n) => allowed.has(n.id) && !off(n.feature) && (!n.parent || (limited && n.showWhenLimited === true) || (n.showWhenParentHidden === true && !allowed.has(n.parent)) || (n.showWhenParentOff === true && (!allowed.has(n.parent) || off(featureOf(n.parent) ?? n.parent)))));
}
