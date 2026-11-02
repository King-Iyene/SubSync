import { sql } from "../db";
import type { Role } from "../identity";
import type { ContactHit, InboxStore, StoredMeeting } from "./inbox";
import { pgIngestStore } from "./ingest-store";
import type { PersonalConnection } from "./ingest";
import type { Person } from "./person";

// The database side of inbox.ts. Every statement names the installation AND the person's own user id, so one person can never read, change or remove
// another person's call, whatever id they send.

const ROLES: readonly Role[] = ["agency_owner", "agency_admin", "agency_staff", "account_admin", "account_user"];
const roleOf = (v: unknown): Role => ROLES.find((r) => r === v) ?? "account_user";
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const COLUMNS = "id, owner_ghl_user_id, connection_id, installation_id, provider, title, started_at, attendee_emails, summary, action_items, recording_url, status, reason, expires_at, created_at";

function rowOf(r: Record<string, unknown>): StoredMeeting {
  return {
    id: r.id as string, ownerUserId: r.owner_ghl_user_id as string, connectionId: (r.connection_id as string | null) ?? null, installationId: r.installation_id as string,
    provider: r.provider as StoredMeeting["provider"], title: (r.title as string | null) ?? null, startedAt: r.started_at instanceof Date ? r.started_at.toISOString() : null,
    attendeeEmails: strings(r.attendee_emails), summary: (r.summary as string | null) ?? null, actionItems: strings(r.action_items), recordingUrl: (r.recording_url as string | null) ?? null,
    status: r.status as string, reason: (r.reason as string | null) ?? null, expiresAt: ms(r.expires_at), createdAt: ms(r.created_at) ?? 0,
  };
}

/** A search term made safe for LIKE: the characters LIKE treats as wildcards are escaped. */
const like = (q: string) => `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function pgInboxStore(): InboxStore {
  const base = pgIngestStore();
  return {
    ...base,
    async getMeeting(installationId, userId, id) {
      const [r] = await sql()`select ${sql()(COLUMNS.split(", ") as never)} from meetings where id = ${id} and installation_id = ${installationId} and owner_ghl_user_id = ${userId}`;
      return r ? rowOf(r) : null;
    },
    async listWaiting(installationId, userId) {
      const rows = await sql()`select ${sql()(COLUMNS.split(", ") as never)} from meetings where installation_id = ${installationId} and owner_ghl_user_id = ${userId} and status = 'needs_contact' order by expires_at nulls last, created_at limit 200`;
      return rows.map(rowOf);
    },
    async contactIn(installationId, locationId, contactId) {
      const [r] = await sql()`select location_id, contact_id, coalesce(nullif(full_name, ''), nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')) name, email, phone from cached_contacts where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId}`;
      return r ? { locationId: r.location_id as string, contactId: r.contact_id as string, name: (r.name as string | null) ?? null, email: (r.email as string | null) ?? null, phone: (r.phone as string | null) ?? null } : null;
    },
    async searchContacts(installationId, locationIds, q): Promise<ContactHit[]> {
      if (locationIds.length === 0) return [];
      const pattern = like(q);
      const digits = q.replace(/\D/g, "");
      const rows = await sql()`
        select location_id, contact_id, coalesce(nullif(full_name, ''), nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')) name, email, phone
        from cached_contacts
        where installation_id = ${installationId} and location_id = any(${locationIds}::text[])
          and (lower(coalesce(full_name, '') || ' ' || coalesce(first_name, '') || ' ' || coalesce(last_name, '')) like ${pattern} escape '\\'
            or lower(coalesce(email, '')) like ${pattern} escape '\\'
            ${digits.length >= 4 ? sql()`or coalesce(phone_digits, '') like ${"%" + digits + "%"}` : sql()``})
        order by full_name nulls last limit 20`;
      return rows.map((r) => ({ locationId: r.location_id as string, contactId: r.contact_id as string, name: (r.name as string | null) ?? null, email: (r.email as string | null) ?? null, phone: (r.phone as string | null) ?? null }));
    },
    async scrub(installationId, userId, id, reason) {
      const rows = await sql()`
        update meetings set status = 'skipped', reason = ${reason}, title = null, started_at = null, attendee_emails = '[]'::jsonb, summary = null, action_items = '[]'::jsonb, recording_url = null, expires_at = null
        where id = ${id} and installation_id = ${installationId} and owner_ghl_user_id = ${userId} and status = 'needs_contact' returning id`;
      if (rows.length === 1) await sql()`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${userId}, ${"meeting_notes." + reason}, ${sql().json({ meetingId: id } as never)})`.catch(() => undefined);
      return rows.length === 1;
    },
    async addIgnored(installationId, userId, email) {
      await sql()`insert into meeting_ignored_emails (installation_id, ghl_user_id, email) values (${installationId}, ${userId}, ${email}) on conflict do nothing`;
    },
    async claimHeld(installationId, userId, id) {
      const rows = await sql()`update meetings set reason = 'releasing' where id = ${id} and installation_id = ${installationId} and owner_ghl_user_id = ${userId} and status = 'needs_contact' and reason = 'preview_needed' returning id`;
      return rows.length === 1;
    },
    async confirmPreview(installationId, person: Person) {
      await sql()`
        insert into meeting_note_settings (installation_id, ghl_user_id, preview_confirmed_at) values (${installationId}, ${person.userId}, now())
        on conflict (ghl_user_id) do update set preview_confirmed_at = now(), updated_at = now() where meeting_note_settings.installation_id = excluded.installation_id`;
      await sql()`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${person.userId}, 'meeting_notes.preview_confirmed', '{}'::jsonb)`;
    },
    async getConnection(installationId, userId): Promise<PersonalConnection | null> {
      const [r] = await sql()`select id, company_key, person_name, home_location_id, person_role, provider_account_email from user_connections where installation_id = ${installationId} and ghl_user_id = ${userId} and provider = 'fathom' and status = 'connected'`;
      if (!r) return null;
      const home = (r.home_location_id as string | null) ?? null;
      return {
        id: r.id as string, installationId, provider: "fathom", accountEmail: (r.provider_account_email as string | null) ?? null,
        person: { companyKey: r.company_key as string, userId, name: (r.person_name as string | null) ?? null, role: roleOf(r.person_role), kind: home ? "client" : "agency", homeLocationId: home },
      };
    },
  };
}

/** The person's own choices that the Meeting inbox changes: the master switch and what to do with a call nobody matches. */
export async function saveMySettings(installationId: string, person: Person, patch: { masterSwitch?: boolean; unmatchedMode?: "inbox" | "discard" }): Promise<void> {
  const db = sql();
  await db`
    insert into meeting_note_settings (installation_id, ghl_user_id, master_switch, unmatched_mode)
    values (${installationId}, ${person.userId}, ${patch.masterSwitch ?? true}, ${patch.unmatchedMode ?? "inbox"})
    on conflict (ghl_user_id) do update set
      master_switch = ${patch.masterSwitch === undefined ? db`meeting_note_settings.master_switch` : patch.masterSwitch},
      unmatched_mode = ${patch.unmatchedMode === undefined ? db`meeting_note_settings.unmatched_mode` : patch.unmatchedMode},
      updated_at = now()
    where meeting_note_settings.installation_id = excluded.installation_id`;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${person.userId}, 'meeting_notes.settings_saved', ${db.json({ masterSwitch: patch.masterSwitch ?? null, unmatchedMode: patch.unmatchedMode ?? null } as never)})`;
}

/** The person's own recent calls that are not waiting, with how many notes each produced: the "what happened to my calls" list. */
export async function listRecent(installationId: string, userId: string): Promise<Array<{ id: string; title: string | null; startedAt: string | null; createdAt: number; status: string; reason: string | null; notes: number }>> {
  const rows = await sql()`
    select m.id, m.title, m.started_at, m.created_at, m.status, m.reason, (select count(*)::int from crm_writes w where w.meeting_id = m.id and w.kind = 'note') notes
    from meetings m where m.installation_id = ${installationId} and m.owner_ghl_user_id = ${userId} and m.status <> 'needs_contact' order by m.created_at desc limit 20`;
  return rows.map((r) => ({ id: r.id as string, title: (r.title as string | null) ?? null, startedAt: r.started_at instanceof Date ? r.started_at.toISOString() : null, createdAt: ms(r.created_at) ?? 0, status: r.status as string, reason: (r.reason as string | null) ?? null, notes: r.notes as number }));
}
