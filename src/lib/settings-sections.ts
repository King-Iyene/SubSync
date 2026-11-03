// The sections of Settings (N76, N89): one list, so the left navigation, the "who sees what" rule and the tests all read the same thing.
// Pure: no database, no React. The screen draws one section at a time; every control keeps its meaning and its name.
import type { AccessKind } from "./access.ts";

export type SectionId = "team" | "notifications" | "integrations" | "targets" | "brand" | "privacy" | "sync" | "advanced";

export type Section = {
  id: SectionId;
  title: string;
  /** One line under the heading: what is in here and who it is for. */
  hint: string;
  /** Which kinds of session see it. A client's staff never open Settings at all (the route policy refuses it); the server is the guard, this only hides links. */
  kinds: readonly AccessKind[];
};

export const SECTIONS: readonly Section[] = [
  { id: "team", title: "Team and access", hint: "Who can open SubSync, and which client accounts are left out of every number.", kinds: ["agency", "business"] },
  { id: "notifications", title: "Notifications", hint: "Where alerts and the daily and weekly summaries go, and when.", kinds: ["agency", "business"] },
  { id: "integrations", title: "Integrations", hint: "Connections to other tools, and the permissions SubSync has.", kinds: ["agency", "business"] },
  { id: "targets", title: "Reply targets and thresholds", hint: "What counts as late, stale or gone quiet.", kinds: ["agency", "business"] },
  { id: "brand", title: "Brand", hint: "Your name and colour on screens, reports and share links.", kinds: ["agency", "business"] },
  { id: "privacy", title: "Data and privacy", hint: "What SubSync stores, meeting notes, and deleting everything.", kinds: ["agency", "business"] },
  { id: "sync", title: "Sync status", hint: "How fresh your data is and what runs when.", kinds: ["agency", "business"] },
  { id: "advanced", title: "Advanced", hint: "Login address, your own checklist, AI connector keys and the history of settings changes.", kinds: ["agency", "business"] },
];

export const SECTION_IDS: readonly SectionId[] = SECTIONS.map((s) => s.id);
export const isSectionId = (v: unknown): v is SectionId => typeof v === "string" && (SECTION_IDS as readonly string[]).includes(v);

/** The sections a kind of session may see. Never empty for agency or business. */
export const sectionsFor = (kind: AccessKind): Section[] => SECTIONS.filter((s) => s.kinds.includes(kind));

/** Every Settings control, and the section it lives in. A test checks that none is missing, so a control cannot be lost in the move. */
export const CONTROL_HOME: Readonly<Record<string, SectionId>> = {
  "client-access": "team", "test-accounts": "team", "who-can-open": "team", "team-connections": "integrations",
  "quiet-hours": "notifications", "slack": "notifications", "daily-brief": "notifications", "weekly-email": "notifications", "send-at": "notifications", "time-zone": "notifications",
  "connections": "integrations", "my-connections": "integrations", "permissions": "integrations", "watching": "sync",
  "stale-days": "targets", "dormant-days": "targets", "reply-target-hours": "targets", "speed-target": "targets", "automated-touches": "targets", "business-hours": "targets",
  "brand-name": "brand", "brand-colour": "brand",
  "what-we-store": "privacy", "meeting-privacy": "privacy", "delete-my-data": "privacy", "trust-page": "privacy",
  "sync-status": "sync",
  "links": "advanced", "checklist": "advanced", "ai-keys": "advanced", "settings-history": "advanced",
};

/** The Settings fields that change a number or an alert, grouped by section: the screen says "Saved. Numbers are being recalculated" only for these. */
export const NUMBER_SETTINGS = ["staleDays", "dormantDays", "slaHours", "speedTargetMinutes", "countAutomatedTouches", "speedBusinessHours", "speedOpenHour", "speedCloseHour", "alertQuietHours"] as const;

// ---- the history of settings changes, in words ----
/** What each setting is called on screen. Used to read the audit log back in plain words; a name that is not here is shown as "a setting". */
export const SETTING_LABEL: Readonly<Record<string, string>> = {
  staleDays: "Stale deal days", dormantDays: "Gone quiet days", slaHours: "Reply target (hours)", speedTargetMinutes: "Speed to lead target", countAutomatedTouches: "Count automatic messages",
  speedBusinessHours: "Business hours", speedOpenHour: "Opening hour", speedCloseHour: "Closing hour", alertQuietHours: "Quiet hours", digestEnabled: "Daily brief",
  digestHour: "Send hour", digestTimezone: "Time zone", digestEmail: "Alert email address", slackWebhookUrl: "Slack channel", brandName: "Brand name", brandColor: "Brand colour", brandLogoUrl: "Logo address",
  keepTranscripts: "Keep transcripts", pushNotesToCrm: "Add meeting notes to contacts", customChecklist: "Your checklist steps", appDomainOverride: "Login address", coldTags: "Cold-list tags",
  industryTargets: "Targets by industry", clientViewAll: "Client access for every account",
};

export const HISTORY_ACTION: Readonly<Record<string, string>> = {
  "settings.changed": "Changed settings", "accounts.flags_changed": "Changed an account switch", "apikey.created": "Created an AI connector key", "apikey.revoked": "Revoked an AI connector key",
  "data.purged": "Deleted all synced data", "data.purge_refused": "A delete of all data was refused", "connections.changed": "Changed a connection",
};

/** One line for the history card: what happened and which settings, by name, never a value. */
export function describeChange(action: string, keys: readonly string[]): string {
  const head = HISTORY_ACTION[action] ?? "Changed something";
  if (keys.length === 0) return head;
  const names = keys.map((k) => SETTING_LABEL[k] ?? (k === "ignored" ? "Leave out of every number" : k === "clientView" ? "Client access" : k === "owner" ? "Account owner label" : "a setting"));
  return `${head}: ${[...new Set(names)].join(", ")}`;
}

/** The browser memory key that holds the section Settings opens on. Getting started sets it before it opens Settings. */
export const SETTINGS_SECTION_KEY = "settings-section";
