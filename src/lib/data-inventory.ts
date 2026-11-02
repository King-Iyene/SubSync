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
  locations: {
    noun: "the list of client accounts", line: "accounts",
    personal: { name: "client account name", email: "the client business's email", phone: "the client business's phone", website: "the client business's website", address: "the client business's address", owner: "the owner label you give an account" },
    notPersonal: ["users_access"],
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
      recording_url: "a link to the recording", transcript_ref: "a reference to the full transcript at the tool that made it (the text itself is not kept unless you switch that on)",
    },
    notPersonal: ["provider_meeting_id"],
  },
  crm_writes: {
    noun: "a log of what SubSync wrote to your CRM", line: "meetings",
    personal: { authored_by: "which team member a note or comment was written as" },
  },
  shared_audits: { noun: "share links", line: "shares", personal: { payload: "a snapshot of totals, finding titles, fix steps and how each number is counted, with client names removed, plus your business name and colour" } },

  // ---- what you add, and your settings (kept by "Delete my data", removed by an uninstall)
  meeting_note_settings: {
    noun: "each person's meeting-note choices", line: "yours",
    personal: { ghl_user_id: "which team member the choices belong to" }, notPersonal: ["content_matrix", "source_priority"],
  },
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
  saved_views: { noun: "your saved views of a page", line: "yours", personal: { owner: "who saved the view (a sign-in id)", name: "the name you gave a saved view", filters: "the choices in a saved view (client account, channel, person)" }, notPersonal: ["page"] },
  roadmap_votes: { noun: "roadmap votes", line: "yours", personal: { voter: "who voted on the roadmap (a sign-in id)" }, notPersonal: ["item_key"] },
  // Stage C1 (Clients): what you write about a client, and how far each client is through onboarding.
  client_notes: { noun: "notes and conversations you log about a client", line: "yours", personal: { body: "the notes and conversations you log about a client", author: "who wrote a client note" }, notPersonal: ["kind"] },
  onboarding_templates: { noun: "onboarding checklist templates", line: "yours", personal: { name: "the names of your onboarding templates", steps: "the steps of your onboarding templates" }, notPersonal: ["industry_key"] },
  client_steps: { noun: "who is on each onboarding step and when it is due", line: "yours", personal: { label: "the steps you add to one client", assignee: "who an onboarding step is given to", done_by: "who finished an onboarding step" }, notPersonal: ["step_key"] },
  client_step_history: { noun: "the history of onboarding steps", line: "yours", personal: { step_label: "the names of onboarding steps", detail: "what changed on an onboarding step", actor: "who changed an onboarding step" }, notPersonal: ["step_key"] },
  feedback_items: { noun: "feedback and problem reports you sent us", line: "yours", personal: { who: "who sent feedback or a problem report (a sign-in id)", message: "the feedback or problem report you typed" }, notPersonal: ["error_id"] },
  roadmap_suggestions: { noun: "roadmap suggestions you made", line: "yours", personal: { who: "who made a roadmap suggestion (a sign-in id)", title: "the title of a suggestion you made", details: "the details of a suggestion you made" } },
  settings: {
    noun: "settings", line: "sign_in",
    personal: {
      slack_webhook_url: "the Slack channel address (kept as typed, so treat it like a password)", digest_email: "the email address that receives alerts",
      brand_name: "the company name you show", custom_checklist: "your own checklist steps", cold_tags: "the tags you marked as cold lists", ghl_app_domain: "the address you log in to", detected_app_domain: "the address you log in to", digest_timezone: "your time zone",
    },
    notPersonal: ["app_domain_source", "keep_transcripts", "push_notes_to_crm"],
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
  { table: "cached_contacts", columns: /(note|custom|file|attachment)/i, claim: "No notes, files or custom fields." },
  { table: "cached_conversations", columns: /(^|_)(body|text|content|html|snippet)(_|$)/i, claim: "The text of a message is never copied." },
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
  meetings: { title: "Meeting notes (only if you connect a meeting tool)", lead: "", closing: "A meeting is private to the person who recorded it. Only a contact matched with certainty by exact email gets a note in your CRM, and only when SubSync has permission to add notes. A meeting nobody can be matched to is never saved to a guessed contact: it is only counted, or it waits in that person's private Meeting inbox for up to 14 days and is then removed. Everything SubSync writes to your CRM is logged, so it never counts as a reply or as activity in the numbers." },
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
