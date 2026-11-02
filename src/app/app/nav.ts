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
};

export const NAV: NavItem[] = [
  { id: "today", label: "Today", feature: "overview", group: "" },
  { id: "myday", label: "My day", feature: "overview", group: "" },
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
  { id: "connections", label: "Connections", feature: "connections", group: "Settings and help" },
  // Notifications (F9) lives under Settings (no menu entry of its own), reached from the bell and from Settings.
  { id: "notifications", label: "Notifications", feature: "alerts", group: "Settings and help", parent: "settings" },
  { id: "help", label: "Getting started", feature: "overview", group: "Settings and help" },
  { id: "roadmap", label: "What's new", feature: "overview", group: "Settings and help" },
];

// Where a page that lives inside another page highlights in the menu, and where "back" lands when there is no trail.
export const PARENT: Partial<Record<ViewId, ViewId>> = { account: "clients", accounts: "clients", onboarding: "clients", deals: "pipeline", email: "clients", alerts: "today", search: "people", leads: "people", calls: "people", notifications: "settings" };
