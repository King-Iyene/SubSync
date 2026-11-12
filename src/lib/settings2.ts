// Settings, rearranged (stage ST). Pure: the sections, what each holds, the search index and the modules a person may hide. No database, no React.
import type { SectionId as OldSectionId } from "./settings-sections.ts";

export type HubSectionId = "account" | "connections" | "permissions" | "alerts" | "team" | "targets" | "data" | "modules" | "safety" | "help";

export type HubSection = {
  id: HubSectionId; title: string; hint: string;
  /** The sections of the older Settings page this one draws (one form is kept across them). */
  old: readonly OldSectionId[];
};

export const HUB_SECTIONS: readonly HubSection[] = [
  { id: "account", title: "Account and plan", hint: "Your name, logo and colours, links, and your plan.", old: ["brand"] },
  { id: "connections", title: "Connections", hint: "Slack, Fathom and the other tools SubSync works with: who connected them and what each one does.", old: [] },
  { id: "permissions", title: "Permissions", hint: "Everything SubSync may read, why, and what to do when one is missing.", old: [] },
  { id: "alerts", title: "Alerts and notifications", hint: "The daily brief, alert emails, quiet hours and where each message goes.", old: ["notifications"] },
  { id: "team", title: "Team and roles", hint: "Who can open SubSync, who counts as a setter or closer, and which accounts are left out.", old: ["team"] },
  { id: "targets", title: "Targets", hint: "How fast a lead should hear back, and what counts as late, stale or quiet.", old: ["targets"] },
  { id: "data", title: "Data", hint: "What SubSync keeps, since when, and how to delete it.", old: ["privacy", "sync", "advanced"] },
  { id: "modules", title: "Modules", hint: "Choose which pages appear in your own menu.", old: [] },
  { id: "safety", title: "Safety", hint: "When SubSync may change something in your CRM, and how to keep it to reading only.", old: [] },
  { id: "help", title: "Help and support", hint: "Guides, who to write to and how fast we answer.", old: [] },
];

export const isHubSection = (v: unknown): v is HubSectionId => typeof v === "string" && HUB_SECTIONS.some((s) => s.id === v);

export type SearchEntry = { id: string; label: string; section: HubSectionId; words: string };

/** Every setting a person might look for, and where it lives. A test checks each points at a real section. */
export const SEARCH_INDEX: readonly SearchEntry[] = [
  { id: "brand", label: "Logo, name and colour", section: "account", words: "brand white label logo colour color name reports" },
  { id: "plan", label: "My plan and billing", section: "account", words: "plan billing price trial paid free pro" },
  { id: "links", label: "Login address for Open links", section: "data", words: "links domain address open" },
  { id: "slack", label: "Slack", section: "connections", words: "slack channel connect brief alerts" },
  { id: "fathom", label: "Fathom meeting notes", section: "connections", words: "fathom meeting notes calls connect summary" },
  { id: "email", label: "Email sending domain", section: "connections", words: "email domain sending spf dkim dmarc" },
  { id: "calendars", label: "Calendars", section: "connections", words: "calendar appointments booking" },
  { id: "permissions", label: "Permissions SubSync asks for", section: "permissions", words: "permission scope granted reconnect approve missing" },
  { id: "digest", label: "Daily brief", section: "alerts", words: "digest daily brief morning summary" },
  { id: "weekly", label: "Weekly email", section: "alerts", words: "weekly monday email summary" },
  { id: "quiet", label: "Quiet hours", section: "alerts", words: "quiet hours night mute sleep" },
  { id: "bell", label: "Notification channels", section: "alerts", words: "notifications bell channels slack email" },
  { id: "roles", label: "Setter and closer roles", section: "team", words: "role setter closer manager team label" },
  { id: "client-access", label: "Client access to their own account", section: "team", words: "client view access staff read only" },
  { id: "test-accounts", label: "Leave test accounts out", section: "team", words: "test practice demo ignore account" },
  { id: "reply-target", label: "Reply target", section: "targets", words: "sla reply target minutes hours late speed" },
  { id: "stale", label: "Stale deal and gone quiet days", section: "targets", words: "stale dormant quiet days deal" },
  { id: "hours", label: "Business hours", section: "targets", words: "business hours open close weekend" },
  { id: "history", label: "Where my history starts", section: "data", words: "history window since start data kept" },
  { id: "delete", label: "Delete my data", section: "data", words: "delete purge remove erase data uninstall privacy" },
  { id: "transcripts", label: "Meeting transcripts and notes", section: "data", words: "transcript notes privacy meeting" },
  { id: "ai", label: "AI assistant connector", section: "data", words: "ai assistant key mcp claude" },
  { id: "menu", label: "Pages in my menu", section: "modules", words: "modules menu hide show pages sidebar" },
  { id: "write", label: "Allow changes in a client account", section: "safety", words: "write live changes dry run allow cleanup safety" },
  { id: "support", label: "Contact support", section: "help", words: "support help email contact" },
  { id: "guides", label: "Getting started and guides", section: "help", words: "guide getting started how to learn" },
];

export function searchSettings(q: string): SearchEntry[] {
  const t = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (t.length === 0) return [];
  return SEARCH_INDEX.filter((e) => t.every((w) => `${e.label} ${e.words}`.toLowerCase().includes(w)));
}

/** Pages a person may hide from their own menu (never Today, Settings, Getting started or What's new). Plain names, as the menu shows them. */
export const HIDEABLE_MODULES: ReadonlyArray<{ id: string; name: string; what: string }> = [
  { id: "speed", name: "Speed to lead", what: "How long new leads wait for a first reply." },
  { id: "appointments", name: "Appointments", what: "Bookings, missing outcomes and no-shows to win back." },
  { id: "clients", name: "Clients", what: "Every client account, its health and its plan." },
  { id: "payments", name: "Payments", what: "Failed and late payments to chase." },
  { id: "people", name: "Find a lead", what: "Search every contact and build lists." },
  { id: "audit", name: "Account audit", what: "Problems found and the money at risk." },
  { id: "cleanup", name: "Clean-up", what: "Duplicates and data quality." },
  { id: "overview", name: "Overview", what: "The older numbers page." },
  { id: "team", name: "Team", what: "Who does what, per person." },
  { id: "pipeline", name: "Pipeline and deals", what: "Deals, stages and stale deals." },
  { id: "meetings", name: "Meeting notes", what: "Summaries from your meeting tool." },
  { id: "workflows", name: "Workflows", what: "Automations that failed or went idle." },
  { id: "data-health", name: "Data health", what: "Missing and wrong contact details." },
];
export const HIDEABLE_IDS: ReadonlySet<string> = new Set(HIDEABLE_MODULES.map((m) => m.id));

export const STATE_KINDS = ["news_seen", "guide_read", "module_hidden"] as const;
export type StateKind = (typeof STATE_KINDS)[number];
