import { installationHasScope } from "../analytics/cleanup-queries";
import { sql } from "../db";
import { FIELD_ITEMS, fieldTypeOf, type FieldItem, type FieldMapping, type FieldType } from "./contact-fields";
import type { FieldReport, FieldState, IngestStore, PartRef } from "./ingest";
import type { Person } from "./person";
import { cleanPriority, type SeenMeeting } from "./source-priority";

// The database side of stage E2b: the account's field mapping, what filled each contact field last (the ordering rule), the per-part idempotency of the
// write log, the same-meeting lookup, and a person's saved layout. Every statement names the installation; a person's own rows also name their user id.

const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const isItem = (v: unknown): v is FieldItem => (FIELD_ITEMS as readonly unknown[]).includes(v);

// ---------------- the admin's field mapping ----------------

export async function loadFieldMappings(installationId: string, locationIds: string[]): Promise<Record<string, FieldMapping[]>> {
  if (locationIds.length === 0) return {};
  const rows = await sql()`select location_id, item, ghl_custom_field_id, field_name, field_type, enabled from field_mappings where installation_id = ${installationId} and location_id = any(${locationIds}::text[]) order by location_id, item`;
  const out: Record<string, FieldMapping[]> = {};
  for (const r of rows) {
    if (!isItem(r.item)) continue;
    (out[r.location_id as string] ??= []).push({
      item: r.item, customFieldId: r.ghl_custom_field_id as string, fieldName: r.field_name as string, fieldType: fieldTypeOf(r.field_type as string), enabled: r.enabled === true,
    });
  }
  return out;
}

export type MappingInput = { item: FieldItem; customFieldId: string | null; fieldName: string; fieldType: FieldType; enabled: boolean };

/** Saves one account's mapping: each row given is set (or removed when it has no field), rows not mentioned are left as they are. */
export async function saveFieldMappings(installationId: string, locationId: string, rows: MappingInput[], setBy: string): Promise<void> {
  await sql().begin(async (tx) => {
    for (const r of rows) {
      if (r.customFieldId === null) {
        await tx`delete from field_mappings where installation_id = ${installationId} and location_id = ${locationId} and item = ${r.item}`;
        continue;
      }
      await tx`
        insert into field_mappings (installation_id, location_id, item, ghl_custom_field_id, field_name, field_type, enabled, set_by)
        values (${installationId}, ${locationId}, ${r.item}, ${r.customFieldId}, ${r.fieldName}, ${r.fieldType === "other" ? "text" : r.fieldType}, ${r.enabled}, ${setBy})
        on conflict (installation_id, location_id, item) do update set ghl_custom_field_id = excluded.ghl_custom_field_id, field_name = excluded.field_name,
          field_type = excluded.field_type, enabled = excluded.enabled, set_by = excluded.set_by, set_at = now()`;
    }
    await tx`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${setBy}, 'meeting_fields.mapping_saved', ${tx.json({ locationId, items: rows.map((r) => ({ item: r.item, mapped: r.customFieldId !== null, enabled: r.enabled })) } as never)})`;
  });
}

/** Does this account have at least one enabled mapping? (Contact fields may only be allowed once it does.) */
export async function hasEnabledMapping(installationId: string, locationId: string): Promise<boolean> {
  const [r] = await sql()`select 1 from field_mappings where installation_id = ${installationId} and location_id = ${locationId} and enabled limit 1`;
  return Boolean(r);
}

// ---------------- the ordering rule: what filled each field last ----------------

/**
 * Runs `fn` while holding a lock for ONE contact's fields (a transaction-level advisory lock), so two meetings for the same contact are handled one
 * after the other: the first one's recorded date is what the second one is compared with. The lock is held only around the one write request.
 */
export async function withFieldLock<T>(installationId: string, locationId: string, contactId: string, fn: (state: FieldState) => Promise<T>): Promise<T> {
  return sql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`field:${installationId}:${locationId}:${contactId}`}))`;
    const state: FieldState = {
      async previous(items) {
        const rows = await tx`select item, meeting_started_at from field_write_state where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId} and item = any(${items as unknown as string[]}::text[])`;
        const out: Partial<Record<FieldItem, number>> = {};
        for (const r of rows) if (isItem(r.item)) { const t = ms(r.meeting_started_at); if (t !== null) out[r.item] = t; }
        return out;
      },
      async record(r) {
        if (r.meetingStartedAt !== null) {
          // Only a NEWER meeting moves the date forward, even if two writers got here out of order.
          await tx`
            insert into field_write_state (installation_id, location_id, contact_id, item, meeting_started_at, meeting_id)
            values (${installationId}, ${locationId}, ${contactId}, ${r.item}, ${new Date(r.meetingStartedAt)}, ${r.meetingId})
            on conflict (installation_id, location_id, contact_id, item) do update set meeting_started_at = excluded.meeting_started_at, meeting_id = excluded.meeting_id, written_at = now()
              where field_write_state.meeting_started_at < excluded.meeting_started_at`;
        }
        await tx`
          insert into crm_writes (installation_id, meeting_id, location_id, contact_id, kind, ghl_id, part_no, authored_by)
          values (${installationId}, ${r.meetingId}, ${locationId}, ${contactId}, 'field', null, ${r.partNo}, ${r.authoredBy}) on conflict do nothing`;
      },
    };
    return fn(state);
  }) as Promise<T>;
}

// ---------------- each part written once ----------------

/** Takes the right to write one part. The write log's unique rule decides: two simultaneous takers give exactly one winner. */
export async function claimPart(r: PartRef): Promise<boolean> {
  const rows = await sql()`
    insert into crm_writes (installation_id, meeting_id, location_id, contact_id, kind, ghl_id, part_no, authored_by)
    values (${r.installationId}, ${r.meetingId}, ${r.locationId}, ${r.contactId}, ${r.kind}, null, ${r.partNo}, ${r.authoredBy}) on conflict do nothing returning id`;
  return rows.length === 1;
}

export async function finishPart(r: PartRef, ghlId: string | null): Promise<void> {
  const db = sql();
  await db`update crm_writes set ghl_id = ${ghlId} where meeting_id = ${r.meetingId} and contact_id = ${r.contactId} and kind = ${r.kind} and part_no = ${r.partNo} and installation_id = ${r.installationId}`;
  // The audit log says who wrote what where (ids only, never any text of the call).
  await db`insert into audit_log (installation_id, actor, action, detail) values (${r.installationId}, ${r.authoredBy}, ${`meeting_notes.${r.kind}_written`}, ${db.json({ meetingId: r.meetingId, locationId: r.locationId, contactId: r.contactId, part: r.partNo } as never)})`.catch(() => undefined);
}

/** Gives the right back (the write did not happen), so a retry can write the part. */
export async function releasePart(r: PartRef): Promise<void> {
  await sql()`delete from crm_writes where meeting_id = ${r.meetingId} and contact_id = ${r.contactId} and kind = ${r.kind} and part_no = ${r.partNo} and installation_id = ${r.installationId} and ghl_id is null`;
}

/** What each field did for one delivery, in the audit log: item names and plain reasons, never a value. */
export async function logDelivery(installationId: string, userId: string, meetingId: string, fields: FieldReport[]): Promise<void> {
  const db = sql();
  for (const f of fields) {
    if (f.written.length === 0 && f.skipped.length === 0) continue;
    await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${userId}, 'meeting_fields.delivered', ${db.json({
      meetingId, locationId: f.locationId, contactId: f.contactId, written: f.written, cut: f.cut, skipped: f.skipped.map((s) => ({ item: s.item, code: s.code, reason: s.message })),
    } as never)})`.catch(() => undefined);
  }
}

// ---------------- the same meeting from two tools ----------------

export async function recentMeetings(installationId: string, userId: string, aroundIso: string): Promise<SeenMeeting[]> {
  const rows = await sql()`
    select id, provider, started_at, attendee_emails, title, status from meetings
    where installation_id = ${installationId} and owner_ghl_user_id = ${userId} and started_at between ${new Date(Date.parse(aroundIso) - 30 * 60_000)} and ${new Date(Date.parse(aroundIso) + 30 * 60_000)}
    limit 50`;
  return rows.map((r) => ({ id: r.id as string, provider: r.provider as string, startedAt: r.started_at instanceof Date ? r.started_at.toISOString() : null, attendeeEmails: strings(r.attendee_emails), title: (r.title as string | null) ?? null, status: r.status as string }));
}

/** Waiting copies of a meeting become duplicates and lose their content (only this person's own, only still-waiting ones). */
export async function markDuplicates(installationId: string, userId: string, ids: string[], reason: string): Promise<void> {
  if (ids.length === 0) return;
  await sql()`
    update meetings set status = 'duplicate', reason = ${reason}, title = null, started_at = null, attendee_emails = '[]'::jsonb, summary = null, action_items = '[]'::jsonb, recording_url = null, expires_at = null
    where id = any(${ids}::uuid[]) and installation_id = ${installationId} and owner_ghl_user_id = ${userId} and status = 'needs_contact'`;
  // The names kept as hints go with the rest of the content (best effort: a database not updated yet has no such column).
  await sql()`update meetings set attendee_names = '[]'::jsonb where id = any(${ids}::uuid[]) and installation_id = ${installationId} and owner_ghl_user_id = ${userId} and status = 'duplicate'`.catch(() => undefined);
}

// ---------------- the person's saved layout ----------------

export type MyChoicesPatch = {
  preset?: "recommended" | "full_record" | "summary_only" | "custom";
  custom?: Record<string, string> | null;
  template?: string | null;
  sourcePriority?: string[];
  unmatchedMode?: "inbox" | "discard";
  masterSwitch?: boolean;
};

/** Saves a person's own choices. Whatever the patch leaves out stays as it was. Choosing a layout marks it as the person's own choice. */
export async function saveMyChoices(installationId: string, person: Person, patch: MyChoicesPatch): Promise<void> {
  const db = sql();
  const has = <K extends keyof MyChoicesPatch>(k: K) => patch[k] !== undefined;
  await db`
    insert into meeting_note_settings (installation_id, ghl_user_id, preset, content_matrix, custom_template, source_priority, unmatched_mode, master_switch, preset_chosen)
    values (${installationId}, ${person.userId}, ${patch.preset ?? "recommended"}, ${db.json((patch.custom ?? {}) as never)}, ${patch.template ?? null},
      ${db.json(cleanPriority(patch.sourcePriority) as never)}, ${patch.unmatchedMode ?? "inbox"}, ${patch.masterSwitch ?? true}, ${has("preset")})
    on conflict (ghl_user_id) do update set
      preset = ${has("preset") ? patch.preset! : db`meeting_note_settings.preset`},
      preset_chosen = ${has("preset") ? true : db`meeting_note_settings.preset_chosen`},
      content_matrix = ${has("custom") ? db.json((patch.custom ?? {}) as never) : db`meeting_note_settings.content_matrix`},
      custom_template = ${has("template") ? patch.template ?? null : db`meeting_note_settings.custom_template`},
      source_priority = ${has("sourcePriority") ? db.json(cleanPriority(patch.sourcePriority) as never) : db`meeting_note_settings.source_priority`},
      unmatched_mode = ${has("unmatchedMode") ? patch.unmatchedMode! : db`meeting_note_settings.unmatched_mode`},
      master_switch = ${has("masterSwitch") ? patch.masterSwitch! : db`meeting_note_settings.master_switch`},
      updated_at = now()
    where meeting_note_settings.installation_id = excluded.installation_id`;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${person.userId}, 'meeting_notes.choices_saved', ${db.json({ changed: Object.keys(patch) } as never)})`;
}

/** The store functions of this stage, ready to merge into the ingest store. */
export const setupStore: Pick<IngestStore, "fieldMappings" | "fieldLock" | "recentMeetings" | "markDuplicates" | "claimPart" | "finishPart" | "releasePart" | "logDelivery" | "hasScope"> = {
  fieldMappings: loadFieldMappings,
  fieldLock: withFieldLock,
  recentMeetings,
  markDuplicates,
  claimPart,
  finishPart,
  releasePart,
  logDelivery,
  hasScope: installationHasScope,
};
