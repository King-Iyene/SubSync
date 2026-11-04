export type ViewId =
  | "today" | "myday" | "audit" | "speed" | "overview" | "accounts" | "account" | "search" | "deals" | "inbox" | "onboarding" | "email" | "duplicates" | "alerts" | "settings" | "help" | "pipeline" | "leads" | "calls" | "clients" | "team" | "appointments" | "meetings" | "cleanup" | "roadmap" | "people" | "connections" | "notifications";

export type GoFn = (view: ViewId, locationId?: string) => void;

// The pilot menu (stage D0, N43 and UX-11): a short list of plain groups. Everything else the app already shows stays reachable under "More"
// (or inside a module as a tab); nothing that was visible has been removed, and a page behind a switch stays behind it (the `feature` below).
export type NavGroup = "" | "Daily work" | "Clients and people" | "More" | "Settings and help";

export type NavItem = {
  id: Exclude<ViewId, "account">; label: string; feature: string; group: NavGroup;
  /** A page that lives inside another module as a tab. It has no menu entry of its own; the parent's entry stays highlighted. */
  parent?: Exclude<ViewId, "account">;
  /** A page with a parent that a business or a client's staff still see in their own menu (their parent is not in their menu). */
  showWhenLimited?: boolean;
  /** A page with a parent that stays in the menu only for a kind of session whose menu has no parent (a client's staff have no Settings, so they get the Integrations entry). */
  showWhenParentHidden?: boolean;
};

export const NAV: NavItem[] = [
  { id: "today", label: "Today", feature: "overview", group: "" },
  { id: "speed", label: "Speed to lead", feature: "speed", group: "Daily work" },
  { id: "appointments", label: "Appointments", feature: "appointments", group: "Daily work" },
  { id: "inbox", label: "Unanswered messages", feature: "inbox", group: "Daily work" },
  { id: "audit", label: "Account audit", feature: "audit", group: "Daily work" },
  { id: "clients", label: "Clients", feature: "clients", group: "Clients and people" },
  { id: "people", label: "People", feature: "search", group: "Clients and people" },
  { id: "search", label: "Contact search", feature: "search", group: "Clients and people", parent: "people" },
  { id: "leads", label: "Leads", feature: "activity", group: "Clients and people", parent: "people" },
  { id: "calls", label: "Call lists", feature: "calls", group: "Clients and people", parent: "people" },
  { id: "overview", label: "Overview", feature: "overview", group: "More" },
  { id: "accounts", label: "Accounts", feature: "health", group: "More", parent: "clients" },
  { id: "team", label: "Team", feature: "team", group: "More" },
  { id: "pipeline", label: "Pipeline and deals", feature: "pipelines", group: "More" },
  { id: "onboarding", label: "Setup", feature: "onboarding", group: "More", parent: "clients", showWhenLimited: true },
  { id: "duplicates", label: "Duplicates", feature: "duplicates", group: "More" },
  { id: "cleanup", label: "Data cleanup", feature: "cleanup", group: "More" },
  { id: "meetings", label: "Meeting notes", feature: "meetings", group: "More" },
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
export const PARENT: Partial<Record<ViewId, ViewId>> = { account: "clients", accounts: "clients", onboarding: "clients", deals: "pipeline", email: "clients", alerts: "today", search: "people", leads: "people", calls: "people", notifications: "settings", connections: "settings" };

/**
 * The menu entries one kind of session sees. `allowed` is that kind's page list (NAV_FOR), `limited` is true for a business and a client's staff, `off` says whether a feature
 * is switched off. A page that lives inside another page has no entry of its own, except where its flag says it stays: Setup for a business (showWhenLimited) and
 * Integrations for a client's staff, whose menu has no Settings to hold it (showWhenParentHidden). Pure, so a test can prove each kind's menu.
 */
export function visibleNav(allowed: ReadonlySet<string>, { limited, off }: { limited: boolean; off: (feature: string) => boolean }): NavItem[] {
  return NAV.filter((n) => allowed.has(n.id) && !off(n.feature) && (!n.parent || (limited && n.showWhenLimited === true) || (n.showWhenParentHidden === true && !allowed.has(n.parent))));
}
