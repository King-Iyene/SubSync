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

// Required or optional is as set in the marketplace listing (docs/SCOPE_PLAN.md: 7 required and 2 optional in version 1.0.0, then 12 more, all optional, in 2.0.0, and more since (40 in all with release 1.1.0)).
export const SCOPE_GROUPS: readonly ScopeGroup[] = [
  { id: "accounts", title: "Your client accounts", summary: "Which accounts SubSync is connected to, and the one-account-at-a-time access it reads them with.", scopes: [
    { scope: "locations.readonly", kind: "read", required: true, why: "Names, time zones and contact details of your client accounts, so every number is shown against the right account and clock." },
    { scope: "oauth.readonly", kind: "read", required: true, why: "Lists the accounts SubSync is installed on, so a new account is found without you doing anything." },
    { scope: "oauth.write", kind: "change", required: true, why: "Lets SubSync read one client account at a time with a key limited to that account. The platform offers no read-only way to do this. Changes in your accounts only happen after you preview and confirm, are logged, and can be undone where possible." },
    { scope: "locations.features.read", kind: "read", required: false, why: "Which features each client account has switched on, for the Account setup check screen (planned), which will list what is missing in an account. Optional. Not used yet." },
  ] },
  { id: "contacts", title: "Contacts", summary: "People in your accounts.", scopes: [
    { scope: "contacts.readonly", kind: "read", required: true, why: "Contacts and their tags, source, owner and do-not-contact flag, for search, call lists, data health and lead counts." },
    { scope: "contacts.write", kind: "change", required: false, why: "Only to add a meeting summary as a note on the matched contact, and for Data cleanup (which always shows a preview first). Optional. Without it SubSync keeps working and the feature says: Needs permission, reconnect." },
  ] },
  { id: "deals", title: "Deals", summary: "Your pipelines and the money in them.", scopes: [
    { scope: "opportunities.readonly", kind: "read", required: true, why: "Deals, pipelines and stages, for open pipeline, stale deals and the account audit." },
    { scope: "opportunities.write", kind: "change", required: false, why: "Only to change a deal (stage, status, value, owner, name) or delete one from the Pipeline screen, after a preview. A delete also needs a typed confirmation. Optional." },
  ] },
  { id: "calls", title: "Conversations and calls", summary: "Who wrote to a lead, when, and whether a person or an automation did.", scopes: [
    { scope: "conversations.readonly", kind: "read", required: true, why: "The conversation list: last message, direction, channel and unread count, for unanswered messages. Message text is never copied." },
    { scope: "conversations/message.readonly", kind: "read", required: false, why: "The messages inside a conversation, only to see who sent each one and when (a person or an automation, a call or a text). This is the only way to measure true speed to lead. The text of a message is never stored." },
    { scope: "conversations/message.write", kind: "change", required: false, why: "Only to send a text or an email to one lead when a person presses Send, after a preview. Optional. SubSync never sends on its own and never to a contact who asked not to be contacted. Without it the message box says: Needs permission, reconnect." },
    { scope: "conversations.write", kind: "change", required: false, why: "Only to delete one junk conversation in Clear junk (Unanswered messages), after a preview and a typed count. A deleted conversation cannot be brought back. Optional. SubSync never deletes on its own, and never for a contact who asked not to be contacted or who has an open deal." },
    { scope: "conversations/reports.readonly", kind: "read", required: false, why: "Response-time totals the platform already calculates, to compare with SubSync's own numbers. Optional, for later features, nothing uses it yet. Not used yet." },
    { scope: "conversations/livechat.write", kind: "change", required: false, why: "Reserved, no screen yet: replying to website chat from SubSync, which would always need a person to press Send. Optional, for later features, nothing uses it yet. Not used yet." },
  ] },
  { id: "appointments", title: "Appointments", summary: "Bookings and what happened to them.", scopes: [
    { scope: "calendars.readonly", kind: "read", required: true, why: "Calendars, for the setup checklist and to know which calendars exist." },
    { scope: "calendars/events.readonly", kind: "read", required: false, why: "Appointments and their status (showed, no-show, never marked), for the appointment checks and the no-show list." },
    { scope: "calendars/groups.readonly", kind: "read", required: false, why: "Calendar groups, so every calendar can be listed under its group, even one with no bookings." },
    { scope: "calendars/resources.readonly", kind: "read", required: false, why: "Rooms and equipment, for the Account setup check screen (planned), which will flag a calendar that points to a room or item that no longer exists. Optional. Not used yet." },
    { scope: "calendars/events.write", kind: "change", required: false, why: "Only to create, change (status, time, owner, calendar, title) or delete an appointment from the Appointments screen, after a preview. A delete also needs a typed confirmation. Optional." },
  ] },
  { id: "team", title: "Team", summary: "Your team members' names.", scopes: [
    { scope: "users.readonly", kind: "read", required: false, why: "Team member names, so lists and leaderboards say who, never a raw ID. Without it lists cannot show names, and the feature says: Needs permission, reconnect." },
  ] },
  { id: "tags", title: "Tags, fields and tasks", summary: "How your accounts label and follow up on contacts.", scopes: [
    { scope: "locations/tags.readonly", kind: "read", required: false, why: "Tag names, for hot-lead and cold-list rules." },
    { scope: "locations/customFields.readonly", kind: "read", required: false, why: "The names of your custom fields, so a field shows its name instead of a code. Names only, never the values." },
    { scope: "locations/tags.write", kind: "change", required: false, why: "Reserved, no screen yet: creating or renaming tags, which would always show a preview first. Optional, for later features, nothing uses it yet. Not used yet." },
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
    { scope: "saas/location.read", kind: "read", required: false, why: "Optional. Requested for the Plans and payments block on the Clients screen. Honest status: the platform's public API description lists no read that this permission unlocks (the plan reads ask for saas/company.read, company level), so the block shows Needs permission or Not available until the platform confirms what it unlocks." },
  ] },
  { id: "payments", title: "Payments and credit", summary: "Failed and late payments, so you can chase the money, and the credit balance of each client account.", scopes: [
    { scope: "payments/transactions.readonly", kind: "read", required: false, why: "Each payment's status, amount and who paid, to list failed payments and refunds. Read only: SubSync cannot charge, refund or retry anything. Without it Payments says: Needs permission, reconnect." },
    { scope: "payments/subscriptions.readonly", kind: "read", required: false, why: "Whether a customer's repeat payment is active or past due, to list failed repeat payments. Read only." },
    { scope: "invoices.readonly", kind: "read", required: false, why: "Which invoices are sent, partly paid or paid and when they are due, to list late invoices. Read only: SubSync never sends or changes an invoice." },
    { scope: "wallet.readonly", kind: "read", required: false, why: "The credit balance of each client account, to warn you before it runs out. Read only." },
    { scope: "marketplace-installer-details.readonly", kind: "read", required: false, why: "One record for the token that asks: the installer, the company and the plan id (no dates, no trial). Used only to cross-check the Marketplace installs block, whose dates, plan and trial flag come from the installed list. Read only." },
  ] },
  { id: "money", title: "Money checks", summary: "Orders, invoices, products and payment setup, for the Money checks screen (planned). All read only. Optional, and nothing uses them yet.", scopes: [
    { scope: "payments/orders.readonly", kind: "read", required: false, why: "Orders and their payment status, for the Money checks screen (planned), to find orders that were never paid. Read only. Optional. Not used yet." },
    { scope: "payments/coupons.readonly", kind: "read", required: false, why: "The discount codes in each client account, for the Money checks screen (planned), to find expired or unlimited ones. Read only. Optional. Not used yet." },
    { scope: "payments/integration.readonly", kind: "read", required: false, why: "Whether a payment provider is connected and in live or test mode, for the Money checks screen (planned), so a client taking test payments is caught. Read only. Optional. Not used yet." },
    { scope: "payments/custom-provider.readonly", kind: "read", required: false, why: "Whether a custom payment provider is set up, for the Money checks screen (planned). Read only. Optional. Not used yet." },
    { scope: "charges.readonly", kind: "read", required: false, why: "Charges the platform made for your usage, for the Money checks screen (planned), to warn about a surprise bill. Read only. Optional. Not used yet." },
    { scope: "products.readonly", kind: "read", required: false, why: "The products you sell, for the Money checks screen (planned), to find a product without a price or an image. Read only. Optional. Not used yet." },
    { scope: "products/prices.readonly", kind: "read", required: false, why: "The prices set on each product, for the Money checks screen (planned), to find a missing or zero price. Read only. Optional. Not used yet." },
    { scope: "products/collection.readonly", kind: "read", required: false, why: "Product collections, for the Money checks screen (planned), to find an empty one. Read only. Optional. Not used yet." },
    { scope: "invoices/schedule.readonly", kind: "read", required: false, why: "Repeating invoice schedules, for the Money checks screen (planned), to find one that stopped. Read only. Optional. Not used yet." },
    { scope: "invoices/template.readonly", kind: "read", required: false, why: "Invoice templates, for the Money checks screen (planned), to find an account with none set up. Read only. Optional. Not used yet." },
    { scope: "invoices/estimate.readonly", kind: "read", required: false, why: "Estimates and whether they were accepted, for the Money checks screen (planned), to find estimates nobody followed up. Read only. Optional. Not used yet." },
  ] },
  { id: "setup", title: "Account setup check", summary: "What each client account has set up, for the Account setup check screen (planned): which pipelines, templates, numbers and files exist and what is missing. All read only. Optional, and nothing uses them yet.", scopes: [
    { scope: "pipelines.readonly", kind: "read", required: false, why: "The list of pipelines and their stages, for the Account setup check screen (planned), to find an account with no pipeline or an empty stage list. Read only. Optional. Not used yet." },
    { scope: "objects/schema.readonly", kind: "read", required: false, why: "The names of custom record types, for the Account setup check screen (planned). Names only. Optional. Not used yet." },
    { scope: "objects/record.readonly", kind: "read", required: false, why: "How many records each custom record type holds, for the Account setup check screen (planned). A count only. Optional. Not used yet." },
    { scope: "notes.readonly", kind: "read", required: false, why: "Whether contacts have notes, for the Account setup check screen (planned). Counts only, SubSync does not copy note text. Optional. Not used yet." },
    { scope: "locations/customValues.readonly", kind: "read", required: false, why: "The names of the custom values (company name, links, hours) set in each client account, for the Account setup check screen (planned), to find an empty one. Optional. Not used yet." },
    { scope: "locations/templates.readonly", kind: "read", required: false, why: "The names of the text and email templates in each client account, for the Account setup check screen (planned). Names only. Optional. Not used yet." },
    { scope: "locations/tasks.readonly", kind: "read", required: false, why: "Open and overdue tasks, for the Account setup check screen (planned), to find tasks nobody is doing. Optional. Not used yet." },
    { scope: "recurring-tasks.readonly", kind: "read", required: false, why: "Repeating tasks, for the Account setup check screen (planned), to find one that stopped. Optional. Not used yet." },
    { scope: "files.readonly", kind: "read", required: false, why: "The names of uploaded files, for the Account setup check screen (planned). Names only, files are never opened. Optional. Not used yet." },
    { scope: "lc-email.readonly", kind: "read", required: false, why: "The sending email addresses connected to each client account, for the Account setup check screen (planned), to find one that is not set up. Optional. Not used yet." },
    { scope: "emails/builder.readonly", kind: "read", required: false, why: "The names of saved email designs, for the Account setup check screen (planned). Names only. Optional. Not used yet." },
    { scope: "emails/schedule.readonly", kind: "read", required: false, why: "Emails scheduled to go out, for the Account setup check screen (planned), to find one stuck in the queue. Read only. Optional. Not used yet." },
    { scope: "emails/templates.readonly", kind: "read", required: false, why: "The names of email templates, for the Account setup check screen (planned). Names only. Optional. Not used yet." },
    { scope: "phonenumbers.read", kind: "read", required: false, why: "The phone numbers of each client account, for the Account setup check screen (planned), to find an account with no number to call or text from. Optional. Not used yet." },
    { scope: "numberpools.read", kind: "read", required: false, why: "Number pools (groups of sending numbers), for the Account setup check screen (planned), to find an empty pool. Optional. Not used yet." },
  ] },
  { id: "reserved", title: "Reserved, no screen yet", summary: "Permissions asked for now, so a later feature never forces every install to approve again. Nothing in SubSync uses them today, and every use would show a preview first.", scopes: [
    { scope: "locations/customValues.write", kind: "change", required: false, why: "Reserved, no screen yet: changing a custom value in a client account, after a preview. Optional, for later features, nothing uses it yet. Not used yet." },
    { scope: "locations/tasks.write", kind: "change", required: false, why: "Reserved, no screen yet: creating an internal task for your team, after a preview. Optional, for later features, nothing uses it yet. Not used yet." },
    { scope: "recurring-tasks.write", kind: "change", required: false, why: "Reserved, no screen yet: creating or stopping a repeating task, after a preview. Optional, for later features, nothing uses it yet. Not used yet." },
    { scope: "notes.write", kind: "change", required: false, why: "Reserved, no screen yet: adding a note to a contact, after a preview. Optional, for later features, nothing uses it yet. Not used yet." },
    { scope: "pipelines.write", kind: "change", required: false, why: "Reserved, no screen yet: changing a pipeline or its stages, after a preview. Optional, for later features, nothing uses it yet. Not used yet." },
    { scope: "pipelines.create", kind: "change", required: false, why: "Reserved, no screen yet: creating a pipeline, after a preview. Optional, for later features, nothing uses it yet. Not used yet." },
    { scope: "invoices.write", kind: "change", required: false, why: "Reserved, no screen yet: changing an invoice, after a preview and a typed confirmation. SubSync never sends an invoice on its own, and the resend button is switched off. Optional, for later features, nothing uses it yet. Not used yet." },
    { scope: "invoices/schedule.write", kind: "change", required: false, why: "Reserved, no screen yet: pausing or changing a repeating invoice, after a preview. Optional, for later features, nothing uses it yet. Not used yet." },
    { scope: "invoices/template.write", kind: "change", required: false, why: "Reserved, no screen yet: changing an invoice template, after a preview. Optional, for later features, nothing uses it yet. Not used yet." },
    { scope: "invoices/estimate.write", kind: "change", required: false, why: "Reserved, no screen yet: changing an estimate, after a preview. Optional, for later features, nothing uses it yet. Not used yet." },
  ] },
  { id: "intake", title: "Lead intake", summary: "Which form, survey or funnel each lead came from, so you can see which one brings good leads and which one goes quiet.", scopes: [
    { scope: "forms.readonly", kind: "read", required: false, why: "The names of your forms and when each was submitted, to count submissions per form and warn you when one goes quiet. SubSync never reads the answers. Without it Lead intake says: Needs permission, reconnect." },
    { scope: "surveys.readonly", kind: "read", required: false, why: "The same for surveys and applications: names and submission times only, never the answers." },
    { scope: "funnels/funnel.readonly", kind: "read", required: false, why: "The names and number of steps of your funnels, so a lead whose source carries a funnel name can be shown under it. Funnel views and conversion are not available from the platform." },
    { scope: "funnels/page.readonly", kind: "read", required: false, why: "The names of the pages inside each funnel, for the Lead intake health screen (planned), so a funnel with a missing or empty page is found. Page names only. Optional. Not used yet." },
    { scope: "funnels/pagecount.readonly", kind: "read", required: false, why: "How many pages a funnel has, for the Lead intake health screen (planned). A count only. Optional. Not used yet." },
    { scope: "funnels/redirect.readonly", kind: "read", required: false, why: "The redirects set on your funnels, for the Lead intake health screen (planned), to find one that sends visitors to the wrong place. Read only. Optional. Not used yet." },
    { scope: "links.readonly", kind: "read", required: false, why: "The trigger links in each client account, for the Lead intake health screen (planned), to find links that stopped working. Link names and addresses only. Optional. Not used yet." },
  ] },
];

/** Groups with no CRM permission at all, said on purpose so nobody goes looking for a switch that does not exist. */
export const NO_PERMISSION_GROUPS = [
  { id: "email_health", title: "Email health", text: "No permission needed. SubSync checks the sending domain's public DNS records (SPF, DKIM, DMARC) from the domain it finds on the account's profile." },
] as const;

/** What SubSync does NOT ask for, and why (docs/CAPABILITIES.md). Asking for these would need a new release and a new approval from every install. */
export const NOT_REQUESTED: ReadonlyArray<{ id: string; scope: string; why: string }> = [
  { id: "team_edit", scope: "users.write", why: "Adding, changing or removing team members. Not asked for: SubSync never manages people." },
  { id: "client_plans", scope: "saas/company.read", why: "Reading your clients' plans and payment status. Not asked for: the platform only gives it to apps installed at company level, so it can never be granted to this app." },
];

const ALL: ReadonlyArray<ScopeInfo> = SCOPE_GROUPS.flatMap((g) => g.scopes);
export const SCOPE_NAMES: readonly string[] = ALL.map((s) => s.scope);
export const infoFor = (scope: string): ScopeInfo | undefined => ALL.find((s) => s.scope === scope);
export const groupOf = (scope: string): ScopeGroup | undefined => SCOPE_GROUPS.find((g) => g.scopes.some((s) => s.scope === scope));

/** The scopes the install granted, from the space-separated list the platform gave at install. */
export const parseGranted = (raw: string | null | undefined): string[] => (raw ?? "").split(/\s+/).filter(Boolean);

export type GroupStatus = { id: string; title: string; summary: string; scopes: Array<ScopeInfo & { granted: boolean; comingSoon: boolean }>; missing: number };

/** A permission asked for now, for a coming feature: nothing in SubSync reads or changes anything with it yet (its reason says "Not used yet"). */
export const isComingSoon = (scope: string): boolean => /Not used yet/.test(infoFor(scope)?.why ?? "");

/** Each group with what the install granted. `granted` null means not known (the demo): nothing is marked missing. */
export function groupStatus(granted: string[] | null): GroupStatus[] {
  return SCOPE_GROUPS.map((g) => {
    const scopes = g.scopes.map((s) => ({ ...s, granted: granted === null ? true : granted.includes(s.scope), comingSoon: isComingSoon(s.scope) }));
    // A coming-feature permission that was skipped is not "missing": no screen waits on it, so it never raises the reconnect warning.
    return { id: g.id, title: g.title, summary: g.summary, scopes, missing: scopes.filter((s) => !s.granted && !s.comingSoon).length };
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
  { id: "pay_transactions", feature: "Failed payments and refunds", scope: "payments/transactions.readonly" },
  { id: "pay_subscriptions", feature: "Failed repeat payments", scope: "payments/subscriptions.readonly" },
  { id: "pay_invoices", feature: "Late invoices", scope: "invoices.readonly" },
  { id: "intake_forms", feature: "Submissions per form and survey", scope: "forms.readonly" },
  { id: "pay_wallet", feature: "The credit balance of each client account", scope: "wallet.readonly" },
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
