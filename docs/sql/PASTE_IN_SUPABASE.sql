-- SubSync: paste this WHOLE file into the Supabase SQL Editor and press Run, once.
-- It adds the 14 new migrations. Every statement is safe to run twice.
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

commit;
