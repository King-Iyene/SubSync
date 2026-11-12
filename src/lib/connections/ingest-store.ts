import { decryptSecret } from "../crypto";
import { sql } from "../db";
import { writeToCrm } from "../ghl/crm-writes";
import { installationHasScope } from "../analytics/cleanup-queries";
import { locationAccessToken } from "../sync/engine";
import type { DeliveryStore, HookConnection } from "./fathom-hook";
import type { IngestStore, MeetingRow, PersonalConnection, PersonSettings, Writer } from "./ingest";
import type { Candidate } from "./meeting-plan";
import type { Role } from "../identity";
import { recordCrmWrite } from "./write-log";
import { setupStore } from "./setup-store";
import { cleanPriority } from "./source-priority";
import { amNotify } from "./auto-notices";

// The database side of ingest.ts: every statement is scoped by the installation id and, for a person, by their own user id. Webhook handlers have no
// signed-in user, so they use this server-side layer after the provider's signature has been checked.

const ROLES: readonly Role[] = ["agency_owner", "agency_admin", "agency_staff", "account_admin", "account_user"];
const roleOf = (v: unknown): Role => ROLES.find((r) => r === v) ?? "account_user";

export const DEFAULT_SETTINGS: PersonSettings = { masterSwitch: true, unmatchedMode: "inbox", preset: "recommended", custom: null, previewConfirmedAt: null };

export function pgIngestStore(): IngestStore {
  return {
    now: () => Date.now(),
    async installed(installationId) {
      const rows = await sql()`select location_id, ignored from locations where installation_id = ${installationId}`;
      return rows.map((r) => ({ locationId: r.location_id as string, ignored: r.ignored === true }));
    },
    // The Users list is not read yet (it needs users.readonly and a check of what it shows for staff), so access cannot be proven and company staff match nothing.
    provenAccess: async () => null,
    async candidates(installationId, locationIds, emails): Promise<Candidate[]> {
      if (locationIds.length === 0 || emails.length === 0) return [];
      const rows = await sql()`
        select location_id, contact_id, lower(email) email from cached_contacts
        where installation_id = ${installationId} and location_id = any(${locationIds}::text[]) and lower(email) = any(${emails}::text[]) limit 500`;
      return rows.map((r) => ({ locationId: r.location_id as string, contactId: r.contact_id as string, email: r.email as string }));
    },
    async policies(installationId) {
      const rows = await sql()`select scope, location_id, flags from meeting_policies where installation_id = ${installationId}`;
      const accounts: Record<string, unknown> = {};
      let agency: unknown = null;
      for (const r of rows) {
        if (r.scope === "agency") agency = r.flags;
        else if (typeof r.location_id === "string") accounts[r.location_id] = r.flags;
      }
      return { agency, accounts };
    },
    async settings(installationId, userId): Promise<PersonSettings> {
      const [r] = await sql()`select master_switch, unmatched_mode, preset, content_matrix, preview_confirmed_at, custom_template, preset_chosen, source_priority, auto_add_notes, auto_add_accepted_at from meeting_note_settings where installation_id = ${installationId} and ghl_user_id = ${userId}`;
      if (!r) return DEFAULT_SETTINGS;
      return {
        masterSwitch: r.master_switch !== false, unmatchedMode: r.unmatched_mode === "discard" ? "discard" : "inbox",
        preset: r.preset === "full_record" || r.preset === "summary_only" || r.preset === "custom" ? r.preset : "recommended", custom: r.content_matrix,
        previewConfirmedAt: r.preview_confirmed_at instanceof Date ? r.preview_confirmed_at.getTime() : null,
        template: (r.custom_template as string | null) ?? null, presetChosen: r.preset_chosen === true, sourcePriority: cleanPriority(r.source_priority),
        autoNotes: { on: r.auto_add_notes === true, acceptedAt: r.auto_add_accepted_at instanceof Date ? r.auto_add_accepted_at.getTime() : null },
      };
    },
    async writesToday(installationId, userId, locationIds) {
      const db = sql();
      const [u] = await db`select count(*)::int n from meetings where installation_id = ${installationId} and owner_ghl_user_id = ${userId} and status in ('saved', 'dry_run') and created_at >= date_trunc('day', now())`;
      const per = locationIds.length
        // One count per meeting and contact (a long note in three parts, or a note plus a field update, is still one delivery), not one per row.
        ? await db`select location_id, count(distinct (meeting_id, contact_id))::int n from crm_writes where installation_id = ${installationId} and location_id = any(${locationIds}::text[]) and created_at >= date_trunc('day', now()) group by location_id`
        : [];
      return { user: (u?.n as number) ?? 0, byAccount: Object.fromEntries(per.map((r) => [r.location_id as string, r.n as number])) };
    },
    async insertMeeting(row: MeetingRow) {
      const db = sql();
      const rows = await db`
        insert into meetings (installation_id, owner_ghl_user_id, connection_id, provider, provider_meeting_id, started_at, title, attendee_emails, summary, action_items, recording_url, status, reason, expires_at)
        values (${row.installationId}, ${row.ownerUserId}, ${row.connectionId}, ${row.provider}, ${row.providerMeetingId}, ${row.startedAt}, ${row.title}, ${db.json(row.attendeeEmails as never)},
          ${row.summary}, ${db.json(row.actionItems as never)}, ${row.recordingUrl}, ${row.status}, ${row.reason}, ${row.expiresAt === null ? null : new Date(row.expiresAt)})
        on conflict (owner_ghl_user_id, provider, provider_meeting_id) do nothing returning id`;
      return rows.length === 1 ? (rows[0].id as string) : null;
    },
    async updateMeeting(id, status, reason, expiresAt) {
      await sql()`update meetings set status = ${status}, reason = ${reason}, expires_at = ${expiresAt === undefined ? sql()`expires_at` : expiresAt === null ? null : new Date(expiresAt)} where id = ${id}`;
    },
    async noteDetails(id, d) {
      // Best effort and additive: until the update with these columns is applied this simply keeps nothing.
      await sql()`update meetings set duration_minutes = coalesce(${d.durationMinutes}::int, duration_minutes), talk_pct = coalesce(${d.talkPct}::smallint, talk_pct), matched_location_id = coalesce(${d.matched?.locationId ?? null}, matched_location_id), matched_contact_id = coalesce(${d.matched?.contactId ?? null}, matched_contact_id), matched_at = coalesce(${d.matched ? new Date() : null}::timestamptz, matched_at) where id = ${id}`.catch(() => undefined);
    },
    async ignoredEmails(installationId, userId) {
      const rows = await sql()`select email from meeting_ignored_emails where installation_id = ${installationId} and ghl_user_id = ${userId}`;
      return rows.map((r) => r.email as string);
    },
    hasWriteScope: (installationId) => installationHasScope(installationId, "contacts.write"),
    ...setupStore,
    notify: amNotify,
    async recordWrite(r) {
      const first = await recordCrmWrite({ ...r, partNo: r.partNo ?? 1 });
      // The audit log says who wrote what where (ids only, never any text of the call).
      if (first) await sql()`insert into audit_log (installation_id, actor, action, detail) values (${r.installationId}, ${r.authoredBy}, ${`meeting_notes.${r.kind}_written`}, ${sql().json({ meetingId: r.meetingId, locationId: r.locationId, contactId: r.contactId } as never)})`.catch(() => undefined);
      return first;
    },
    async bump(connectionId, field) {
      const db = sql();
      if (field === "saved") await db`update user_connections set saved_count = saved_count + 1, last_event_at = now(), last_ok_at = now() where id = ${connectionId}`;
      else await db`update user_connections set skipped_count = skipped_count + 1, last_event_at = now(), last_ok_at = now() where id = ${connectionId}`;
    },
  };
}

/** The writer that puts a note into one account's contact, as the connecting person. Without WRITE_GHL_LIVE it only records "WOULD WRITE". */
export function crmWriter(companyKey: string): Writer {
  return (a) => writeToCrm({ installationId: a.installationId, locationId: a.locationId, contactId: a.contactId, meetingId: a.meetingId, request: a.request, token: () => locationAccessToken(companyKey, a.locationId) });
}

export type StoredHookConnection = PersonalConnection & { webhookSecretEnc: string | null; status: string; companyKey: string };

/** The connection a Fathom delivery address belongs to. A revoked, disconnected or unknown key finds nothing (the route answers 404 for all of them). */
export async function findPersonalByKey(key: string): Promise<StoredHookConnection | null> {
  const [r] = await sql()`
    select u.id, u.installation_id, u.company_key, u.ghl_user_id, u.person_name, u.home_location_id, u.person_role, u.provider, u.provider_account_email, u.webhook_secret_enc, u.status
    from user_connections u join installations i on i.id = u.installation_id and i.uninstalled_at is null
    where u.public_key = ${key} and u.provider = 'fathom' and u.status = 'connected'`;
  if (!r) return null;
  const home = (r.home_location_id as string | null) ?? null;
  return {
    id: r.id as string, installationId: r.installation_id as string, provider: "fathom", accountEmail: (r.provider_account_email as string | null) ?? null,
    person: { companyKey: r.company_key as string, userId: r.ghl_user_id as string, name: (r.person_name as string | null) ?? null, role: roleOf(r.person_role), kind: home ? "client" : "agency", homeLocationId: home },
    webhookSecretEnc: (r.webhook_secret_enc as string | null) ?? null, status: r.status as string, companyKey: r.company_key as string,
  };
}

export const webhookSecretOf = (c: StoredHookConnection): string | null => (c.webhookSecretEnc ? decryptSecret(c.webhookSecretEnc) : null);

/** The connection a delivery address belongs to, with its delivery secret decrypted for the signature check (server code only; never returned to a screen). */
export async function findHookConnection(key: string): Promise<HookConnection | null> {
  const c = await findPersonalByKey(key);
  return c ? { ...c, webhookSecret: webhookSecretOf(c) } : null;
}

/** Claims a delivery id in the database: the unique index makes two simultaneous claims of one id give exactly one winner. */
export function pgDeliveryStore(): DeliveryStore {
  return {
    async claim(installationId, connectionId, webhookId) {
      const rows = await sql()`insert into meeting_deliveries (installation_id, connection_id, webhook_id) values (${installationId}, ${connectionId}, ${webhookId}) on conflict do nothing returning id`;
      return rows.length === 1;
    },
    async release(connectionId, webhookId) {
      await sql()`delete from meeting_deliveries where connection_id = ${connectionId} and webhook_id = ${webhookId}`;
    },
  };
}
