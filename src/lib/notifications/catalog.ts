// The kinds of message SubSync sends (stage F9, N42, N79, N98), in one place with no database or network imports so a screen, the dispatcher and the
// tests all read the same facts. Each kind has: what it is called, when it is sent, which words it uses, and what a person gets with zero setup.

export const NOTIFICATION_TYPES = [
  "daily_brief", "weekly_summary", "speed_breach", "unmarked_appointments", "silent_failure", "sync_problem", "other_alerts", "new_ticket", "ticket_resolved",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const isNotificationType = (v: unknown): v is NotificationType => typeof v === "string" && (NOTIFICATION_TYPES as readonly string[]).includes(v);

export type Severity = "info" | "warning" | "critical";
export type Frequency = "immediate" | "daily" | "weekly";

/** A name that may appear in a message's wording as {name}, with a made-up value for the live preview. */
export type Variable = { name: string; label: string; sample: string };

export type TypeInfo = {
  id: NotificationType;
  label: string;
  /** One plain sentence: when this is sent. */
  hint: string;
  /** "scheduled" types are built at a chosen time (a brief); "event" types are sent when something happens. */
  kind: "scheduled" | "event";
  /** False for a kind whose feature is not built yet (tickets). It is listed so people can see it is coming, and nothing is ever sent. */
  active: boolean;
  /** Frequencies a person may choose. A scheduled kind has exactly one family: daily or weekly. */
  frequencies: Frequency[];
  defaultFrequency: Frequency;
  defaultSeverity: Severity;
  variables: Variable[];
  defaultTitle: string;
  defaultBody: string;
  /** The page the message links to (a nav id), so a person goes straight to the thing. */
  openView: string;
  /** Alert kinds (the `kind` column of the alerts table) that are sent as this type. */
  alertKinds?: string[];
  /** What a person gets with zero setup. */
  defaults: { inApp: boolean; email: boolean; slack: boolean };
};

const ACCOUNT: Variable = { name: "account", label: "The client account", sample: "Sample Dental" };
const COMPANY: Variable = { name: "company", label: "Your company name", sample: "Your company" };

export const CATALOG: Record<NotificationType, TypeInfo> = {
  daily_brief: {
    id: "daily_brief", label: "Daily brief", hint: "Once a day, at the time you choose: what changed and which accounts need you.", kind: "scheduled", active: true,
    frequencies: ["daily"], defaultFrequency: "daily", defaultSeverity: "info", openView: "today",
    variables: [COMPANY, { name: "attention_count", label: "Accounts that need you", sample: "3" }, { name: "fine_count", label: "Accounts that are fine", sample: "9" }, { name: "date", label: "Today's date", sample: "2 Nov" }],
    defaultTitle: "{company}: your daily brief",
    defaultBody: "{attention_count} accounts need you today and {fine_count} are fine.",
    defaults: { inApp: true, email: false, slack: true },
  },
  weekly_summary: {
    id: "weekly_summary", label: "Weekly summary", hint: "Once a week, on the day and at the time you choose: the week in a few lines.", kind: "scheduled", active: true,
    frequencies: ["weekly"], defaultFrequency: "weekly", defaultSeverity: "info", openView: "today",
    variables: [COMPANY, { name: "attention_count", label: "Accounts that need you", sample: "3" }, { name: "fine_count", label: "Accounts that are fine", sample: "9" }],
    defaultTitle: "{company}: {attention_count} accounts need you this week",
    defaultBody: "Here is your week in a few lines.",
    defaults: { inApp: true, email: true, slack: false },
  },
  speed_breach: {
    id: "speed_breach", label: "New leads waiting too long", hint: "As soon as 3 or more new leads have waited past your reply target with no reply from a person.", kind: "event", active: true,
    frequencies: ["immediate", "daily"], defaultFrequency: "immediate", defaultSeverity: "warning", openView: "speed", alertKinds: ["speed"],
    variables: [ACCOUNT, { name: "count", label: "Leads waiting", sample: "9" }, { name: "target", label: "Your reply target, in minutes", sample: "15" }, { name: "longest", label: "The longest wait", sample: "2 h 10 min" }],
    defaultTitle: "{account}: {count} new leads have waited more than {target} minutes for a reply",
    defaultBody: "Open Speed to lead to see who is waiting and call them first.",
    defaults: { inApp: true, email: true, slack: true },
  },
  unmarked_appointments: {
    id: "unmarked_appointments", label: "Appointments with no outcome", hint: "When 5 or more past appointments in an account were never marked as showed or no-show.", kind: "event", active: true,
    frequencies: ["immediate", "daily"], defaultFrequency: "immediate", defaultSeverity: "warning", openView: "appointments", alertKinds: ["appointments"],
    variables: [ACCOUNT, { name: "count", label: "Appointments with no outcome", sample: "12" }],
    defaultTitle: "{account}: {count} past appointments have no outcome recorded, so the show rate is a guess",
    defaultBody: "Open Appointments and mark each one as showed or no-show.",
    defaults: { inApp: true, email: true, slack: true },
  },
  silent_failure: {
    id: "silent_failure", label: "Something stopped quietly", hint: "When an account goes quiet, new contacts drop sharply, or its email sending breaks, with no error message of its own.", kind: "event", active: true,
    frequencies: ["immediate", "daily"], defaultFrequency: "immediate", defaultSeverity: "warning", openView: "accounts", alertKinds: ["dormant", "leadflow", "email"],
    variables: [ACCOUNT, { name: "problem", label: "What looks wrong", sample: "looks dormant" }],
    defaultTitle: "{account}: {problem}",
    defaultBody: "Open the account to see when it last had activity.",
    defaults: { inApp: true, email: true, slack: true },
  },
  sync_problem: {
    id: "sync_problem", label: "Data refresh problem", hint: "When SubSync cannot refresh an account, or its data is more than 30 minutes old.", kind: "event", active: true,
    frequencies: ["immediate"], defaultFrequency: "immediate", defaultSeverity: "warning", openView: "settings", alertKinds: ["sync"],
    variables: [ACCOUNT, { name: "minutes", label: "Minutes since the last refresh", sample: "45" }, { name: "problem", label: "What went wrong", sample: "could not be refreshed" }],
    defaultTitle: "{account}: {problem}",
    defaultBody: "Numbers on screen may be out of date until this is fixed. Open Settings, Sync status to try again.",
    defaults: { inApp: true, email: true, slack: false },
  },
  other_alerts: {
    id: "other_alerts", label: "Other alerts", hint: "Late replies, stale deals, churn risk and data quality, as they are raised.", kind: "event", active: true,
    frequencies: ["immediate", "daily"], defaultFrequency: "immediate", defaultSeverity: "warning", openView: "alerts", alertKinds: ["sla", "stale", "churn", "quality"],
    variables: [ACCOUNT, { name: "problem", label: "What looks wrong", sample: "has 6 conversations waiting over 4h" }],
    defaultTitle: "{account}: {problem}",
    defaultBody: "Open Alerts to see the details.",
    defaults: { inApp: true, email: true, slack: true },
  },
  new_ticket: {
    id: "new_ticket", label: "New ticket", hint: "When a client opens a support ticket. Tickets are not built yet, so this is not sent.", kind: "event", active: false,
    frequencies: ["immediate"], defaultFrequency: "immediate", defaultSeverity: "info", openView: "clients",
    variables: [{ name: "client", label: "The client", sample: "Sample Dental" }, { name: "subject", label: "The ticket subject", sample: "Calendar not showing" }],
    defaultTitle: "{client} opened a ticket: {subject}",
    defaultBody: "Open it to reply.",
    defaults: { inApp: true, email: true, slack: false },
  },
  ticket_resolved: {
    id: "ticket_resolved", label: "Ticket resolved", hint: "When a ticket is marked resolved. Tickets are not built yet, so this is not sent.", kind: "event", active: false,
    frequencies: ["immediate"], defaultFrequency: "immediate", defaultSeverity: "info", openView: "clients",
    variables: [{ name: "client", label: "The client", sample: "Sample Dental" }, { name: "subject", label: "The ticket subject", sample: "Calendar not showing" }],
    defaultTitle: "{client}: ticket resolved, {subject}",
    defaultBody: "Nothing more to do.",
    defaults: { inApp: true, email: false, slack: false },
  },
};

export const typeInfo = (t: NotificationType): TypeInfo => CATALOG[t];

/** Which notification type an alert is sent as, by the alert's `kind`. An unknown kind goes to "other alerts", so no alert is ever dropped. */
export function typeForAlertKind(kind: string): NotificationType {
  for (const id of NOTIFICATION_TYPES) if (CATALOG[id].alertKinds?.includes(kind)) return id;
  return "other_alerts";
}

/** The page a message opens, as a hash address ("#speed", "#account=<id>"). No host: the app adds its own, and the CRM link helper adds the white-label one. */
export function linkFor(t: NotificationType, locationId: string | null): { view: string; locationId: string | null } {
  const view = CATALOG[t].openView;
  return { view: locationId && (view === "accounts") ? "account" : view, locationId };
}
