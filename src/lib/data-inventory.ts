// What SubSync stores, written once, next to the schema it describes (N83). Pure constants and functions, no database import, so a screen, the
// privacy page, the help text and the tests all read the same facts.
//
// How it stays true:
//   - Every table in the database has an entry here. A test compares this file with the real schema (the migration files, and the live
//     database when one is reachable) and fails for a table that is missing, or an entry for a table that no longer exists.
//   - A column that looks like it holds personal data (a name, an email, a phone number, free text, an owner, a token, and so on) must be listed
//     under `personal` with a plain-words label, or under `notPersonal` on purpose. A new column that looks personal fails the test until someone
//     decides, so a table cannot start holding personal data without it showing up in "What we store".
//   - The lines on the Settings card, the privacy page and the help text are produced from these entries. Nobody types the list by hand.
//   - What "Delete my data" and an uninstall remove is read from src/lib/tenant-tables.ts, the same lists the purge code runs, and a test runs them.

import { CONFIG_DELETE_ON_UNINSTALL, KEEP_ON_UNINSTALL, SYNCED_DELETE } from "./tenant-tables.ts";

/** A share link works for this many days, then stops. The router uses this number, so the text and the code cannot disagree. */
export const SHARE_LINK_DAYS = 14;

export type LineId = "contacts" | "deals" | "conversations" | "appointments" | "accounts" | "actions" | "meetings" | "shares" | "yours" | "sign_in" | "records";

export type TableInfo = {
  /** What a person calls this data when they are told it is deleted ("contacts", "deals"). */
  noun: string;
  /** Which line of "What we store" it belongs to. */
  line: LineId;
  /** Columns that hold personal data, or free text a person typed, each with a plain-words label. The label is what the person reads. */
  personal?: Record<string, string>;
  /** Columns the personal-data check would flag that are deliberately not personal (a pipeline's name, a feature switch's key). */
  notPersonal?: string[];
  /** Secret columns and how they are protected. */
  secrets?: Record<string, "encrypted" | "hashed">;
};

export const INVENTORY: Record<string, TableInfo> = {
  // ---- copied from your CRM (removed by "Delete my data" and by an uninstall)
  cached_contacts: {
    noun: "contacts", line: "contacts",
    personal: {
      first_name: "name", last_name: "name", full_name: "name", email: "email address", phone: "phone number", phone_digits: "phone number", tags: "tags",
      source: "where the contact came from", dnd: "whether they asked not to be contacted", birth_date: "birth date", assigned_to: "the team member the contact is assigned to",
    },
  },
  cached_opportunities: {
    noun: "deals", line: "deals",
    personal: { name: "deal name", contact_name: "the contact's name", assigned_to: "the deal's owner", source: "where the deal came from" },
    notPersonal: ["pipeline_name", "stage_name"],
  },
  pipelines: { noun: "pipeline and stage names", line: "deals", notPersonal: ["name"] },
  deal_events: { noun: "deal history", line: "deals" },
  contact_tag_events: { noun: "tag history (the day SubSync first saw a tag added or removed)", line: "contacts", personal: { tag: "tags" } },
  cached_conversations: {
    noun: "conversation details", line: "conversations",
    personal: { contact_name: "the contact's name" },
  },
  lead_touches: {
    noun: "first-reply records", line: "conversations",
    personal: { touch_user_id: "which team member replied first" },
  },
  cached_appointments: {
    noun: "appointments", line: "appointments",
    personal: { title: "appointment title", calendar_name: "calendar name", assigned_to: "the team member it is assigned to", booked_by_user: "the team member who booked it" },
    notPersonal: ["booking_channel"],
  },
  appointment_events: { noun: "appointment history", line: "appointments" },
  touch_events: { noun: "message and call history (who, which way, which channel, when; never the words)", line: "conversations", personal: { user_id: "which team member sent it" }, notPersonal: ["event_key", "channel", "source", "campaign", "outcome"] },
  lead_events: { noun: "lead history (arrived, owner changes, stage moves)", line: "conversations", personal: { user_id: "which team member made the change" }, notPersonal: ["event_key"] },
  speed_digest: { noun: "the Speed summary settings (who gets it, when, what it says)", line: "conversations", personal: { settings: "the email addresses chosen to receive it" }, notPersonal: ["location_id", "last_sent_key"] },
  speed_prefs: { noun: "Call mode and Speed choices (redial plan, goals, scripts, outcome sets)", line: "conversations", notPersonal: ["scope", "key", "value"] },
  speed_daily: { noun: "daily reply-speed numbers", line: "conversations", notPersonal: ["by_channel", "by_source", "by_owner", "by_hour", "texted_back_60"] },
  locations: {
    noun: "the list of client accounts", line: "accounts",
    personal: { name: "client account name", email: "the client business's email", phone: "the client business's phone", website: "the client business's website", address: "the client business's address", owner: "the owner label you give an account" },
    notPersonal: ["users_access", "cleanup_rules", "cleanup_write_enabled", "call_script"],
  },
  account_metrics_daily: { noun: "daily account numbers", line: "accounts" },
  alerts: {
    noun: "alerts", line: "accounts",
    personal: { title: "alert titles", detail: "alert details (they name client accounts and give numbers)" },
    notPersonal: ["dedupe_key"],
  },
  domain_checks: { noun: "email sending checks", line: "accounts", personal: { domain: "the email sending domain being checked" } },
  sync_jobs: { noun: "sync history", line: "accounts" },
  onboarding_tasks: { noun: "checklist progress", line: "yours", personal: { task: "your checklist steps" } },
  call_outcomes: { noun: "call results you logged", line: "yours", personal: { note: "call notes you type" } },
  cleanup_runs: {
    noun: "clean-up history", line: "actions",
    personal: { actor: "the name of the person who ran a clean-up", note: "the note typed with it", params: "the rules chosen for it" },
  },
  cleanup_changes: {
    noun: "clean-up history", line: "actions",
    personal: { before_value: "contact values before a clean-up (so it can be undone)", after_value: "contact values after a clean-up", field: "the field changed", tag: "tags a clean-up added or removed" },
  },
  duplicate_reviews: {
    noun: "duplicate decisions", line: "actions",
    personal: { snapshot: "a copy of the duplicate records you reviewed", decided_by: "the name of the person who decided" },
    notPersonal: ["group_key"],
  },
  possible_duplicates: { noun: "new contacts that may already exist", line: "accounts", notPersonal: ["contact_id", "other_contact_id", "score", "tier", "reasons", "status"] },
  cleanup_quality_snapshots: { noun: "daily data-quality scores", line: "accounts", notPersonal: ["day", "contacts", "score", "parts", "counts", "duplicate_groups", "duplicate_extra", "new_groups"] },
  duplicate_snoozes: { noun: "duplicate groups you set aside", line: "actions", personal: { decided_by: "the name of the person who set it aside" }, notPersonal: ["group_key", "until"] },
  meeting_notes: {
    noun: "meeting notes", line: "meetings",
    personal: {
      title: "the meeting title", attendees: "who attended (names and emails)", summary: "the summary", action_items: "action items", transcript: "the full transcript, only if you switch that on",
      recording_url: "a link to the recording", source: "which tool it came from",
    },
    notPersonal: ["crm_note_id", "crm_note_status"],
  },
  meetings: {
    noun: "meetings from connected tools", line: "meetings",
    personal: {
      owner_ghl_user_id: "which team member recorded it", title: "the meeting title", attendee_emails: "who attended (email addresses)", summary: "the summary", action_items: "action items",
      recording_url: "a link to the recording", transcript_ref: "a reference to the full transcript at the tool that made it (SubSync does not keep the transcript text)",
    },
    notPersonal: ["provider_meeting_id"],
  },
  notifications: {
    noun: "your notification centre", line: "accounts",
    personal: { title: "the words of each notification (they name client accounts and give numbers)", body: "the words of each notification (they name client accounts and give numbers)" },
    notPersonal: ["dedupe_key", "link"],
  },
  notification_states: { noun: "which notifications each person has read, dismissed or snoozed", line: "accounts", personal: { user_key: "the sign-in id of the person who read or dismissed a notification" } },
  notification_deliveries: {
    noun: "a record of the messages SubSync sent, or is waiting to send", line: "accounts",
    personal: { target: "the email address or Slack channel a message went to", payload: "the words of messages sent or waiting (they name client accounts and give numbers)" },
    notPersonal: ["dedupe_key", "channel"],
  },
  crm_writes: {
    noun: "a log of what SubSync wrote to your CRM", line: "meetings",
    personal: { authored_by: "which team member a note or comment was written as" },
  },
  contact_writes: {
    noun: "a log of the notes and call results you saved to a lead in your CRM (ids and status only, never the words)", line: "actions",
    personal: { actor: "the sign-in id of who saved it", actor_name: "the name of who saved it", tag: "the tag SubSync added" },
    notPersonal: ["kind", "outcome", "idem_key", "status", "note_id", "task_id", "tag_added", "detail"],
  },
  meeting_deliveries: { noun: "a list of meeting deliveries already handled (ids only)", line: "meetings" },
  field_write_state: { noun: "which meeting last filled each contact field SubSync updates (ids and times only, never the value)", line: "meetings" },
  shared_audits: { noun: "share links", line: "shares", personal: { payload: "a snapshot of totals, finding titles, fix steps and how each number is counted, with client names removed, plus your business name and colour" } },

  // ---- what you add, and your settings (kept by "Delete my data", removed by an uninstall)
  meeting_note_settings: {
    noun: "each person's meeting-note choices", line: "yours",
    personal: { ghl_user_id: "which team member the choices belong to", custom_template: "the note layout a person wrote for themselves" }, notPersonal: ["content_matrix", "source_priority", "preset_chosen"],
  },
  field_mappings: { noun: "which contact fields an admin chose for meeting notes", line: "yours", notPersonal: ["ghl_custom_field_id", "field_name", "field_type"] },
  meeting_ignored_emails: { noun: "email addresses a person asked to always ignore in their Meeting inbox", line: "yours", personal: { ghl_user_id: "which team member the choice belongs to", email: "an email address you chose to always ignore" } },
  call_lists: { noun: "saved call lists", line: "yours", personal: { name: "saved call list names", filters: "the filters of a saved list" } },
  account_profiles: {
    noun: "your notes and fees for each client", line: "yours",
    personal: { notes: "your notes about a client", monthly_fee: "what you charge a client", renewal_date: "a client's renewal date", industry: "a client's industry" },
  },
  goals: { noun: "goals", line: "yours" },
  annotations: { noun: "chart notes", line: "yours", personal: { text: "notes you add to charts" } },
  usage_events: { noun: "page-view counts", line: "records" },
  team_names: { noun: "team member names", line: "yours", personal: { user_id: "a team member's sign-in id", name: "team member names you type", photo_url: "a team member's picture address from your CRM" }, notPersonal: ["source"] },
  stage_rules: { noun: "how you treat pipelines and stages", line: "yours", personal: { pipeline_key: "the names of your pipelines", stage_key: "the names of your pipeline stages", updated_by: "the name of the person who changed a rule" } },
  report_templates: { noun: "saved report layouts", line: "yours", personal: { name: "saved report names", spec: "the layout of a saved report" } },
  saved_views: { noun: "your saved views of a page", line: "yours", personal: { owner: "who saved the view (a sign-in id)", name: "the name you gave a saved view", filters: "the choices in a saved view (client account, channel, person) and when you last opened Today" }, notPersonal: ["page"] },
  roadmap_votes: { noun: "roadmap votes", line: "yours", personal: { voter: "who voted on the roadmap (a sign-in id)" }, notPersonal: ["item_key"] },
  // Stage C1 (Clients): what you write about a client, and how far each client is through onboarding.
  client_notes: { noun: "notes and conversations you log about a client", line: "yours", personal: { body: "the notes and conversations you log about a client", author: "who wrote a client note" }, notPersonal: ["kind"] },
  onboarding_templates: { noun: "onboarding checklist templates", line: "yours", personal: { name: "the names of your onboarding templates", steps: "the steps of your onboarding templates" }, notPersonal: ["industry_key"] },
  client_steps: { noun: "who is on each onboarding step and when it is due", line: "yours", personal: { label: "the steps you add to one client", assignee: "who an onboarding step is given to", done_by: "who finished an onboarding step" }, notPersonal: ["step_key"] },
  client_step_history: { noun: "the history of onboarding steps", line: "yours", personal: { step_label: "the names of onboarding steps", detail: "what changed on an onboarding step", actor: "who changed an onboarding step" }, notPersonal: ["step_key"] },
  today_actions: { noun: "what you pressed Done, Snooze or Assign on in Today", line: "yours", personal: { actor_key: "who pressed it (a sign-in id)", actor_name: "the name of who pressed it", item_ids: "which leads, deals or appointments the row held" }, notPersonal: ["row_key", "kind", "action", "lane", "actor_role"] },
  growth_goals: { noun: "the monthly email-lead goal you set for a client", line: "yours", personal: { set_by: "the name of who set a goal" }, notPersonal: ["monthly_goal"] },
  client_departures: { noun: "when a client you served left (its name, when it was first seen and when it left)", line: "accounts", personal: {}, notPersonal: ["name", "added_at", "removed_at"] },
  growth_settings: { noun: "which addresses Today leaves out of the email lead count", line: "yours", personal: { internal_domains: "the email domains you listed as your own staff" }, notPersonal: ["exclude_role_addresses"] },
  // Workflows module: names, states, counts and times only. Never a step, a message text or a contact.
  workflow_items: { noun: "the names, states and 30 day run counts of your workflows and campaigns", line: "accounts", personal: { name: "the names of your workflows and campaigns", updated_by: "who last edited a workflow" }, notPersonal: ["kind", "status", "folder_id", "version", "ui_url"] },
  workflow_changes: { noun: "the history of changes to your workflows (made in SubSync, or noticed between two syncs)", line: "records", personal: { actor_key: "who made a change (a sign-in id)", actor_name: "the name of who made a change", before: "a workflow's name or state before a change", after: "a workflow's name or state after a change" }, notPersonal: ["kind", "source", "outcome", "op_key"] },
  campaign_stats: { noun: "delivery totals of your campaigns (sent, delivered, opened, clicked, bounced), never who received them", line: "records" },
  // Data health module: ids and counts only in the history; names are read from the contact list we already hold, never copied.
  dh_snapshots: { noun: "a daily record of each client account's data health score and what counted against it (counts only), kept so you can see your own history", line: "records" },
  dh_flags: { noun: "which contact ids had which data problem, when it was first seen and when it stopped (ids and dates only, no names)", line: "records" },
  dh_marks: { noun: "what you decided about a record with a problem: ignore, mark fixed, queue it for someone", line: "yours", personal: { owner: "who you gave a record to", note: "notes you write about a record", updated_by: "who made the decision" }, notPersonal: ["state"] },
  dh_rules: { noun: "your data health rules per client account (junk words, days without activity, phone format, alert minimum) and your choice about anonymous comparisons", line: "yours", personal: { junk_words: "the junk words you add", updated_by: "who changed a rule" }, notPersonal: ["stale_days", "phone_region", "spike_min", "benchmark_opt_out"] },
  dh_changes: { noun: "the history of phone and name fixes made from SubSync, with the value before so they can be undone for 24 hours", line: "records", personal: { before_value: "a phone number or name before a fix", after_value: "a phone number or name after a fix", actor_key: "who made a fix (a sign-in id)", actor_name: "the name of who made a fix" }, notPersonal: ["field", "outcome", "op_key"] },
  dh_outcomes: { noun: "each data health alert, when it was raised and when and how it ended, to measure how fast problems are fixed", line: "records", personal: { resolved_by: "who resolved an alert" }, notPersonal: ["title", "how", "dedupe_key"] },
  workflow_daily: { noun: "daily counts of workflows and failures", line: "records" },
  workflow_labels: { noun: "the labels, ratings and notes you give your workflows", line: "yours", personal: { labels: "labels you give a workflow", group_name: "group names you type", note: "notes you write about a workflow", owner: "who you set as the owner of a workflow", updated_by: "who last changed a label" }, notPersonal: ["decision", "rating"] },
  workflow_snapshots: { noun: "a saved copy of a workflow taken just before SubSync changes or deletes it", line: "records", personal: { name: "the name of a saved workflow", definition: "the steps of a saved workflow (kept so it can be put back)" }, notPersonal: ["reason"] },
  feedback_items: { noun: "feedback and problem reports you sent us", line: "yours", personal: { who: "who sent feedback or a problem report (a sign-in id)", message: "the feedback or problem report you typed" }, notPersonal: ["error_id"] },
  roadmap_suggestions: { noun: "roadmap suggestions you made", line: "yours", personal: { who: "who made a roadmap suggestion (a sign-in id)", title: "the title of a suggestion you made", details: "the details of a suggestion you made" } },
  settings: {
    noun: "settings", line: "sign_in",
    personal: {
      slack_webhook_url: "the Slack channel address (kept as typed, so treat it like a password)", digest_email: "the email address that receives alerts",
      brand_name: "the company name you show", brand_logo_url: "the logo address you show", detected_logo_url: "the logo address your platform sent", custom_checklist: "your own checklist steps", cold_tags: "the tags you marked as cold lists", ghl_app_domain: "the address you log in to", detected_app_domain: "the address you log in to", digest_timezone: "your time zone",
    },
    notPersonal: ["speed_keep_message_text", "app_domain_source", "keep_transcripts", "push_notes_to_crm", "cleanup_defaults", "speed_escalation"],
  },
  api_keys: {
    noun: "API keys", line: "sign_in",
    personal: { name: "the name you gave a key" }, secrets: { key_hash: "hashed" }, notPersonal: ["key_prefix"],
  },
  connections: {
    noun: "connections to other tools", line: "sign_in",
    personal: { label: "the account or channel a tool is connected as", external_id: "the id the tool uses for you", connected_by: "the name of the person who connected it" },
    secrets: { access_token_enc: "encrypted", refresh_token_enc: "encrypted", webhook_secret_enc: "encrypted" }, notPersonal: ["public_key", "token_expires_at"],
  },
  user_connections: {
    noun: "each person's connected tools", line: "sign_in",
    personal: {
      ghl_user_id: "the sign-in id of the person who connected a tool", person_name: "the name of the person who connected a tool", provider_account_email: "the email of the account a person connected",
    },
    secrets: { access_token_enc: "encrypted", refresh_token_enc: "encrypted", webhook_secret_enc: "encrypted" }, notPersonal: ["company_key", "public_key", "token_expires_at"],
  },
  meeting_policies: { noun: "the rules for meeting notes", line: "sign_in" },
  notification_prefs: {
    noun: "your notification choices", line: "sign_in",
    personal: { recipients: "the email addresses that receive notifications", copy: "the wording you chose for messages", updated_by: "the name of the person who changed them" },
    notPersonal: ["channels", "timing"],
  },
  notification_destinations: {
    noun: "your Slack channels for notifications", line: "sign_in",
    personal: { label: "the Slack workspace and channel a notification channel is connected as", connected_by: "the name of the person who connected it" },
    secrets: { webhook_url_enc: "encrypted" },
  },
  meeting_hooks: { noun: "private meeting addresses", line: "sign_in", personal: { label: "the label you gave an address" }, secrets: { token_hash: "hashed" } },

  // ---- kept after an uninstall on purpose (no contacts, messages or credentials)
  audit_log: {
    noun: "a short record of who did what and when", line: "records",
    personal: { actor: "the name of the person who did it", detail: "what changed (ids and setting names, never customer data)" },
  },
  install_plans: { noun: "plan and billing events", line: "records" },
  identity_log: { noun: "the sign-in role log", line: "records", notPersonal: ["user_type", "is_agency_owner"] },

  // ---- not tied to one company
  installations: {
    noun: "your connection to your CRM", line: "sign_in",
    personal: { company_name: "your company name", user_id: "the id of the person who installed it" },
    secrets: { access_token_enc: "encrypted", refresh_token_enc: "encrypted" }, notPersonal: ["company_id", "agency_company_id", "user_type", "token_expires_at"],
  },
  feature_flags: { noun: "feature switches", line: "records", notPersonal: ["key", "note"] },
  plan_entitlements: { noun: "plan settings", line: "records", notPersonal: ["note"] },
  webhook_events: { noun: "a list of notification ids already handled", line: "records" },
};

/** Columns that look as if they could hold personal data. A column like this must be declared above. */
export const PERSONAL_LOOKING = /(email|phone|name|address|birth|note|text|summary|transcript|attendee|snapshot|detail|title|label|website|owner|user|assigned|actor|voter|decided|token|secret|hash|payload|filters|params|before_value|after_value|domain|task|source|tags|dnd|spec|subject|body|content|key|webhook_url|recording|company|slack|channel)/i;

/** A date or time column (ending _at or _on) is never personal data by itself, whatever else its name says. */
export const looksPersonal = (column: string) => !/(_at|_on)$/.test(column) && PERSONAL_LOOKING.test(column);

/** Promises that the page makes in words: a column like this must not exist. A test checks every one against the schema. */
export const NEVER_STORED: Array<{ table: string; columns: RegExp; claim: string }> = [
  // Stage E2b: a transcript is held in memory for one delivery and written to the CRM only where the person and the account allow it. SubSync never keeps its text.
  { table: "meetings", columns: /^(transcript|transcript_text|transcript_body|transcript_content)$/i, claim: "SubSync never keeps the text of a transcript." },
  { table: "cached_contacts", columns: /(note|custom|file|attachment)/i, claim: "No notes, files or custom fields." },
  { table: "cached_conversations", columns: /(^|_)(body|text|content|html|snippet)(_|$)/i, claim: "The text of a message is never copied." },
  { table: "touch_events", columns: /(^|_)(body|text|content|html|snippet|subject)(_|$)/i, claim: "The text of a message is never copied." },
  { table: "lead_touches", columns: /(^|_)(body|text|content|html|snippet)(_|$)/i, claim: "The text of a message is never copied." },
];

type Line = { title: string; lead: string; closing?: string; tail?: string };
export const LINES: Record<LineId, Line> = {
  contacts: { title: "Contacts", lead: "", tail: ", and dates" },
  deals: { title: "Deals", lead: "" , tail: ", value, status and dates" },
  conversations: { title: "Conversations", lead: "Who wrote last, when and through which channel, plus", closing: "For new leads we also record when the lead arrived and when a person first replied, so reply speed can be measured." },
  appointments: { title: "Appointments", lead: "The time, status and", tail: ", plus a history of status changes we record from the day you install" },
  accounts: { title: "Your client accounts", lead: "", tail: ", plus a daily set of counts for each account, the alerts we raise, and sync status" },
  actions: { title: "What you did with contacts", lead: "" },
  meetings: { title: "Meeting notes (only if you connect a meeting tool)", lead: "", closing: "A meeting is private to the person who recorded it. Only a contact matched with certainty by exact email gets a note in your CRM, and only when SubSync has permission to add notes. A meeting nobody can be matched to is never saved to a guessed contact: it is only counted, or it waits in that person's private Meeting inbox for up to 14 days and is then removed. A call that was handled keeps its summary for 90 days, then only a log of ids and times remains. Everything SubSync writes to your CRM is logged, so it never counts as a reply or as activity in the numbers." },
  shares: { title: "Share links", lead: "", closing: `A link works for ${SHARE_LINK_DAYS} days and you can switch it off at any time.` },
  yours: { title: "Things you add", lead: "" },
  sign_in: { title: "Your company, settings and connections", lead: "", closing: "Access tokens are encrypted at rest. API keys are kept only as a one-way hash." },
  records: { title: "Records of what happened", lead: "", closing: "A log of changes to deals and appointments from the day you install, a short log of actions taken in the app, the role of each person who signs in (never a name or an email), and basic technical logs such as errors and sync status. Logs never contain access tokens or message text." },
};

const LINE_ORDER: LineId[] = ["contacts", "deals", "conversations", "appointments", "accounts", "actions", "meetings", "shares", "yours", "sign_in", "records"];

const joinList = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const unique = (items: string[]) => [...new Set(items)];

/** The labels of every personal column of the tables on a line, in table order, without repeats. */
export function labelsFor(line: LineId): string[] {
  const out: string[] = [];
  for (const info of Object.values(INVENTORY)) if (info.line === line) out.push(...Object.values(info.personal ?? {}));
  return unique(out);
}

export type StoreLine = { id: LineId; title: string; text: string };

/** The "What we store" list, produced from the entries above. `meetings: false` leaves out the meeting-notes line (nothing is connected). */
export function storeLines(options: { meetings?: boolean } = {}): StoreLine[] {
  const out: StoreLine[] = [];
  for (const id of LINE_ORDER) {
    if (id === "meetings" && options.meetings === false) continue;
    const line = LINES[id];
    const labels = labelsFor(id);
    const body = labels.length ? `${line.lead ? line.lead + " " : ""}${joinList(labels)}${line.tail ?? ""}.` : id === "records" ? "" : `${line.lead}${line.tail ?? ""}.`;
    const claims = unique(NEVER_STORED.filter((n) => INVENTORY[n.table]?.line === id).map((n) => n.claim));
    const text = [body, ...claims, line.closing ?? ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    out.push({ id, title: line.title, text: text.charAt(0).toUpperCase() + text.slice(1) });
  }
  return out;
}

const nouns = (tables: readonly string[]) => unique(tables.map((t) => INVENTORY[t]?.noun).filter((n): n is string => !!n));

export type Deletion = { synced: string[]; kept: string[]; uninstallExtra: string[]; remains: string[] };

/** What each button removes, read from the same lists the purge code runs. */
export function deletion(): Deletion {
  const synced = nouns(SYNCED_DELETE);
  const kept = nouns(CONFIG_DELETE_ON_UNINSTALL);
  return { synced, kept, uninstallExtra: kept, remains: nouns(KEEP_ON_UNINSTALL) };
}

export function deleteMyDataText(): string {
  const d = deletion();
  return `Permanently removes everything SubSync copied from your CRM and what you logged on top of it: ${joinList(d.synced)}. It keeps ${joinList(d.kept)}, so SubSync keeps working, and the next sync starts from scratch.`;
}

export function uninstallText(): string {
  const d = deletion();
  return `Uninstalling cuts SubSync's connection to your CRM at once and deletes everything above, together with ${joinList(d.uninstallExtra)}. We keep only ${joinList(d.remains)}, none of which holds customer contacts, messages or credentials.`;
}

/** One sentence for the help page. */
export function removalAnswer(): string {
  return `${deleteMyDataText().replace("Permanently removes", "Settings has a Delete my data button. It removes")} ${uninstallText()}`;
}
