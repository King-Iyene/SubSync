export type ViewId =
  | "today" | "overview" | "accounts" | "account" | "search" | "deals" | "inbox" | "onboarding" | "email" | "duplicates" | "alerts" | "settings" | "help" | "pipeline" | "leads" | "calls" | "clients" | "team";

export type GoFn = (view: ViewId, locationId?: string) => void;

export const NAV: Array<{ id: Exclude<ViewId, "account">; label: string; feature: string }> = [
  { id: "today", label: "Today", feature: "overview" },
  { id: "overview", label: "Overview", feature: "overview" },
  { id: "accounts", label: "Accounts", feature: "health" },
  { id: "clients", label: "Clients", feature: "reports" },
  { id: "team", label: "Team", feature: "team" },
  { id: "search", label: "Contact search", feature: "search" },
  { id: "pipeline", label: "Pipeline and deals", feature: "pipelines" },
  { id: "leads", label: "Leads", feature: "activity" },
  { id: "calls", label: "Call lists", feature: "calls" },
  { id: "inbox", label: "Inbox & SLA", feature: "inbox" },
  { id: "onboarding", label: "Setup", feature: "onboarding" },
  { id: "duplicates", label: "Duplicates", feature: "duplicates" },
  { id: "settings", label: "Settings", feature: "settings" },
  { id: "help", label: "Getting started", feature: "overview" },
];
