export type ViewId =
  | "today" | "overview" | "accounts" | "account" | "search" | "deals" | "inbox" | "onboarding" | "email" | "duplicates" | "alerts" | "settings" | "help" | "pipeline" | "leads" | "calls" | "clients" | "team" | "appointments" | "meetings";

export type GoFn = (view: ViewId, locationId?: string) => void;

export type NavGroup = "Daily" | "Sell" | "Clients" | "Tidy up" | "";

export const NAV: Array<{ id: Exclude<ViewId, "account">; label: string; feature: string; group: NavGroup }> = [
  { id: "today", label: "Today", feature: "overview", group: "Daily" },
  { id: "overview", label: "Overview", feature: "overview", group: "Daily" },
  { id: "inbox", label: "Inbox & SLA", feature: "inbox", group: "Daily" },
  { id: "appointments", label: "Appointments", feature: "appointments", group: "Daily" },
  { id: "meetings", label: "Meeting notes", feature: "meetings", group: "Daily" },
  { id: "search", label: "Contact search", feature: "search", group: "Sell" },
  { id: "pipeline", label: "Pipeline and deals", feature: "pipelines", group: "Sell" },
  { id: "leads", label: "Leads", feature: "activity", group: "Sell" },
  { id: "calls", label: "Call lists", feature: "calls", group: "Sell" },
  { id: "accounts", label: "Accounts", feature: "health", group: "Clients" },
  { id: "clients", label: "Clients", feature: "reports", group: "Clients" },
  { id: "team", label: "Team", feature: "team", group: "Clients" },
  { id: "onboarding", label: "Setup", feature: "onboarding", group: "Tidy up" },
  { id: "duplicates", label: "Duplicates", feature: "duplicates", group: "Tidy up" },
  { id: "settings", label: "Settings", feature: "settings", group: "" },
  { id: "help", label: "Getting started", feature: "overview", group: "" },
];
