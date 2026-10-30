import { createHash, randomBytes } from "node:crypto";
import { sql } from "../db";
import { matchContact, noteText, type Meeting } from "./meeting-intel";

// Meeting addresses look like mh_<43 url-safe characters>. Only a hash is stored, so an address can be
// shown once and never read back.
export const HOOK_PREFIX = "mh_";
export const looksLikeHook = (t: string) => /^mh_[A-Za-z0-9_-]{40,60}$/.test(t);
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const MAX_HOOKS_PER_ACCOUNT = 3;
export const MAX_PER_HOUR = 120;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);

export async function createHook(installationId: string, locationId: string, label: string | null): Promise<{ id: string; token: string } | "limit" | "no_account"> {
  const db = sql();
  const [loc] = await db`select 1 from locations where installation_id = ${installationId} and location_id = ${locationId}`;
  if (!loc) return "no_account";
  const [n] = await db`select count(*)::int n from meeting_hooks where installation_id = ${installationId} and location_id = ${locationId} and active`;
  if (n.n >= MAX_HOOKS_PER_ACCOUNT) return "limit";
  const token = HOOK_PREFIX + randomBytes(32).toString("base64url");
  const [row] = await db`insert into meeting_hooks (installation_id, location_id, token_hash, label) values (${installationId}, ${locationId}, ${hashToken(token)}, ${label}) returning id`;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, null, 'meetings.hook_created', ${db.json({ locationId } as never)})`;
  return { id: row.id as string, token };
}

export async function listHooks(installationId: string, allowed: string[] | null) {
  const db = sql();
  const rows = await db`
    select h.id, h.location_id, l.name location_name, h.label, h.created_at, h.last_used_at from meeting_hooks h
    left join locations l on l.installation_id = h.installation_id and l.location_id = h.location_id
    where h.installation_id = ${installationId} and h.active ${allowed ? db`and h.location_id = any(${allowed}::text[])` : db``} order by h.created_at desc`;
  return rows.map((r) => ({ id: r.id as string, locationId: r.location_id as string, locationName: r.location_name as string | null, label: r.label as string | null, createdAt: iso(r.created_at), lastUsedAt: iso(r.last_used_at) }));
}

export async function revokeHook(installationId: string, allowed: string[] | null, id: string): Promise<boolean> {
  const db = sql();
  const rows = await db`update meeting_hooks set active = false where id = ${id} and installation_id = ${installationId} and active
    ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} returning id`;
  return rows.length === 1;
}

export async function resolveHook(token: string) {
  if (!looksLikeHook(token)) return null;
  const [r] = await sql()`
    select h.id, h.installation_id, h.location_id, s.keep_transcripts from meeting_hooks h
    join installations i on i.id = h.installation_id and i.uninstalled_at is null
    left join settings s on s.installation_id = h.installation_id
    where h.token_hash = ${hashToken(token)} and h.active`;
  return r ? { id: r.id as string, installationId: r.installation_id as string, locationId: r.location_id as string, keepTranscripts: r.keep_transcripts === true } : null;
}

export async function recentCount(installationId: string, locationId: string): Promise<number> {
  const [r] = await sql()`select count(*)::int n from meeting_notes where installation_id = ${installationId} and location_id = ${locationId} and received_at > now() - interval '1 hour'`;
  return r.n as number;
}

// Store what arrived. The transcript is dropped unless the account chose to keep transcripts.
export async function recordMeeting(hook: NonNullable<Awaited<ReturnType<typeof resolveHook>>>, m: Meeting): Promise<{ id: string; matched: boolean }> {
  const db = sql();
  const emails = m.attendees.map((a) => a.email).filter((e): e is string => !!e);
  const candidates = emails.length
    ? await db`select contact_id, lower(email) email from cached_contacts where installation_id = ${hook.installationId} and location_id = ${hook.locationId} and lower(email) = any(${emails}::text[]) limit 20`
    : [];
  const hit = matchContact(m.attendees, candidates.map((c) => ({ contactId: c.contact_id as string, email: c.email as string })));
  const [row] = await db`
    insert into meeting_notes (installation_id, location_id, source, title, started_at, attendees, summary, action_items, transcript, recording_url, contact_id)
    values (${hook.installationId}, ${hook.locationId}, ${m.source}, ${m.title}, ${m.startedAt}, ${db.json(m.attendees as never)}, ${m.summary}, ${db.json(m.actionItems as never)},
      ${hook.keepTranscripts ? m.transcript : null}, ${m.recordingUrl}, ${hit?.contactId ?? null}) returning id`;
  await db`update meeting_hooks set last_used_at = now() where id = ${hook.id}`;
  return { id: row.id as string, matched: hit !== null };
}

export type MeetingRow = {
  id: string; locationId: string; locationName: string | null; source: string; title: string | null; startedAt: string | null; receivedAt: string | null;
  attendees: Array<{ name: string | null; email: string | null }>; summary: string | null; actionItems: string[]; hasTranscript: boolean; recordingUrl: string | null;
  contactId: string | null; contactName: string | null; status: string; note: string;
};

export async function listMeetings(installationId: string, allowed: string[] | null, limit = 60): Promise<MeetingRow[]> {
  const db = sql();
  const rows = await db`
    select n.*, l.name location_name, coalesce(nullif(c.full_name, ''), c.email) contact_name from meeting_notes n
    left join locations l on l.installation_id = n.installation_id and l.location_id = n.location_id
    left join cached_contacts c on c.installation_id = n.installation_id and c.location_id = n.location_id and c.contact_id = n.contact_id
    where n.installation_id = ${installationId} and n.status <> 'dismissed' ${allowed ? db`and n.location_id = any(${allowed}::text[])` : db``}
    order by n.received_at desc limit ${limit}`;
  return rows.map((r) => {
    const attendees = (r.attendees as MeetingRow["attendees"]) ?? [];
    const actionItems = (r.action_items as string[]) ?? [];
    return {
      id: r.id as string, locationId: r.location_id as string, locationName: r.location_name as string | null, source: r.source as string, title: r.title as string | null,
      startedAt: iso(r.started_at), receivedAt: iso(r.received_at), attendees, summary: r.summary as string | null, actionItems, hasTranscript: Boolean(r.transcript),
      recordingUrl: r.recording_url as string | null, contactId: r.contact_id as string | null, contactName: r.contact_name as string | null, status: r.status as string,
      note: noteText({ title: r.title as string | null, startedAt: iso(r.started_at), attendees, summary: r.summary as string | null, actionItems, recordingUrl: r.recording_url as string | null }),
    };
  });
}

export async function setMeetingStatus(installationId: string, allowed: string[] | null, id: string, status: "new" | "filed" | "dismissed"): Promise<boolean> {
  const db = sql();
  const rows = await db`update meeting_notes set status = ${status} where id = ${id} and installation_id = ${installationId}
    ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} returning id`;
  return rows.length === 1;
}
