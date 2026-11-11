import { sql } from "../db";
import { matchMeeting, nextStepOf, plausible, type Candidate } from "./appointment-meetings";

// The data behind the Appointments "Meetings" sub-section (slice AB). A recorded call is PRIVATE to the person whose tool recorded it: every read names the installation AND the
// person's own user id, so no one can read another person's call whatever id they send. The appointment side is limited to the accounts the router allows. No transcript is ever read.

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const DAY = 86_400_000;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function connectionStatus(installationId: string, userId: string) {
  const [r] = await sql()`select id, status, provider_account_email, last_ok_at, last_event_at, last_error_code from user_connections where installation_id = ${installationId} and ghl_user_id = ${userId} and provider = 'fathom' and status <> 'revoked' limit 1`.catch(() => []);
  return r ? { id: r.id as string, status: r.status as string, email: (r.provider_account_email as string | null) ?? null, lastOkAt: iso(r.last_ok_at), lastEventAt: iso(r.last_event_at), errorCode: (r.last_error_code as string | null) ?? null } : null;
}

type Cand = Candidate & { name: string; calendar: string | null };
/** Appointments of the allowed accounts whose slot is near `start` and whose contact has an email. At most 40, nearest first. */
async function candidatesNear(installationId: string, allowed: string[] | null, start: number, emails: readonly string[]): Promise<Cand[]> {
  const list = emails.map((e) => e.trim().toLowerCase()).filter(Boolean).slice(0, 20);
  if (list.length === 0) return [];
  const db = sql();
  const rows = await db`
    select a.appointment_id, a.location_id, a.start_at, a.end_at, a.status, a.calendar_name, ct.email, coalesce(nullif(btrim(ct.full_name), ''), ct.email) name
    from cached_appointments a join cached_contacts ct on ct.installation_id = a.installation_id and ct.location_id = a.location_id and ct.contact_id = a.contact_id
    where a.installation_id = ${installationId} ${allowed ? db`and a.location_id = any(${allowed}::text[])` : db``}
      and lower(ct.email) = any(${list}::text[]) and a.start_at between ${new Date(start - 14 * DAY).toISOString()} and ${new Date(start + 14 * DAY).toISOString()}
    order by abs(extract(epoch from (a.start_at - ${new Date(start).toISOString()}::timestamptz))) limit 40`;
  return rows.map((r) => ({ appointmentId: r.appointment_id as string, locationId: r.location_id as string, contactEmail: (r.email as string | null) ?? null, startAt: iso(r.start_at) as string, endAt: iso(r.end_at), status: (r.status as string | null) ?? null, name: (r.name as string | null) ?? "Contact", calendar: (r.calendar_name as string | null) ?? null }));
}

export type MeetingRow = { id: string; title: string | null; startedAt: string | null; summary: string | null; actionItems: string[]; nextStep: string | null; recordingUrl: string | null; attendeeCount: number };
const meetingOf = (r: Record<string, unknown>): MeetingRow => ({ id: r.id as string, title: (r.title as string | null) ?? null, startedAt: iso(r.started_at), summary: (r.summary as string | null) ?? null, actionItems: strings(r.action_items), nextStep: nextStepOf(strings(r.action_items)), recordingUrl: (r.recording_url as string | null) ?? null, attendeeCount: strings(r.attendee_emails).length });

/** The person's own calls that are not yet tied to an appointment, each with the appointments it could be (for the one-click match). */
export async function needsMatching(installationId: string, userId: string, allowed: string[] | null, page: number, size: number) {
  const db = sql();
  const where = db`m.installation_id = ${installationId} and m.owner_ghl_user_id = ${userId} and m.provider = 'fathom' and m.status in ('needs_contact', 'saved', 'dry_run') and m.started_at is not null
    and not exists (select 1 from appointment_meeting_links l where l.installation_id = m.installation_id and l.meeting_id = m.id)`;
  const [tot] = await db`select count(*)::int n from meetings m where ${where}`;
  const rows = await db`select m.id, m.title, m.started_at, m.summary, m.action_items, m.recording_url, m.attendee_emails from meetings m where ${where} order by m.started_at desc limit ${size} offset ${page * size}`;
  const out = [];
  for (const r of rows) {
    const emails = strings(r.attendee_emails);
    const cands = await candidatesNear(installationId, allowed, Date.parse(iso(r.started_at) ?? ""), emails);
    out.push({ ...meetingOf(r), options: cands.slice(0, 5).map((c) => ({ appointmentId: c.appointmentId, locationId: c.locationId, name: c.name, calendar: c.calendar, startAt: c.startAt })) });
  }
  return { total: Number(tot?.n ?? 0), rows: out, page, size };
}

/** Ties every certain call of this person to its appointment (Sync now). Returns how many were tied and how many still wait. Only the person's own calls. */
export async function rematchOwn(installationId: string, userId: string, allowed: string[] | null): Promise<{ linked: number; waiting: number }> {
  const db = sql();
  const rows = await db`select m.id, m.started_at, m.attendee_emails from meetings m where m.installation_id = ${installationId} and m.owner_ghl_user_id = ${userId} and m.provider = 'fathom' and m.started_at is not null and m.status in ('needs_contact', 'saved', 'dry_run')
    and not exists (select 1 from appointment_meeting_links l where l.installation_id = m.installation_id and l.meeting_id = m.id) order by m.started_at desc limit 200`;
  let linked = 0, waiting = 0;
  for (const r of rows) {
    const facts = { id: r.id as string, startedAt: iso(r.started_at), attendeeEmails: strings(r.attendee_emails) };
    const res = matchMeeting(facts, await candidatesNear(installationId, allowed, Date.parse(facts.startedAt as string), facts.attendeeEmails));
    if (res.kind === "certain") { if (await link(installationId, userId, facts.id, res.locationId, res.appointmentId, "auto")) linked++; } else waiting++;
  }
  return { linked, waiting };
}

/** Ties one of the person's own calls to one appointment. False when the call is not theirs. The route has already checked the appointment's account. */
export async function link(installationId: string, userId: string, meetingId: string, locationId: string, appointmentId: string, by: "auto" | "person", suggestion: "showed" | "noshow" | null = "showed"): Promise<boolean> {
  const db = sql();
  const [m] = await db`select 1 from meetings where id = ${meetingId} and installation_id = ${installationId} and owner_ghl_user_id = ${userId}`;
  const [a] = await db`select 1 from cached_appointments where installation_id = ${installationId} and location_id = ${locationId} and appointment_id = ${appointmentId}`;
  if (!m || !a) return false;
  await db`insert into appointment_meeting_links (installation_id, location_id, appointment_id, meeting_id, owner_ghl_user_id, matched_by, suggested_outcome) values (${installationId}, ${locationId}, ${appointmentId}, ${meetingId}, ${userId}, ${by}, ${suggestion}) on conflict do nothing`;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${userId}, 'appointments.meeting_linked', ${db.json({ locationId, appointmentId, meetingId, by } as never)})`.catch(() => undefined);
  return true;
}

/** The person's own linked call for one appointment (nothing for anyone else's). */
export async function ownMeetingFor(installationId: string, userId: string, locationId: string, appointmentId: string): Promise<(MeetingRow & { outcomeConfirmed: boolean; suggested: string | null }) | null> {
  const [r] = await sql()`select m.id, m.title, m.started_at, m.summary, m.action_items, m.recording_url, m.attendee_emails, l.suggested_outcome, l.outcome_confirmed_at
    from appointment_meeting_links l join meetings m on m.id = l.meeting_id and m.installation_id = l.installation_id
    where l.installation_id = ${installationId} and l.location_id = ${locationId} and l.appointment_id = ${appointmentId} and m.owner_ghl_user_id = ${userId} order by m.started_at desc limit 1`.catch(() => []);
  return r ? { ...meetingOf(r), outcomeConfirmed: r.outcome_confirmed_at != null, suggested: (r.suggested_outcome as string | null) ?? null } : null;
}

export async function confirmOutcomeMark(installationId: string, userId: string, locationId: string, appointmentId: string): Promise<void> {
  await sql()`update appointment_meeting_links set outcome_confirmed_at = now() where installation_id = ${installationId} and location_id = ${locationId} and appointment_id = ${appointmentId} and owner_ghl_user_id = ${userId}`.catch(() => undefined);
}

/** "Meeting held, no follow-up in 2 days": the person's linked calls that started 2 to 30 days ago where nobody on the account has sent that contact anything (outside automatic messages) since. */
export async function noFollowUp(installationId: string, userId: string, allowed: string[] | null, page: number, size: number) {
  const db = sql();
  const where = db`l.installation_id = ${installationId} and l.owner_ghl_user_id = ${userId} ${allowed ? db`and l.location_id = any(${allowed}::text[])` : db``}
    and m.started_at < now() - interval '2 days' and m.started_at > now() - interval '30 days'
    and not exists (select 1 from touch_events t where t.installation_id = a.installation_id and t.location_id = a.location_id and t.contact_id = a.contact_id and t.direction = 'outbound' and not t.automated and t.at > m.started_at)`;
  const from = db`appointment_meeting_links l join meetings m on m.id = l.meeting_id and m.installation_id = l.installation_id
    join cached_appointments a on a.installation_id = l.installation_id and a.location_id = l.location_id and a.appointment_id = l.appointment_id
    left join cached_contacts ct on ct.installation_id = a.installation_id and ct.location_id = a.location_id and ct.contact_id = a.contact_id`;
  const [tot] = await db`select count(*)::int n from ${from} where ${where}`.catch(() => [{ n: 0 }]);
  const rows = await db`select a.appointment_id, a.location_id, a.contact_id, m.id meeting_id, m.started_at, m.action_items, coalesce(nullif(btrim(ct.full_name), ''), 'Contact') name from ${from} where ${where} order by m.started_at asc limit ${size} offset ${page * size}`.catch(() => []);
  return {
    total: Number(tot?.n ?? 0), page, size,
    rows: rows.map((r) => ({ appointmentId: r.appointment_id as string, locationId: r.location_id as string, contactId: (r.contact_id as string | null) ?? null, meetingId: r.meeting_id as string, startedAt: iso(r.started_at), name: r.name as string, nextStep: nextStepOf(strings(r.action_items)), daysAgo: Math.floor((Date.now() - Date.parse(iso(r.started_at) ?? "")) / DAY) })),
  };
}

export async function homeCounts(installationId: string, userId: string, allowed: string[] | null) {
  const db = sql();
  const [linked] = await db`select count(*)::int n from appointment_meeting_links l where l.installation_id = ${installationId} and l.owner_ghl_user_id = ${userId} ${allowed ? db`and l.location_id = any(${allowed}::text[])` : db``}`.catch(() => [{ n: 0 }]);
  const wait = await needsMatching(installationId, userId, allowed, 0, 1).catch(() => ({ total: 0 }));
  const gap = await noFollowUp(installationId, userId, allowed, 0, 1);
  return { linked: Number(linked?.n ?? 0), needsMatching: wait.total, noFollowUp: gap.total };
}

export { plausible };
