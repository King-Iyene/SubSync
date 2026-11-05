-- SubSync: paste this WHOLE file into the Supabase SQL Editor and press Run, once.
-- It adds the new migrations, up to and including the Growth tab (20261106110000). Every statement is safe to run twice.
-- It runs as ONE transaction: if anything fails, nothing changes.
begin;

-- ===== 20261101010000_detected_app_domain.sql =====
-- Additive: remember the login domain a company's sign-in or install event showed us, separately from the one typed in Settings.
-- The typed one is an override that wins, but it can now be taken off again because the detected one is still here.
-- Nothing is changed or removed; the old code simply does not read this column.
alter table public.settings add column if not exists detected_app_domain text;

-- ===== 20261101020000_meeting_default_account_retired.sql =====
-- N93 (stage S0.2b): the setting "if nobody in a meeting is a known contact, save it in [client account]" is gone. The app no longer reads or
-- writes connections.default_location_id, so any stored value would be a leftover that looks like a promise. Set every one to empty, which
-- means "do not save it, just count it". The column itself stays (additive only; nothing is dropped). Idempotent: running it again changes no row.
-- Applied by hand after saving the table to backups/ and recording row counts (docs/features/S0.2b.md).
update public.connections set default_location_id = null where default_location_id is not null;

-- ===== 20261101030000_f1_numbers_truth.sql =====
-- Stage F1 (numbers truth). Additive only: one new table and three new columns. Nothing is changed, renamed or removed, and the old code
-- simply does not read them, so the previous release keeps working against this database.

-- N37 and N38: how the owner classifies pipelines and stages, and the win probability the owner assumes for a stage.
-- Keyed by the pipeline and stage NAME (lower case, trimmed), so the same pipeline cloned into many client accounts is one row.
--   stage_key = ''  : a row about the pipeline itself (class in_use or not_in_use)
--   stage_key <> '' : a row about one stage (class active, closed_out or ignore; win_probability 0 to 100, the owner's own assumption)
-- No rule row means "use the suggestion made from the name"; the screen says which is in force.
create table if not exists public.stage_rules (
  installation_id uuid not null references public.installations (id) on delete cascade,
  pipeline_key text not null,
  stage_key text not null default '',
  class text check (class in ('active', 'closed_out', 'ignore', 'in_use', 'not_in_use')),
  win_probability smallint check (win_probability between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (installation_id, pipeline_key, stage_key)
);
alter table public.stage_rules enable row level security;

-- N39: which counting rule a day's snapshot was written under, so a change of definition is never drawn as a trend.
-- Null means "written before this column existed"; the code reads such rows by date (docs/METRICS.md, "Definition versions").
alter table public.account_metrics_daily add column if not exists definition_version integer;

-- N45: the tags the owner marked as cold lists (bought or scraped contacts). Null means "not chosen yet", so the suggestion from the tag names applies.
alter table public.settings add column if not exists cold_tags text[];

-- N39: counts every change to the stage rules, so changing a rule starts a new definition version for the history charts.
alter table public.settings add column if not exists deal_rules_revision integer not null default 0;

-- ===== 20261102030000_speed_f2.sql =====
-- F2 Speed to lead, delta. Additive and idempotent: nothing here changes or removes existing data, and the previous code keeps working against it.
--
-- auto_touch_at: when the first AUTOMATIC outbound message (a workflow, a campaign, the API, a call with nobody attached) went out.
-- human_touch_at: when a PERSON first replied. Both are kept whatever the account's "count automatic messages" setting says, so the screen can show
--   the automatic first touch apart from the person's reply (N78). touch_at keeps its meaning (the touch the setting counts).
-- read_version: 0 for rows read before these columns existed. The speed sync re-reads such a lead once (newest first, 100 per run) and sets 1 (read in full)
--   or 2 (the conversation is longer than one page, so its first messages were not seen and the row is not used for the automatic-versus-person view).
--   Old rows fill in by themselves and nothing is guessed in the meantime.
alter table public.lead_touches add column if not exists auto_touch_at timestamptz;
alter table public.lead_touches add column if not exists human_touch_at timestamptz;
alter table public.lead_touches add column if not exists read_version smallint not null default 0;

-- The team list read from the CRM (users permission): the picture address that comes with each person, and when the person was last seen in the list.
alter table public.team_names add column if not exists photo_url text;
alter table public.team_names add column if not exists seen_at timestamptz;

-- ===== 20261102040000_f3_appointments.sql =====
-- F3: who booked an appointment and how, and the account's own show-rate target. Additive and idempotent. Nothing here changes or removes existing data.
-- The platform's event may or may not say who booked it; both columns stay empty when it does not (the screen says "not recorded").

alter table public.cached_appointments add column if not exists booked_by_user text;
alter table public.cached_appointments add column if not exists booking_channel text;

-- null means the default target (75%). Changed by an owner on the Appointments page.
alter table public.settings add column if not exists appointment_show_rate_target integer;

-- ===== 20261102060000_f4_saved_views.sql =====
-- Stage F4 (Unanswered messages). Additive only: one new table, nothing existing is changed, renamed or removed, and the previous release simply
-- does not read it, so the old code keeps working against this database.
--
-- Saved views: a person's own named choices on a page (for example "Over a day, WhatsApp, mine"), kept per person.
--   owner    who saved it: the same key the roadmap votes use (kind, account, sign-in id), so a person sees only their own views
--   page     which page the view belongs to ('inbox' today)
--   filters  the choices as small JSON (tab, wait chip, channel, client account id, person, sort). No customer data is stored in it.
create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  owner text not null,
  page text not null default 'inbox',
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists saved_views_owner_name_idx on public.saved_views (installation_id, owner, page, name);
alter table public.saved_views enable row level security;

-- ===== 20261102070000_user_connections.sql =====
-- Stage E0 (connections framework, per user). Additive and idempotent: five NEW tables, nothing existing is changed.
-- Row level security is on for every table and NO policy is created, so the public (anon) and signed-in (authenticated) database roles read
-- and write nothing. Only server code, which connects with the database owner role, can use these tables. The same roles also lose their
-- table privileges, so a future policy added by mistake would still not open them.
--
-- A personal tool (Fathom, and later Zoom and Google Meet) belongs to the PERSON who connected it: one row per (CRM user id, provider).
-- Tokens are encrypted by the app before they are saved (columns ending _enc) and no query that feeds a screen selects them.

create table if not exists public.user_connections (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  -- The sign-in key of the company or business the person belongs to (the same key sessions carry).
  company_key text not null,
  ghl_user_id text not null,
  person_name text,
  -- The client account the person had open when they connected (empty for company staff, who work across accounts).
  home_location_id text,
  -- The role sign-in worked out for the person when they connected (owner, administrator, staff...). A webhook has no signed-in user, so it needs this to know
  -- which client accounts the person may reach. It is rechecked whenever they sign in again.
  person_role text,
  provider text not null check (provider in ('fathom', 'zoom', 'google_meet')),
  provider_account_email text,
  scopes_granted text,
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  webhook_id text,
  webhook_secret_enc text,
  public_key text unique,
  status text not null default 'pending' check (status in ('pending', 'connected', 'needs_reconnect', 'revoked', 'error')),
  pending_since timestamptz,
  last_ok_at timestamptz,
  last_error_code text,
  last_event_at timestamptz,
  saved_count integer not null default 0,
  skipped_count integer not null default 0,
  revoked_by text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists user_connections_person_provider_idx on public.user_connections (ghl_user_id, provider);
create index if not exists user_connections_installation_idx on public.user_connections (installation_id);

-- What each person chose to save and where (inside what the admin allows).
create table if not exists public.meeting_note_settings (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  ghl_user_id text not null,
  content_matrix jsonb not null default '{}',
  preset text not null default 'recommended' check (preset in ('recommended', 'full_record', 'summary_only', 'custom')),
  unmatched_mode text not null default 'inbox' check (unmatched_mode in ('inbox', 'discard')),
  source_priority jsonb not null default '["fathom","zoom","google_meet"]',
  preview_confirmed_at timestamptz,
  master_switch boolean not null default true,
  updated_at timestamptz not null default now()
);
create unique index if not exists meeting_note_settings_person_idx on public.meeting_note_settings (ghl_user_id);
create index if not exists meeting_note_settings_installation_idx on public.meeting_note_settings (installation_id);

-- Limits, not choices: the company default and each client account's own rule. The most restrictive of company, account and person wins.
create table if not exists public.meeting_policies (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  scope text not null check (scope in ('agency', 'account')),
  location_id text,
  flags jsonb not null default '{}',
  set_by text,
  set_at timestamptz not null default now(),
  check ((scope = 'agency' and location_id is null) or (scope = 'account' and location_id is not null))
);
create unique index if not exists meeting_policies_scope_idx on public.meeting_policies (installation_id, scope, coalesce(location_id, ''));

-- A meeting that arrived through one person's tool. Private to that person. One row per (person, provider, provider meeting id).
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  owner_ghl_user_id text not null,
  connection_id uuid references public.user_connections (id) on delete set null,
  provider text not null check (provider in ('fathom', 'zoom', 'google_meet')),
  provider_meeting_id text not null,
  started_at timestamptz,
  title text,
  attendee_emails jsonb not null default '[]',
  summary text,
  action_items jsonb not null default '[]',
  recording_url text,
  transcript_ref text,
  status text not null default 'needs_contact' check (status in ('saved', 'needs_contact', 'duplicate', 'skipped', 'failed', 'dry_run')),
  reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists meetings_one_per_person_idx on public.meetings (owner_ghl_user_id, provider, provider_meeting_id);
create index if not exists meetings_installation_idx on public.meetings (installation_id, owner_ghl_user_id);
create index if not exists meetings_expiry_idx on public.meetings (expires_at) where expires_at is not null;

-- Everything SubSync itself wrote into the CRM, with the id the CRM gave it. Used to keep our own writes out of our own numbers
-- (a note or an internal comment must never count as a reply, as activity or as engagement) and to drop the echo of our own write.
create table if not exists public.crm_writes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  meeting_id uuid references public.meetings (id) on delete set null,
  location_id text not null,
  contact_id text not null,
  kind text not null check (kind in ('note', 'comment', 'field')),
  ghl_id text,
  part_no integer not null default 1,
  authored_by text,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);
create unique index if not exists crm_writes_one_per_part_idx on public.crm_writes (meeting_id, contact_id, kind, part_no);
create index if not exists crm_writes_echo_idx on public.crm_writes (installation_id, ghl_id) where ghl_id is not null;
create index if not exists crm_writes_contact_idx on public.crm_writes (installation_id, location_id, contact_id, created_at);

alter table public.user_connections enable row level security;
alter table public.meeting_note_settings enable row level security;
alter table public.meeting_policies enable row level security;
alter table public.meetings enable row level security;
alter table public.crm_writes enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.user_connections, public.meeting_note_settings, public.meeting_policies, public.meetings, public.crm_writes from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.user_connections, public.meeting_note_settings, public.meeting_policies, public.meetings, public.crm_writes from authenticated;
  end if;
end $$;

-- ===== 20261102090000_f8_feedback.sql =====
-- Stage F8 (Settings, Getting started, roadmap, trust). Additive only: two new tables, nothing existing is changed, renamed or removed, and the previous
-- release simply does not read them, so the old code keeps working against this database. Idempotent.
--
-- feedback_items: "Give feedback" (kind 'feedback') and "Report a problem" (kind 'problem'), stored and never sent anywhere (the alert to King is a dry-run
--   audit line written by the app, see src/lib/feedback.ts).
--   who          the person's key (kind, account, sign-in id), made on the server from the verified session
--   role         the kind of session (agency, business or client), so King can see who is asking
--   location_id  a client's or business's own account, when the session is limited to one
--   page         the menu page they were on (a short id, never free text)
--   message      what they typed (personal free text: it is listed in "What we store")
--   error_id     the error ID shown on the screen, for a problem report
--   status       new, seen or done: set by King's admin view
-- roadmap_suggestions: "Suggest something" on the What's new page. Visible only to the person's own company and to King's admin view.
create table if not exists public.feedback_items (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  kind text not null check (kind in ('feedback', 'problem')),
  who text not null,
  role text,
  location_id text,
  page text,
  severity text,
  message text not null,
  error_id text,
  status text not null default 'new' check (status in ('new', 'seen', 'done')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_items_installation_idx on public.feedback_items (installation_id, created_at desc);
create index if not exists feedback_items_who_idx on public.feedback_items (installation_id, who, created_at desc);
alter table public.feedback_items enable row level security;

create table if not exists public.roadmap_suggestions (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  who text not null,
  role text,
  title text not null,
  details text,
  importance text not null default 'nice' check (importance in ('nice', 'important', 'critical')),
  page text,
  status text not null default 'new' check (status in ('new', 'planned', 'building', 'shipped', 'declined')),
  created_at timestamptz not null default now()
);
create index if not exists roadmap_suggestions_installation_idx on public.roadmap_suggestions (installation_id, created_at desc);
alter table public.roadmap_suggestions enable row level security;

-- ===== 20261102100000_f10_people.sql =====
-- Stage F10 (People and Call lists). Additive only: one new table and one new index; nothing existing is changed, renamed or removed, and the previous
-- release simply does not read them, so the old code keeps working against this database.
--
-- contact_tag_events: the platform does not say WHEN a tag was added to a contact, so SubSync records each tag it sees added or removed at a sync
--   ("since SubSync started watching"). `at` is the moment SubSync noticed, not the moment the person tagged the contact.
--   It holds ids and tag names only (the tag names are already part of cached_contacts.tags). Removed with the rest of a client account's data.
create table if not exists public.contact_tag_events (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  tag text not null,
  kind text not null check (kind in ('added', 'removed')),
  at timestamptz not null default now()
);
create index if not exists contact_tag_events_tag_idx on public.contact_tag_events (installation_id, tag, at desc);
create index if not exists contact_tag_events_contact_idx on public.contact_tag_events (installation_id, location_id, contact_id, at desc);
alter table public.contact_tag_events enable row level security;

-- Filtering a large account by tag read every contact; a GIN index lets "has this tag" use the index.
create index if not exists cached_contacts_tags_gin on public.cached_contacts using gin (tags);

-- ===== 20261102110000_c1_clients.sql =====
-- Stage C1 (Clients). Additive only: four new tables, nothing existing is changed, renamed or removed, and the previous release simply does not read them,
-- so the old code keeps working against this database. Every table carries installation_id (cascade on uninstall) and is classified in
-- src/lib/tenant-tables.ts and src/lib/data-inventory.ts.
--
-- client_notes          the log of conversations and notes about a client: what was said or decided, who wrote it, and when it happened.
-- onboarding_templates  a checklist template the agency writes for a kind of client (an industry), with its steps as small JSON.
-- client_steps          the state of ONE onboarding step for ONE client: who is on it, when it is due, who finished it and when. Also holds the extra steps
--                       the agency adds to a single client (is_custom, with its own label). The automatic checks are never stored; they are worked out each time.
-- client_step_history   what happened to a step (finished, reopened, handed to someone, new due date, added, removed), with who and when.

create table if not exists public.client_notes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  kind text not null default 'note' check (kind in ('conversation', 'note', 'decision')),
  body text not null,
  author text,
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists client_notes_location_idx on public.client_notes (installation_id, location_id, occurred_on desc, created_at desc);

create table if not exists public.onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  name text not null,
  industry_key text,
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists onboarding_templates_name_idx on public.onboarding_templates (installation_id, name);

create table if not exists public.client_steps (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  step_key text not null,
  is_custom boolean not null default false,
  label text,
  assignee text,
  due_on date,
  done_at timestamptz,
  done_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists client_steps_step_idx on public.client_steps (installation_id, location_id, step_key);

create table if not exists public.client_step_history (
  id bigserial primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  step_key text not null,
  step_label text,
  event text not null check (event in ('done', 'reopened', 'assigned', 'due', 'added', 'removed')),
  detail text,
  actor text,
  at timestamptz not null default now()
);
create index if not exists client_step_history_location_idx on public.client_step_history (installation_id, location_id, at desc);

alter table public.client_notes enable row level security;
alter table public.onboarding_templates enable row level security;
alter table public.client_steps enable row level security;
alter table public.client_step_history enable row level security;
revoke all on public.client_notes from anon, authenticated;
revoke all on public.onboarding_templates from anon, authenticated;
revoke all on public.client_steps from anon, authenticated;
revoke all on public.client_step_history from anon, authenticated;

-- ===== 20261102120000_f9_notifications.sql =====
-- Stage F9 (alerts, Slack, in-app notifications, email). Additive and idempotent: five NEW tables, nothing existing is changed.
-- Row level security is on for every table and NO policy is created, so the public (anon) and signed-in (authenticated) database roles read and
-- write nothing. Only server code, which connects with the database owner role, can use them. The same roles also lose their table privileges.
--
--   notification_prefs         what each company chose for each kind of message: channels, recipients, time, quiet hours, wording
--   notification_destinations  Slack channels (one row per channel a person authorised); the channel address is encrypted by the app
--   notifications              the in-app notification centre (the bell): one row per item, the words a person reads
--   notification_states        who has read, dismissed or snoozed which item (per signed-in person)
--   notification_deliveries    the dispatcher's ledger: one row per message to one place, so nothing is sent twice and a failed send is retried

create table if not exists public.notification_prefs (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  type text not null,
  enabled boolean not null default true,
  channels jsonb not null default '{}',
  recipients jsonb not null default '[]',
  timing jsonb not null default '{}',
  copy jsonb not null default '{}',
  updated_by text,
  updated_at timestamptz not null default now()
);
create unique index if not exists notification_prefs_type_idx on public.notification_prefs (installation_id, type);

create table if not exists public.notification_destinations (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  provider text not null default 'slack',
  label text,
  -- Empty means the whole company (cross-account messages). A client account id means ONLY that account's messages, so one client's Slack never
  -- receives another client's data.
  location_id text,
  webhook_url_enc text,
  status text not null default 'pending',
  pending_since timestamptz,
  last_ok_at timestamptz,
  last_error_code text,
  connected_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notification_destinations_installation_idx on public.notification_destinations (installation_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text,
  type text not null,
  severity text not null default 'info',
  title text not null,
  body text,
  link jsonb not null default '{}',
  alert_id uuid,
  dedupe_key text,
  created_at timestamptz not null default now()
);
create unique index if not exists notifications_dedupe_idx on public.notifications (installation_id, dedupe_key) where dedupe_key is not null;
create index if not exists notifications_recent_idx on public.notifications (installation_id, created_at desc);

create table if not exists public.notification_states (
  notification_id uuid not null,
  user_key text not null,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text,
  read_at timestamptz,
  dismissed_at timestamptz,
  snoozed_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (notification_id, user_key)
);
create index if not exists notification_states_installation_idx on public.notification_states (installation_id);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text,
  type text not null,
  channel text not null,
  target text not null,
  dedupe_key text not null,
  severity text not null default 'info',
  status text not null default 'pending',
  reason text,
  payload jsonb not null default '{}',
  alert_id uuid,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index if not exists notification_deliveries_once_idx on public.notification_deliveries (installation_id, dedupe_key, channel, target);
create index if not exists notification_deliveries_work_idx on public.notification_deliveries (installation_id, status, next_attempt_at);

alter table public.notification_prefs enable row level security;
alter table public.notification_destinations enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_states enable row level security;
alter table public.notification_deliveries enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.notification_prefs, public.notification_destinations, public.notifications, public.notification_states, public.notification_deliveries from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.notification_prefs, public.notification_destinations, public.notifications, public.notification_states, public.notification_deliveries from authenticated;
  end if;
end $$;

-- ===== 20261102130000_e2a_fathom_inbox.sql =====
-- Stage E2a (Fathom per user, end to end). Additive and idempotent: two NEW tables, nothing existing is changed.
-- Row level security is on for both and NO policy is created, so the public (anon) and signed-in (authenticated) database roles read and write
-- nothing; those roles also lose their table privileges. Only server code, which connects with the database owner role, can use them.

-- One row per Fathom delivery that was accepted, so the same delivery (Fathom retries a delivery that was not acknowledged in time) is handled once.
-- It holds ids only, never any of the call. Rows older than 30 days are removed by the expiry job.
create table if not exists public.meeting_deliveries (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  connection_id uuid not null references public.user_connections (id) on delete cascade,
  webhook_id text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists meeting_deliveries_one_idx on public.meeting_deliveries (connection_id, webhook_id);
create index if not exists meeting_deliveries_age_idx on public.meeting_deliveries (created_at);
create index if not exists meeting_deliveries_installation_idx on public.meeting_deliveries (installation_id);

-- The email addresses one person told SubSync to "always ignore" in their Meeting inbox (a vendor, a family member). Private to that person.
create table if not exists public.meeting_ignored_emails (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  ghl_user_id text not null,
  email text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists meeting_ignored_emails_one_idx on public.meeting_ignored_emails (ghl_user_id, email);
create index if not exists meeting_ignored_emails_installation_idx on public.meeting_ignored_emails (installation_id);

alter table public.meeting_deliveries enable row level security;
alter table public.meeting_ignored_emails enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.meeting_deliveries, public.meeting_ignored_emails from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.meeting_deliveries, public.meeting_ignored_emails from authenticated;
  end if;
end $$;

-- ===== 20261103090000_e2b_setup.sql =====
-- Stage E2b (save destinations and content options). Additive and idempotent: two NEW tables and two NEW columns, nothing existing is changed or removed.
-- Row level security is on for both new tables and NO policy is created, so the public (anon) and signed-in (authenticated) database roles read and write
-- nothing; those roles also lose their table privileges. Only server code, which connects with the database owner role, can use them.
-- No check constraint on the item and type columns on purpose: the code validates them, and a later field can then be added without a migration.

-- Which of a client account's own contact fields the admin chose for each thing SubSync can fill (spec 8.1). Nothing is mapped until an admin does it.
create table if not exists public.field_mappings (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  item text not null,
  ghl_custom_field_id text not null,
  field_name text not null,
  field_type text not null default 'text',
  enabled boolean not null default true,
  set_by text,
  set_at timestamptz not null default now()
);
create unique index if not exists field_mappings_one_idx on public.field_mappings (installation_id, location_id, item);
create index if not exists field_mappings_installation_idx on public.field_mappings (installation_id);

-- Which meeting last filled each contact field, so an older meeting never overwrites a newer value (spec 8.1 ordering rule). Ids and times only, never a value.
create table if not exists public.field_write_state (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  item text not null,
  meeting_started_at timestamptz not null,
  meeting_id uuid references public.meetings (id) on delete set null,
  written_at timestamptz not null default now()
);
create unique index if not exists field_write_state_one_idx on public.field_write_state (installation_id, location_id, contact_id, item);
create index if not exists field_write_state_installation_idx on public.field_write_state (installation_id);

-- A person's own text layout (used with the Custom layout) and whether they ever picked a layout themselves (a person who never did gets the account's default).
alter table public.meeting_note_settings add column if not exists custom_template text;
alter table public.meeting_note_settings add column if not exists preset_chosen boolean not null default false;

alter table public.field_mappings enable row level security;
alter table public.field_write_state enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.field_mappings, public.field_write_state from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.field_mappings, public.field_write_state from authenticated;
  end if;
end $$;

-- ===== 20261103100000_nc_brand_logo.sql =====
-- Additive: the agency logo web address. `detected_logo_url` comes from the install event and sign-in (white-label details);
-- `brand_logo_url` is the owner's own address from Settings and wins. Both are https only (checked in code); the server never fetches them.
alter table public.settings add column if not exists detected_logo_url text;
alter table public.settings add column if not exists brand_logo_url text;

-- ===== 20261104090000_today_actions.sql =====
-- Additive: the Today working queue. Every press of Done, Snooze, Assign to me or Undo on a Fix first row is one row here, with who did it and when.
-- The table is append-only: nothing is edited, a person's Undo is a new row that points at the one it cancels. It lives only in SubSync, never in the CRM,
-- and is left out of every metric (what SubSync writes must never change what SubSync measures). Safe to run twice.

create table if not exists public.today_actions (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  row_key text not null,
  kind text not null,
  -- action is done, snooze, assign or undo; the server is the only writer and checks it
  action text not null,
  -- 'team' for an agency or a business administrator (the team shares one queue), 'user:<id>' for a client's staff (their own queue only).
  lane text not null,
  actor_key text not null,
  actor_name text,
  actor_role text,
  until_at timestamptz,
  undoes bigint,
  item_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists today_actions_lookup_idx on public.today_actions (installation_id, location_id, created_at desc);
create index if not exists today_actions_row_idx on public.today_actions (installation_id, row_key, created_at desc);
alter table public.today_actions enable row level security;

-- ===== 20261104120000_workflows.sql =====
-- Additive: the Workflows module. Four tables, all SubSync's own. Nothing here is ever sent to the CRM except through the guarded write path
-- (WORKFLOWS_WRITE_LIVE, optional permissions, preview and confirm). Safe to run twice.

-- One row per workflow per client account, refreshed by the sync. Only names, states, counts and times: never a step, a message text or a contact.
create table if not exists public.workflow_items (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  workflow_id text not null,
  name text not null,
  status text not null default 'other',
  kind text,
  folder_id text,
  version text,
  ui_url text,
  remote_created_at timestamptz,
  remote_updated_at timestamptz,
  updated_by text,
  -- log counts of the last 30 days; null means the logs permission was not available, so the number is not known (never zero by guess)
  runs_30d integer,
  enrolled_30d integer,
  failed_30d integer,
  last_run_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_seen_at timestamptz,
  primary key (installation_id, location_id, workflow_id)
);
create index if not exists workflow_items_seen_idx on public.workflow_items (installation_id, last_seen_at desc);

-- Append-only record of what happened to a workflow: what SubSync did (source subsync) and what it noticed between two syncs (source observed).
-- Also the event store for this module: alerts raised and writes are counted from here. op_key makes a confirmed write idempotent.
create table if not exists public.workflow_changes (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  workflow_id text not null,
  kind text not null,
  source text not null default 'observed',
  actor_key text,
  actor_name text,
  before jsonb,
  after jsonb,
  outcome text not null default 'done',
  undoes bigint,
  op_key text,
  created_at timestamptz not null default now()
);
create index if not exists workflow_changes_feed_idx on public.workflow_changes (installation_id, created_at desc);
create unique index if not exists workflow_changes_op_idx on public.workflow_changes (installation_id, op_key) where op_key is not null;

-- SubSync-side organisation: labels, group, rating, keep/review/retire, notes, owner. Lives only here, never written to the CRM.
create table if not exists public.workflow_labels (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  workflow_id text not null,
  labels text[] not null default '{}',
  group_name text,
  rating smallint check (rating between 1 and 5),
  decision text check (decision in ('keep', 'review', 'retire')),
  note text,
  owner text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id, workflow_id)
);

-- The working queue (Done, Snooze, watch) lives on the same row, SubSync only.
alter table public.workflow_labels add column if not exists fixed_at timestamptz;
alter table public.workflow_labels add column if not exists snoozed_until timestamptz;
alter table public.workflow_labels add column if not exists watch boolean not null default false;

-- A copy of a workflow's definition taken just before SubSync changes or deletes it, so it can be put back or recreated.
create table if not exists public.workflow_snapshots (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  workflow_id text not null,
  name text not null,
  reason text not null,
  definition jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists workflow_snapshots_idx on public.workflow_snapshots (installation_id, workflow_id, created_at desc);

-- Our own daily history of the module (how many, how many failing, runs and errors of the last 30 days as counted that day), so a trend exists.
create table if not exists public.workflow_daily (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  day date not null,
  total integer not null default 0,
  failing integer not null default 0,
  runs_30d integer,
  errors_30d integer,
  primary key (installation_id, location_id, day)
);

-- Delivery totals of each campaign, one row per day it was read, so a campaign can be compared with the same account's own earlier ones. Totals only: the platform
-- gives no list of the people behind each number, so none is stored. A figure the platform did not send stays null.
create table if not exists public.campaign_stats (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  campaign_id text not null,
  day date not null,
  sent integer, delivered integer, opened integer, clicked integer, bounced integer, failed integer, unsubscribed integer, queued integer,
  primary key (installation_id, location_id, campaign_id, day)
);
alter table public.campaign_stats enable row level security;
alter table public.workflow_daily enable row level security;
alter table public.workflow_items enable row level security;
alter table public.workflow_changes enable row level security;
alter table public.workflow_labels enable row level security;
alter table public.workflow_snapshots enable row level security;


-- ===== 20261106100000_data_health.sql =====
-- Additive: the Data health module. All SubSync's own tables; nothing here is sent to the CRM except through the guarded fix path
-- (optional contacts.write permission, DATA_HEALTH_WRITE_LIVE, preview, signed confirm, daily cap, 24 hour undo). Safe to run twice.

-- One row per client account per day: the score and every component. Kept for the life of the install (deleted only by the uninstall purge).
create table if not exists public.dh_snapshots (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  day date not null,
  score integer,
  total integer not null default 0,
  components jsonb not null default '[]'::jsonb,
  bucket text,
  taken_at timestamptz not null default now(),
  primary key (installation_id, location_id, day)
);
create index if not exists dh_snapshots_bucket_idx on public.dh_snapshots (bucket, day desc);

-- Every flagged record (id only, never a name) with when it was first seen and when it stopped being flagged.
create table if not exists public.dh_flags (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  rule text not null,
  first_seen_day date not null,
  last_seen_day date not null,
  fixed_at timestamptz,
  primary key (installation_id, location_id, contact_id, rule)
);
create index if not exists dh_flags_open_idx on public.dh_flags (installation_id, location_id, rule) where fixed_at is null;

-- What people decided in SubSync about a record: ignore it, mark it fixed, put it in a queue with an owner and a note. Never written to the CRM.
create table if not exists public.dh_marks (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  state text not null default 'todo',
  owner text,
  note text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id, contact_id)
);

-- Saved rules per account ('*' means every account): junk words, stale days, phone region, alert minimum, benchmark opt-out.
create table if not exists public.dh_rules (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null default '*',
  junk_words text[] not null default '{}',
  stale_days integer,
  phone_region text,
  spike_min integer,
  benchmark_opt_out boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id)
);

-- Safe fixes: the value before and after, so the 24 hour undo can put the old one back. op_key makes a confirm press idempotent.
create table if not exists public.dh_changes (
  id bigserial primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  field text not null,
  before_value text,
  after_value text,
  outcome text not null default 'done',
  actor_key text,
  actor_name text,
  op_key text not null,
  undoes bigint,
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  unique (installation_id, op_key)
);
create index if not exists dh_changes_recent_idx on public.dh_changes (installation_id, location_id, created_at desc);

-- Proof loop: every data health alert, when it was raised and when and how it ended.
create table if not exists public.dh_outcomes (
  id bigserial primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text,
  dedupe_key text not null,
  title text not null,
  raised_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  how text,
  unique (installation_id, dedupe_key)
);

alter table public.dh_snapshots enable row level security;
alter table public.dh_flags enable row level security;
alter table public.dh_marks enable row level security;
alter table public.dh_rules enable row level security;
alter table public.dh_changes enable row level security;
alter table public.dh_outcomes enable row level security;
revoke all on public.dh_snapshots, public.dh_flags, public.dh_marks, public.dh_rules, public.dh_changes, public.dh_outcomes from anon, authenticated;

-- ===== 20261105100000_duplicate_snoozes.sql =====
-- Additive and idempotent: "Not now" on a group of likely duplicates (stage DUP).
-- A group the person set aside leaves the open list until `until`, then comes back. A person's decision "not a duplicate" or
-- "merged in the CRM" already lives in duplicate_reviews; nothing there changes. This table holds ids and a date only (no contact detail).
create table if not exists public.duplicate_snoozes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  group_key text not null,
  until timestamptz not null,
  decided_by text,
  created_at timestamptz not null default now(),
  unique (installation_id, location_id, group_key)
);
create index if not exists duplicate_snoozes_installation_idx on public.duplicate_snoozes (installation_id, until);
alter table public.duplicate_snoozes enable row level security;

-- ===== 20261105110000_speed_account_target.sql =====
-- Speed to lead (stage SPEED): each client account may have its OWN reply target in minutes, typed by a person on the Speed to lead screen.
-- Additive and idempotent: one new nullable column. Null means "use the default target in Settings", which is what every existing account does.
-- The old code never reads it; the new code works without it (an account without the column simply uses the default target).
alter table public.locations add column if not exists speed_target_minutes integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'locations_speed_target_minutes_range') then
    alter table public.locations add constraint locations_speed_target_minutes_range check (speed_target_minutes is null or (speed_target_minutes between 1 and 1440));
  end if;
end $$;

-- ===== 20261105120000_cleanup_v2.sql =====
-- Clean-up module, version 2 (stage CLEANUP). Additive and idempotent: three new nullable or defaulted columns and one new table. Nothing is dropped, renamed or tightened;
-- the old code never reads any of it, and the new code works without it (an account without a saved choice uses the Balanced rules, nobody has write access switched on,
-- and a missing snapshot table simply means "no history yet").
--
-- locations.cleanup_rules         the duplicate-matching and "which value wins" choices for ONE client account (typed by a person on the Clean-up page). Null = use the company default.
-- locations.cleanup_write_enabled the per-account opt-in for changing contacts from SubSync. Off by default; a person switches it on in Settings. Even then nothing is sent
--                                 while the server's master switch (WRITE_GHL_LIVE) is off.
-- settings.cleanup_defaults       the same choices for the whole company (portfolio-wide rules); an account's own choice overrides it.
-- cleanup_quality_snapshots       one row per client account per day: the data-quality score and its parts, so a trend can be shown from SubSync's own record. Counts and ids only.
alter table public.locations add column if not exists cleanup_rules jsonb;
alter table public.locations add column if not exists cleanup_write_enabled boolean not null default false;
alter table public.settings add column if not exists cleanup_defaults jsonb;

create table if not exists public.cleanup_quality_snapshots (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  day date not null,
  contacts integer not null default 0,
  score integer,
  parts jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  duplicate_groups integer not null default 0,
  duplicate_extra integer not null default 0,
  new_groups integer not null default 0,
  created_at timestamptz not null default now(),
  unique (installation_id, location_id, day)
);
create index if not exists cleanup_quality_snapshots_installation_idx on public.cleanup_quality_snapshots (installation_id, day desc);
alter table public.cleanup_quality_snapshots enable row level security;

-- possible_duplicates: a contact that arrived (contact-created webhook) and looks like one the account already has. Ids, a score, a tier and short reasons only (no contact detail).
-- The Duplicates tab shows them as "Possible duplicate of X" cards and the daily alert counts them; a person dismisses one with a click.
create table if not exists public.possible_duplicates (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  other_contact_id text not null,
  score integer not null,
  tier text not null,
  reasons jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (status in ('new', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (installation_id, location_id, contact_id, other_contact_id)
);
create index if not exists possible_duplicates_installation_idx on public.possible_duplicates (installation_id, status, created_at desc);
alter table public.possible_duplicates enable row level security;

-- ===== 20261106110000_growth.sql =====
-- Additive: Today's Growth tab. Two small tables that belong to SubSync (nothing here is ever sent to the CRM, and neither is read by any other module).
--   growth_goals     one monthly email-lead goal per client account
--   growth_settings  one row per company: leave out role addresses (info@, sales@) and which email domains are the company's own staff
-- If this has not been applied yet, Today answers "needs the latest database update" for these two things and everything else works. Safe to run twice.

create table if not exists public.growth_goals (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  monthly_goal integer not null, -- 1 to 1,000,000, checked by the server
  set_by text,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id)
);
alter table public.growth_goals enable row level security;

create table if not exists public.growth_settings (
  installation_id uuid primary key references public.installations (id) on delete cascade,
  exclude_role_addresses boolean not null default true,
  internal_domains text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.growth_settings enable row level security;

-- ===== 20261107090000_contact_writes.sql =====
-- Additive: what SubSync writes to a lead in the CRM from the contact panel (a note, or a call result with its note, tag and follow-up task).
-- Ids and statuses only (the note text is never kept here). Holds the ids the CRM gave, so Undo can remove exactly what we created, a retry never writes twice
-- (unique idempotency key) and our own write is never counted as activity. If this has not been applied, the panel says it needs the latest database update. Safe to run twice.
create table if not exists public.contact_writes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  kind text not null check (kind in ('note', 'outcome', 'tag_add', 'tag_remove')),
  outcome text,
  idem_key text not null,
  actor text,
  actor_name text,
  status text not null default 'pending' check (status in ('pending', 'saved', 'dry_run', 'failed', 'needs_permission', 'undone')),
  note_id text,
  task_id text,
  tag text,
  tag_added boolean not null default false,
  detail text,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  unique (installation_id, idem_key)
);
create index if not exists contact_writes_hour_idx on public.contact_writes (installation_id, created_at desc);
create index if not exists contact_writes_echo_idx on public.contact_writes (installation_id, note_id) where note_id is not null;
alter table public.contact_writes enable row level security;
-- Tag dates: a tag SubSync itself added or removed has the exact time; one SubSync only noticed at a sync is the day it first saw it (exact = false).
alter table public.contact_tag_events add column if not exists exact boolean not null default false;

commit;
