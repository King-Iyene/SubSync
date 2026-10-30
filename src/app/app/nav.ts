export type ViewId =
  | "overview" | "accounts" | "account" | "search" | "deals" | "inbox" | "onboarding" | "email" | "duplicates" | "alerts" | "settings" | "help";

export type GoFn = (view: ViewId, locationId?: string) => void;

export const NAV: Array<{ id: Exclude<ViewId, "account">; label: string; feature: string }> = [
  { id: "overview", label: "Overview", feature: "overview" },
  { id: "accounts", label: "Accounts", feature: "health" },
  { id: "search", label: "Contact search", feature: "search" },
  { id: "deals", label: "Deals", feature: "stale" },
  { id: "inbox", label: "Inbox & SLA", feature: "inbox" },
  { id: "onboarding", label: "Onboarding", feature: "onboarding" },
  { id: "email", label: "Email health", feature: "email" },
  { id: "duplicates", label: "Duplicates", feature: "duplicates" },
  { id: "alerts", label: "Alerts", feature: "alerts" },
  { id: "settings", label: "Settings", feature: "settings" },
  { id: "help", label: "Getting started", feature: "overview" },
];
