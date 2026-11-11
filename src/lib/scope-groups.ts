// The permissions SubSync asks for, grouped by what they are for, each with a plain reason (N64). Pure, no database, so the Settings panel, the Trust page, the
// "Needs permission: reconnect" prompts and docs/SCOPES.md all read one list, and a test (src/lib/__tests__/scope-experience.test.ts) fails when:
//   - a permission in src/lib/ghl/scopes.ts has no entry here, or an entry here is not in that list;
//   - docs/SCOPES.md does not justify exactly the same set;
//   - a feature prompt names a permission that is not asked for.
//
// Three different situations used to share one blurred sentence (docs/CAPABILITIES.md): the app never asked for the permission, the install declined it, or the
// platform refuses even with it. Only the first two are about permissions, and only they say "Needs permission: reconnect".
import { GHL_SCOPES } from "./ghl/scopes.ts";
import { NEEDS_PERMISSION } from "./meeting-wording.ts";

export type ScopeKind = "read" | "change";
export type ScopeInfo = { scope: (typeof GHL_SCOPES)[number]; kind: ScopeKind; required: boolean; why: string };
export type ScopeGroup = { id: string; title: string; summary: string; scopes: ScopeInfo[] };

// Required or optional is as set in the marketplace listing (docs/SCOPE_PLAN.md: 7 required and 2 optional in version 1.0.0, then 12 more, all optional, in 2.0.0).
export const SCOPE_GROUPS: readonly ScopeGroup[] = [
  { id: "accounts", title: "Your client accounts", summary: "Which accounts SubSync is connected to, and the one-account-at-a-time access it reads them with.", scopes: [
    { scope: "locations.readonly", kind: "read", required: true, why: "Names, time zones and contact details of your client accounts, so every number is shown against the right account and clock." },
    { scope: "oauth.readonly", kind: "read", required: true, why: "Lists the accounts SubSync is installed on, so a new account is found without you doing anything." },
    { scope: "oauth.write", kind: "change", required: true, why: "Lets SubSync read one client account at a time with a key limited to that account. The platform offers no read-only way to do this. It changes nothing in your accounts." },
  ] },
  { id: "contacts", title: "Contacts", summary: "People in your accounts.", scopes: [
    { scope: "contacts.readonly", kind: "read", required: true, why: "Contacts and their tags, source, owner and do-not-contact flag, for search, call lists, data health and lead counts." },
    { scope: "contacts.write", kind: "change", required: false, why: "Only to add a meeting summary as a note on the matched contact, and for Data cleanup (which always shows a preview first). Optional. Without it SubSync keeps working and the feature says: Needs permission, reconnect." },
  ] },
  { id: "deals", title: "Deals", summary: "Your pipelines and the money in them.", scopes: [
    { scope: "opportunities.readonly", kind: "read", required: true, why: "Deals, pipelines and stages, for open pipeline, stale deals and the account audit." },
    { scope: "opportunities.write", kind: "change", required: false, why: "Reserved for a later, previewed action on deals. Nothing in SubSync uses it today." },
  ] },
  { id: "calls", title: "Conversations and calls", summary: "Who wrote to a lead, when, and whether a person or an automation did.", scopes: [
    { scope: "conversations.readonly", kind: "read", required: true, why: "The conversation list: last message, direction, channel and unread count, for unanswered messages. Message text is never copied." },
    { scope: "conversations/message.readonly", kind: "read", required: false, why: "The messages inside a conversation, only to see who sent each one and when (a person or an automation, a call or a text). This is the only way to measure true speed to lead. The text of a message is never stored." },
    { scope: "conversations/reports.readonly", kind: "read", required: false, why: "Reserved for conversation reports. Not used yet." },
  ] },
  { id: "appointments", title: "Appointments", summary: "Bookings and what happened to them.", scopes: [
    { scope: "calendars.readonly", kind: "read", required: true, why: "Calendars, for the setup checklist and to know which calendars exist." },
    { scope: "calendars/events.readonly", kind: "read", required: false, why: "Appointments and their status (showed, no-show, never marked), for the appointment checks and the no-show list." },
    { scope: "calendars/groups.readonly", kind: "read", required: false, why: "Calendar groups, so every calendar can be listed under its group, even one with no bookings." },
    { scope: "calendars/resources.readonly", kind: "read", required: false, why: "Reserved for rooms and equipment. Not used yet." },
    { scope: "calendars/events.write", kind: "change", required: false, why: "Reserved for marking an appointment showed or no-show after a preview. Nothing in SubSync uses it today." },
  ] },
  { id: "team", title: "Team", summary: "Your team members' names.", scopes: [
    { scope: "users.readonly", kind: "read", required: false, why: "Team member names, so lists and leaderboards say who, never a raw ID. Without it lists cannot show names, and the feature says: Needs permission, reconnect." },
  ] },
  { id: "tags", title: "Tags, fields and tasks", summary: "How your accounts label and follow up on contacts.", scopes: [
    { scope: "locations/tags.readonly", kind: "read", required: false, why: "Tag names, for hot-lead and cold-list rules." },
    { scope: "locations/customFields.readonly", kind: "read", required: false, why: "Reserved for lead-source detail. Not used yet." },
    { scope: "locations/tasks.readonly", kind: "read", required: false, why: "Reserved for task follow-up checks. Not used yet." },
    { scope: "locations/tags.write", kind: "change", required: false, why: "Reserved for tagging after a preview. Nothing in SubSync uses it today." },
    { scope: "locations/tasks.write", kind: "change", required: false, why: "Reserved for creating follow-up tasks after a preview. Nothing in SubSync uses it today." },
  ] },
  { id: "workflows", title: "Workflows and campaigns", summary: "The automations and campaigns in your client accounts, and how they are doing.", scopes: [
    { scope: "workflows.readonly", kind: "read", required: false, why: "The list of workflows in each client account (name, state, last edited), for the Workflows page. Without it the page says: Needs permission, reconnect." },
    { scope: "workflows.logs", kind: "read", required: false, why: "How many times each workflow ran and how many steps failed in the last 30 days, to find broken or idle ones. Who went through a workflow is never stored." },
    { scope: "workflows.write", kind: "change", required: false, why: "Only to rename a workflow or copy one into another client account, after a preview and a confirm. Optional." },
    { scope: "workflows.publish", kind: "change", required: false, why: "Only to publish or pause a workflow, after a preview and a confirm. Optional." },
    { scope: "workflows.delete", kind: "change", required: false, why: "Only to delete a workflow, after a preview, a typed confirmation and a saved copy. Optional." },
    { scope: "campaigns.readonly", kind: "read", required: false, why: "The list of campaigns in each client account (name, state, last change), to find stuck or failed ones. Read only: SubSync never starts or sends a campaign." },
    { scope: "emails/campaigns.readonly", kind: "read", required: false, why: "The email, bulk and workflow campaigns of each client account, read only, for the same list." },
    { scope: "emails/stats.readonly", kind: "read", required: false, why: "How many messages of each campaign were sent, delivered, opened, clicked, bounced or are still waiting, to find campaigns that looked sent but did not arrive. Totals only: SubSync never sees who received what." },
    { scope: "saas/location.read", kind: "read", required: false, why: "The plan and subscription status each client account has on your plans, for the Billing view in Clients. Without it the view says: Needs permission, reconnect." },
    { scope: "saas/company.read", kind: "read", required: false, why: "The list of client accounts on your plans, so the Billing view can show every account. Optional." },
  ] },
];

/** Groups with no CRM permission at all, said on purpose so nobody goes looking for a switch that does not exist. */
export const NO_PERMISSION_GROUPS = [
  { id: "email_health", title: "Email health", text: "No permission needed. SubSync checks the sending domain's public DNS records (SPF, DKIM, DMARC) from the domain it finds on the account's profile." },
] as const;

/** What SubSync does NOT ask for, and why (docs/CAPABILITIES.md). Asking for these would need a new release and a new approval from every install. */
export const NOT_REQUESTED: ReadonlyArray<{ id: string; scope: string; why: string }> = [
  { id: "payments", scope: "payments/transactions.readonly", why: "Failed payments and wallet balance. Not asked for: financial permissions cost trust and no feature needs them yet." },
  { id: "invoices", scope: "invoices.readonly", why: "Invoices. Not asked for, for the same reason." },
  { id: "forms", scope: "forms.readonly", why: "Form-by-form lead source. Not asked for yet." },
  { id: "installer", scope: "marketplace-installer-details.readonly", why: "Reading each install's plan, to double-check billing. Planned for a later release." },
  { id: "send", scope: "conversations/message.write", why: "Sending messages. Never asked for: SubSync does not reply to anyone, it measures how fast your team does." },
];

const ALL: ReadonlyArray<ScopeInfo> = SCOPE_GROUPS.flatMap((g) => g.scopes);
export const SCOPE_NAMES: readonly string[] = ALL.map((s) => s.scope);
export const infoFor = (scope: string): ScopeInfo | undefined => ALL.find((s) => s.scope === scope);
export const groupOf = (scope: string): ScopeGroup | undefined => SCOPE_GROUPS.find((g) => g.scopes.some((s) => s.scope === scope));

/** The scopes the install granted, from the space-separated list the platform gave at install. */
export const parseGranted = (raw: string | null | undefined): string[] => (raw ?? "").split(/\s+/).filter(Boolean);

export type GroupStatus = { id: string; title: string; summary: string; scopes: Array<ScopeInfo & { granted: boolean }>; missing: number };

/** Each group with what the install granted. `granted` null means not known (the demo): nothing is marked missing. */
export function groupStatus(granted: string[] | null): GroupStatus[] {
  return SCOPE_GROUPS.map((g) => {
    const scopes = g.scopes.map((s) => ({ ...s, granted: granted === null ? true : granted.includes(s.scope) }));
    return { id: g.id, title: g.title, summary: g.summary, scopes, missing: scopes.filter((s) => !s.granted).length };
  });
}

// Features that need an optional permission, in plain words, each with the permission it needs. Every screen that cannot work without one says the same
// thing: "Needs permission: reconnect". A feature not listed here needs no optional permission.
export type FeatureNeed = { id: string; feature: string; scope: string };
export const FEATURE_NEEDS: readonly FeatureNeed[] = [
  { id: "speed", feature: "Who replied first to each new lead", scope: "conversations/message.readonly" },
  { id: "appointments", feature: "Appointment checks and the no-show list", scope: "calendars/events.readonly" },
  { id: "team_names", feature: "Team member names", scope: "users.readonly" },
  { id: "tags", feature: "Hot-lead and cold-list rules that use tags", scope: "locations/tags.readonly" },
  { id: "workflow_history", feature: "Failing and idle workflow checks", scope: "workflows.logs" },
  { id: "campaign_stats", feature: "Campaign delivery figures", scope: "emails/stats.readonly" },
  { id: "campaigns", feature: "The campaign list and its health", scope: "campaigns.readonly" },
  { id: "client_billing", feature: "Each client's plan and subscription status", scope: "saas/location.read" },
  { id: "data_health_fix", feature: "Fixing phone formats and name capitals in Data health", scope: "contacts.write" },
  { id: "meeting_notes", feature: "Adding a meeting summary to a contact's notes", scope: "contacts.write" },
];

export type Prompt = { feature: string; scope: string; group: string; headline: string; detail: string };

/** The prompt a screen shows for a feature, or null when the permission is granted (or not known). */
export function permissionPrompt(featureId: string, granted: string[] | null): Prompt | null {
  const need = FEATURE_NEEDS.find((f) => f.id === featureId);
  if (!need || granted === null || granted.includes(need.scope)) return null;
  const group = groupOf(need.scope);
  return {
    feature: need.feature, scope: need.scope, group: group?.title ?? "Permissions", headline: NEEDS_PERMISSION,
    detail: `${need.feature} needs the "${group?.title ?? "permissions"}" permission (${need.scope}). Open SubSync again from your CRM's app list and accept it. Nothing else changes.`,
  };
}

/** The one place the pieces above meet GHL_SCOPES: used by the test. */
export const REQUESTED = GHL_SCOPES as readonly string[];
