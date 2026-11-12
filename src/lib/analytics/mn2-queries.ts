import { sql } from "../db";
import { callStatus, coachRows, encodeCursor, likeOf, nextStep, outcomeState, outcomeWords, type CoachCall, type CoachRow, type FollowKind, type ListQuery } from "./mn2";

// The data behind the Meeting notes list, detail, follow-up lists and coaching view. A recorded call is PRIVATE to the person whose tool recorded it (rule 12): every read of a call
// names the installation AND the person's own user id in SQL, so no id sent by a browser can reach another person's call. The only thing an administrator reads about other people's
// calls is the coaching view, which is counts and averages and never a title, a summary, an attendee or a link. A contact or account shown on a row is shown only when it is inside
// `allowed` (the accounts the person may open); anything else is left out of the row.

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const DAY = 86_400_000;
const LIVE = ["saved", "needs_contact", "dry_run", "failed"];

export type CallRow = {
  id: string; title: string | null; startedAt: string | null; at: string; statusKey: string; statusLabel: string; minutes: number | null; attendees: number; items: number; hasSummary: boolean; hasRecording: boolean;
  locationId: string | null; locationName: string | null; contactId: string | null; contactName: string | null;
  outcome: { state: string; words: string; suggested: string | null; appointmentId: string | null }; followed: boolean | null;
};

const inList = (allowed: string[] | null, id: string | null) => (id !== null && (allowed === null || allowed.includes(id)) ? id : null);

/** One page of the person's own calls, newest first, with every filter. `allowed` is the accounts the person may open (null: every account of the company). */
export async function listCalls(installationId: string, userId: string, q: ListQuery, allowed: string[] | null): Promise<{ rows: CallRow[]; total: number; next: string | null }> {
  const db = sql();
  const accounts = q.accounts.length ? q.accounts : null;
  // A contact or account belongs to a row only when it is inside the accounts the person may open (so a matched id that points elsewhere is simply not there, in the filters too).
  const ok = allowed === null ? db`true` : db`r.loc0 = any(${allowed}::text[])`;
  const base = db`
    select m.id, m.title, m.started_at, coalesce(m.started_at, m.created_at) at, m.status, m.reason, m.duration_minutes, m.recording_url is not null has_rec, m.summary is not null has_sum,
      jsonb_array_length(m.attendee_emails) attendees, jsonb_array_length(m.action_items) items, m.attendee_emails,
      coalesce(m.matched_location_id, a.location_id) loc0, coalesce(m.matched_contact_id, a.contact_id) contact0,
      l.suggested_outcome, l.outcome_confirmed_at, l.appointment_id
    from meetings m
    left join lateral (select x.* from appointment_meeting_links x where x.installation_id = m.installation_id and x.meeting_id = m.id order by x.created_at limit 1) l on true
    left join cached_appointments a on a.installation_id = l.installation_id and a.location_id = l.location_id and a.appointment_id = l.appointment_id
    where m.installation_id = ${installationId} and m.owner_ghl_user_id = ${userId} and m.status = any(${LIVE}::text[])`;
  const filt = db`
    ${accounts ? db`and c.loc = any(${accounts}::text[])` : db``}
    ${q.state === "matched" ? db`and c.contact is not null` : q.state === "needs" ? db`and c.contact is null` : db``}
    ${q.outcome === "confirmed" ? db`and c.outcome_confirmed_at is not null` : q.outcome === "to_confirm" ? db`and c.outcome_confirmed_at is null and c.suggested_outcome is not null` : q.outcome === "none" ? db`and c.appointment_id is null` : db``}
    ${q.from ? db`and c.at >= ${q.from}::date` : db``} ${q.to ? db`and c.at < (${q.to}::date + 1)` : db``}
    ${q.q ? db`and (lower(coalesce(c.title, '')) like ${likeOf(q.q)} escape '\\' or lower(c.attendee_emails::text) like ${likeOf(q.q)} escape '\\'
       or lower(coalesce((select ct.full_name from cached_contacts ct where ct.installation_id = ${installationId} and ct.location_id = c.loc and ct.contact_id = c.contact), '')) like ${likeOf(q.q)} escape '\\')` : db``}
    ${q.follow === "has" ? db`and c.contact is not null and exists (select 1 from touch_events t where t.installation_id = ${installationId} and t.location_id = c.loc and t.contact_id = c.contact and t.direction = 'outbound' and not t.automated and t.at > c.at)` : q.follow === "none" ? db`and c.contact is not null and not exists (select 1 from touch_events t where t.installation_id = ${installationId} and t.location_id = c.loc and t.contact_id = c.contact and t.direction = 'outbound' and not t.automated and t.at > c.at)` : db``}`;
  const cursor = q.cursor ? db`and (c.at, c.id) < (${q.cursor.at}::timestamptz, ${q.cursor.id}::uuid)` : db``;
  const [rows, tot] = await Promise.all([
    db`with r as (${base}), c as (select r.*, case when ${ok} then r.loc0 end loc, case when ${ok} then r.contact0 end contact from r) select c.*, ct.full_name contact_name, lo.name location_name,
         case when c.contact is null then null else exists (select 1 from touch_events t where t.installation_id = ${installationId} and t.location_id = c.loc and t.contact_id = c.contact and t.direction = 'outbound' and not t.automated and t.at > c.at) end followed
       from c left join cached_contacts ct on ct.installation_id = ${installationId} and ct.location_id = c.loc and ct.contact_id = c.contact
       left join locations lo on lo.installation_id = ${installationId} and lo.location_id = c.loc
       where true ${filt} ${cursor} order by c.at desc, c.id desc limit ${q.limit + 1}`,
    db`with r as (${base}), c as (select r.*, case when ${ok} then r.loc0 end loc, case when ${ok} then r.contact0 end contact from r) select count(*)::int n from c where true ${filt}`,
  ]);
  const page = rows.slice(0, q.limit);
  const out: CallRow[] = page.map((r) => {
    const loc = inList(allowed, (r.loc as string | null) ?? null);
    const contact = loc ? ((r.contact as string | null) ?? null) : null;
    const st = callStatus({ status: r.status as string, reason: (r.reason as string | null) ?? null, matched: contact !== null });
    const oc = outcomeState(r.appointment_id ? { suggested: (r.suggested_outcome as string | null) ?? null, confirmedAt: iso(r.outcome_confirmed_at) } : null);
    return {
      id: r.id as string, title: (r.title as string | null) ?? null, startedAt: iso(r.started_at), at: iso(r.at) as string, statusKey: st.key, statusLabel: st.label, minutes: (r.duration_minutes as number | null) ?? null,
      attendees: r.attendees as number, items: r.items as number, hasSummary: r.has_sum === true, hasRecording: r.has_rec === true,
      locationId: loc, locationName: loc ? ((r.location_name as string | null) ?? "Unnamed account") : null, contactId: contact, contactName: contact ? ((r.contact_name as string | null) ?? "Contact") : null,
      outcome: { state: oc, words: outcomeWords(oc, (r.suggested_outcome as string | null) ?? null), suggested: (r.suggested_outcome as string | null) ?? null, appointmentId: (r.appointment_id as string | null) ?? null },
      followed: contact ? (r.followed as boolean | null) : null,
    };
  });
  const last = page[page.length - 1];
  return { rows: out, total: Number(tot[0]?.n ?? 0), next: rows.length > q.limit && last ? encodeCursor({ at: iso(last.at) as string, id: last.id as string }) : null };
}

export type CallDetail = {
  provider: string; noteAddedAt: string | null;
  id: string; title: string | null; startedAt: string | null; minutes: number | null; talkPct: number | null; statusKey: string; statusLabel: string; reason: string | null;
  attendees: string[]; summary: string | null; actionItems: string[]; recordingUrl: string | null; expiresAt: string | null;
  locationId: string | null; locationName: string | null; contactId: string | null; contactName: string | null;
  appointment: { id: string; startAt: string | null; status: string | null; calendar: string | null } | null;
  outcome: { state: string; words: string; suggested: string | null };
  tasks: Array<{ itemNo: number; status: string }>; nextStep: string | null;
  /** The contact's biggest open deal (name, value, stage), when the call is on a contact. */
  deal: { name: string | null; value: number | null; stage: string | null } | null;
};

/** One of the person's own calls, in full. Null when it is not theirs (the same answer as "no such call"). */
export async function callDetail(installationId: string, userId: string, id: string, allowed: string[] | null): Promise<CallDetail | null> {
  const db = sql();
  const [r] = await db`
    select m.id, m.provider, m.title, m.started_at, m.duration_minutes, m.talk_pct, m.status, m.reason, m.attendee_emails, m.summary, m.action_items, m.recording_url, m.expires_at,
      coalesce(m.matched_location_id, a.location_id) loc, coalesce(m.matched_contact_id, a.contact_id) contact,
      l.suggested_outcome, l.outcome_confirmed_at, l.appointment_id, a.start_at a_start, a.status a_status, a.calendar_name a_cal
    from meetings m
    left join lateral (select x.* from appointment_meeting_links x where x.installation_id = m.installation_id and x.meeting_id = m.id order by x.created_at limit 1) l on true
    left join cached_appointments a on a.installation_id = l.installation_id and a.location_id = l.location_id and a.appointment_id = l.appointment_id
    where m.id = ${id} and m.installation_id = ${installationId} and m.owner_ghl_user_id = ${userId} and m.status = any(${LIVE}::text[])`;
  if (!r) return null;
  const loc = inList(allowed, (r.loc as string | null) ?? null);
  const contactId = loc ? ((r.contact as string | null) ?? null) : null;
  const [c] = contactId ? await db`select full_name from cached_contacts where installation_id = ${installationId} and location_id = ${loc} and contact_id = ${contactId}` : [];
  const [lo] = loc ? await db`select name from locations where installation_id = ${installationId} and location_id = ${loc}` : [];
  const [dl] = contactId ? await db`select name, monetary_value, stage_name from cached_opportunities where installation_id = ${installationId} and location_id = ${loc} and contact_id = ${contactId} and status = 'open' order by monetary_value desc nulls last limit 1`.catch(() => []) : [];
  const tasks = await db`select item_no, status from mn_tasks where installation_id = ${installationId} and owner_ghl_user_id = ${userId} and meeting_id = ${id} and status <> 'undone' order by item_no`.catch(() => []);
  const items = strings(r.action_items);
  // The note SubSync added for this call (our own write, logged so it never counts as a reply): when it was added, never what it said.
  const [nw] = contactId ? await db`select created_at from crm_writes where installation_id = ${installationId} and meeting_id = ${id} and kind = 'note' and undone_at is null order by created_at limit 1`.catch(() => []) : [];
  const st = callStatus({ status: r.status as string, reason: (r.reason as string | null) ?? null, matched: contactId !== null });
  const oc = outcomeState(r.appointment_id ? { suggested: (r.suggested_outcome as string | null) ?? null, confirmedAt: iso(r.outcome_confirmed_at) } : null);
  return {
    provider: r.provider as string, noteAddedAt: iso(nw?.created_at),
    id, title: (r.title as string | null) ?? null, startedAt: iso(r.started_at), minutes: (r.duration_minutes as number | null) ?? null, talkPct: (r.talk_pct as number | null) ?? null,
    statusKey: st.key, statusLabel: st.label, reason: (r.reason as string | null) ?? null, attendees: strings(r.attendee_emails), summary: (r.summary as string | null) ?? null, actionItems: items,
    recordingUrl: (r.recording_url as string | null) ?? null, expiresAt: iso(r.expires_at), locationId: loc, locationName: loc ? ((lo?.name as string | null) ?? "Unnamed account") : null,
    contactId, contactName: contactId ? ((c?.full_name as string | null) ?? "Contact") : null,
    appointment: loc && r.appointment_id ? { id: r.appointment_id as string, startAt: iso(r.a_start), status: (r.a_status as string | null) ?? null, calendar: (r.a_cal as string | null) ?? null } : null,
    outcome: { state: oc, words: outcomeWords(oc, (r.suggested_outcome as string | null) ?? null), suggested: (r.suggested_outcome as string | null) ?? null },
    tasks: tasks.map((t) => ({ itemNo: t.item_no as number, status: t.status as string })), nextStep: nextStep(items),
    deal: dl ? { name: (dl.name as string | null) ?? null, value: dl.monetary_value === null || dl.monetary_value === undefined ? null : Number(dl.monetary_value), stage: (dl.stage_name as string | null) ?? null } : null,
  };
}

/** Contacts whose email is exactly one of the call's attendees, in the accounts the person may open. Used for the one-click match: a single answer is "certain", several are never guessed between. */
export async function exactContacts(installationId: string, emails: readonly string[], accounts: readonly string[]): Promise<Array<{ locationId: string; locationName: string; contactId: string; name: string; email: string }>> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  if (list.length === 0 || accounts.length === 0) return [];
  const rows = await sql()`
    select c.location_id, c.contact_id, lower(c.email) email, coalesce(nullif(btrim(c.full_name), ''), c.email) name, coalesce(l.name, 'Unnamed account') location_name
    from cached_contacts c left join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id
    where c.installation_id = ${installationId} and c.location_id = any(${accounts as string[]}::text[]) and lower(c.email) = any(${list}::text[]) order by c.full_name nulls last limit 6`;
  return rows.map((r) => ({ locationId: r.location_id as string, locationName: r.location_name as string, contactId: r.contact_id as string, name: r.name as string, email: r.email as string }));
}

/** The call's contact, as the one place a task may go: the call must be the person's own, matched with certainty and inside the accounts the person may open. */
export async function taskTarget(installationId: string, userId: string, id: string, allowed: string[] | null): Promise<{ locationId: string; contactId: string; startedAt: string | null; items: string[]; companyId: string } | null> {
  const d = await callDetail(installationId, userId, id, allowed);
  if (!d || !d.locationId || !d.contactId) return null;
  const [i] = await sql()`select company_id from installations where id = ${installationId}`;
  return i ? { locationId: d.locationId, contactId: d.contactId, startedAt: d.startedAt, items: d.actionItems, companyId: i.company_id as string } : null;
}

export async function tasksDoneToday(installationId: string, userId: string): Promise<number> {
  const [r] = await sql()`select count(*)::int n from mn_tasks where installation_id = ${installationId} and owner_ghl_user_id = ${userId} and created_at >= date_trunc('day', now()) and status in ('saved', 'dry_run')`;
  return Number(r?.n ?? 0);
}

/** Takes the right to make one task (a row per call and item), so the same item is never made twice, even from two taps at once. */
export async function claimTask(installationId: string, userId: string, meetingId: string, itemNo: number, locationId: string, contactId: string): Promise<string | null> {
  const db = sql();
  const fresh = await db`insert into mn_tasks (installation_id, owner_ghl_user_id, meeting_id, item_no, location_id, contact_id) values (${installationId}, ${userId}, ${meetingId}, ${itemNo}, ${locationId}, ${contactId}) on conflict (meeting_id, item_no) do nothing returning id`;
  if (fresh.length === 1) return fresh[0].id as string;
  // A refused, unauthorised or undone try may be made again; anything else is the same tap seen twice.
  const again = await db`update mn_tasks set status = 'pending', ghl_task_id = null, undone_at = null where meeting_id = ${meetingId} and item_no = ${itemNo} and installation_id = ${installationId} and owner_ghl_user_id = ${userId} and status in ('failed', 'needs_permission', 'undone') returning id`;
  return again.length === 1 ? (again[0].id as string) : null;
}
export async function finishTask(id: string, status: "saved" | "dry_run" | "failed" | "needs_permission", ghlId: string | null): Promise<void> {
  await sql()`update mn_tasks set status = ${status}, ghl_task_id = ${ghlId} where id = ${id}`;
}
export async function undoableTasks(installationId: string, userId: string, meetingId: string): Promise<Array<{ id: string; itemNo: number; ghlId: string | null; status: string }>> {
  const rows = await sql()`select id, item_no, ghl_task_id, status from mn_tasks where installation_id = ${installationId} and owner_ghl_user_id = ${userId} and meeting_id = ${meetingId} and status in ('saved', 'dry_run') and created_at > now() - interval '60 minutes'`;
  return rows.map((r) => ({ id: r.id as string, itemNo: r.item_no as number, ghlId: (r.ghl_task_id as string | null) ?? null, status: r.status as string }));
}
export async function markTaskUndone(id: string): Promise<void> { await sql()`update mn_tasks set status = 'undone', undone_at = now() where id = ${id}`; }

// ---------------- follow-up lists ----------------

export type FollowRow = { meetingId: string; title: string | null; startedAt: string; daysAgo: number; locationId: string; locationName: string; contactId: string; contactName: string; nextStep: string | null; deal: { name: string | null; value: number | null } | null };

/**
 * The three lists of "held, and then nothing happened", for the person's own calls whose contact is known and inside `allowed`:
 *   no_followup     held 2 to 30 days ago and nobody has sent that contact a person-made message or call since
 *   no_next_step    held in the last 30 days with no action item and no task made from it
 *   deal_not_moved  held 7 to 45 days ago and the contact's open deal has not changed stage since
 */
export async function followRows(installationId: string, userId: string, allowed: string[] | null, kind: FollowKind, cursor: { at: string; id: string } | null, limit: number): Promise<{ rows: FollowRow[]; total: number; next: string | null }> {
  const db = sql();
  const accounts = allowed;
  const days = kind === "no_followup" ? [2, 30] : kind === "no_next_step" ? [0, 30] : [7, 45];
  const base = db`
    select m.id, m.title, coalesce(m.started_at, m.created_at) at, m.action_items, coalesce(m.matched_location_id, a.location_id) loc, coalesce(m.matched_contact_id, a.contact_id) contact
    from meetings m
    left join lateral (select x.* from appointment_meeting_links x where x.installation_id = m.installation_id and x.meeting_id = m.id order by x.created_at limit 1) l on true
    left join cached_appointments a on a.installation_id = l.installation_id and a.location_id = l.location_id and a.appointment_id = l.appointment_id
    where m.installation_id = ${installationId} and m.owner_ghl_user_id = ${userId} and m.status = any(${LIVE}::text[])
      and coalesce(m.started_at, m.created_at) <= now() - ${days[0] * DAY / 1000}::int * interval '1 second' and coalesce(m.started_at, m.created_at) > now() - ${days[1] * DAY / 1000}::int * interval '1 second'`;
  const cond = kind === "no_followup"
    ? db`and c.contact is not null and not exists (select 1 from touch_events t where t.installation_id = ${installationId} and t.location_id = c.loc and t.contact_id = c.contact and t.direction = 'outbound' and not t.automated and t.at > c.at)`
    : kind === "no_next_step"
      ? db`and jsonb_array_length(c.action_items) = 0 and not exists (select 1 from mn_tasks k where k.meeting_id = c.id and k.status in ('saved', 'dry_run'))`
      : db`and c.contact is not null and exists (select 1 from cached_opportunities o where o.installation_id = ${installationId} and o.location_id = c.loc and o.contact_id = c.contact and o.status = 'open' and coalesce(o.last_stage_change_at, 'epoch'::timestamptz) < c.at)
          and not exists (select 1 from cached_opportunities o where o.installation_id = ${installationId} and o.location_id = c.loc and o.contact_id = c.contact and o.last_stage_change_at >= c.at)`;
  const scope = accounts ? db`and c.loc = any(${accounts}::text[])` : db`and c.loc is not null`;
  const cur = cursor ? db`and (c.at, c.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : db``;
  const [rows, tot] = await Promise.all([
    db`with c as (${base}) select c.id, c.title, c.at, c.action_items, c.loc, c.contact, ct.full_name, lo.name location_name,
         (select jsonb_build_object('name', o.name, 'value', o.monetary_value) from cached_opportunities o where o.installation_id = ${installationId} and o.location_id = c.loc and o.contact_id = c.contact and o.status = 'open' order by o.monetary_value desc nulls last limit 1) deal
       from c left join cached_contacts ct on ct.installation_id = ${installationId} and ct.location_id = c.loc and ct.contact_id = c.contact
       left join locations lo on lo.installation_id = ${installationId} and lo.location_id = c.loc
       where true ${cond} ${scope} ${cur} order by c.at desc, c.id desc limit ${limit + 1}`,
    db`with c as (${base}) select count(*)::int n from c where true ${cond} ${scope}`,
  ]);
  const page = rows.slice(0, limit);
  const now = Date.now();
  const out: FollowRow[] = page.map((r) => {
    const d = r.deal as { name: string | null; value: number | null } | null;
    return {
      meetingId: r.id as string, title: (r.title as string | null) ?? null, startedAt: iso(r.at) as string, daysAgo: Math.floor((now - Date.parse(iso(r.at) as string)) / DAY),
      locationId: (r.loc as string | null) ?? "", locationName: (r.location_name as string | null) ?? "Unnamed account", contactId: (r.contact as string | null) ?? "",
      contactName: r.contact ? ((r.full_name as string | null) ?? "Contact") : "", nextStep: nextStep(strings(r.action_items)),
      deal: kind === "deal_not_moved" && d ? { name: d.name ?? null, value: d.value === null || d.value === undefined ? null : Number(d.value) } : null,
    };
  });
  const last = page[page.length - 1];
  return { rows: out, total: Number(tot[0]?.n ?? 0), next: rows.length > limit && last ? encodeCursor({ at: iso(last.at) as string, id: last.id as string }) : null };
}

export async function followCounts(installationId: string, userId: string, allowed: string[] | null): Promise<Record<FollowKind, number>> {
  const kinds: FollowKind[] = ["no_followup", "no_next_step", "deal_not_moved"];
  const got = await Promise.all(kinds.map((k) => followRows(installationId, userId, allowed, k, null, 1).then((r) => r.total).catch(() => 0)));
  return { no_followup: got[0], no_next_step: got[1], deal_not_moved: got[2] };
}

// ---------------- coaching ----------------

/** One row per person in `owners` (null: everyone in the company): calls of the last 90 days reduced to numbers. Nothing here selects a title, a summary, an attendee, a link or a contact. */
export async function coachCalls(installationId: string, owners: string[] | null): Promise<CoachCall[]> {
  if (owners !== null && owners.length === 0) return [];
  const db = sql();
  const rows = await db`
    select m.owner_ghl_user_id owner, m.duration_minutes minutes, m.talk_pct, (jsonb_array_length(m.action_items) > 0) has_next, coalesce(m.matched_contact_id, a.contact_id) is not null matched,
      (lower(coalesce(a.status, '')) in ('showed', 'completed')) showed,
      exists (select 1 from cached_opportunities o where o.installation_id = m.installation_id and o.location_id = coalesce(m.matched_location_id, a.location_id) and o.contact_id = coalesce(m.matched_contact_id, a.contact_id)
        and o.status = 'won' and o.last_status_change_at > coalesce(m.started_at, m.created_at) and o.last_status_change_at <= coalesce(m.started_at, m.created_at) + interval '30 days') won
    from meetings m
    left join lateral (select x.* from appointment_meeting_links x where x.installation_id = m.installation_id and x.meeting_id = m.id order by x.created_at limit 1) l on true
    left join cached_appointments a on a.installation_id = l.installation_id and a.location_id = l.location_id and a.appointment_id = l.appointment_id
    where m.installation_id = ${installationId} and m.status = any(${LIVE}::text[]) and coalesce(m.started_at, m.created_at) >= now() - interval '90 days'
      ${owners ? db`and m.owner_ghl_user_id = any(${owners}::text[])` : db``} order by coalesce(m.started_at, m.created_at) desc limit 20000`;
  return rows.map((r) => ({ owner: r.owner as string, minutes: (r.minutes as number | null) ?? null, talkPct: (r.talk_pct as number | null) ?? null, hasNextStep: r.has_next === true, matched: r.matched === true, showed: r.showed === true, won: r.won === true }));
}

/** The role label the Team page gave each person (Setter, Closer...): the label for everywhere when there is one, else the one for an account. */
export async function roleLabels(installationId: string, owners: string[]): Promise<Map<string, string>> {
  if (owners.length === 0) return new Map();
  const rows = await sql()`select user_id, role, location_id from team_member_roles where installation_id = ${installationId} and user_id = any(${owners}::text[]) order by (location_id = '') desc`.catch(() => []);
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.user_id as string) || r.location_id === '') out.set(r.user_id as string, r.role as string);
  return out;
}

export type { CoachRow };
export { coachRows };

/** The people with a connected Fathom whose home account an administrator's scope covers, as the coaching view's list of who counts. Ids stay on the server. */
export async function connectedPeople(installationId: string): Promise<Array<{ owner: string; name: string | null; homeLocationId: string | null }>> {
  const rows = await sql()`select distinct on (ghl_user_id) ghl_user_id, person_name, home_location_id from user_connections where installation_id = ${installationId} and provider = 'fathom' and status = 'connected' order by ghl_user_id, updated_at desc`;
  return rows.map((r) => ({ owner: r.ghl_user_id as string, name: (r.person_name as string | null) ?? null, homeLocationId: (r.home_location_id as string | null) ?? null }));
}

/** This week's counts for the proof receipt and Today: calls held in the last 7 days, how many are on a contact, how many have no next step, how many wait to be matched. Counts only. */
/** With `ownerUserId` only that person's own calls are counted, the same calls the Meetings list shows. The window starts at the first moment of the day 7 days ago, so the list can use the same two dates. */
export async function weekCounts(installationId: string, accounts: string[] | null, ownerUserId: string | null = null): Promise<{ held: number; logged: number; noNextStep: number; waiting: number }> {
  const db = sql();
  const [r] = await db`
    select count(*)::int held, (count(*) filter (where m.status in ('saved', 'dry_run')))::int logged, (count(*) filter (where jsonb_array_length(m.action_items) = 0))::int no_next,
      (count(*) filter (where m.status = 'needs_contact' and m.matched_contact_id is null))::int waiting
    from meetings m where m.installation_id = ${installationId} and m.status = any(${LIVE}::text[]) and coalesce(m.started_at, m.created_at) >= (now() - interval '7 days')::date
      ${ownerUserId ? db`and m.owner_ghl_user_id = ${ownerUserId}` : db``}
      ${accounts ? db`and (m.matched_location_id = any(${accounts}::text[]) or m.owner_ghl_user_id in (select u.ghl_user_id from user_connections u where u.installation_id = ${installationId} and u.provider = 'fathom' and u.home_location_id = any(${accounts}::text[])))` : db``}`.catch(() => [undefined]);
  return { held: Number(r?.held ?? 0), logged: Number(r?.logged ?? 0), noNextStep: Number(r?.no_next ?? 0), waiting: Number(r?.waiting ?? 0) };
}

/** The same counts for a window (a receipt's week), one row per client account that has a call matched to it. Only calls matched with certainty count, so a call is never counted for the wrong client. */
export async function weekCountsByAccount(installationId: string, accounts: string[], from: Date, to: Date): Promise<Map<string, { held: number; logged: number; noNextStep: number }>> {
  if (accounts.length === 0) return new Map();
  const rows = await sql()`
    select m.matched_location_id loc, count(*)::int held, (count(*) filter (where m.status in ('saved', 'dry_run')))::int logged, (count(*) filter (where jsonb_array_length(m.action_items) = 0))::int no_next
    from meetings m where m.installation_id = ${installationId} and m.status = any(${LIVE}::text[]) and m.matched_location_id = any(${accounts}::text[])
      and coalesce(m.started_at, m.created_at) >= ${from} and coalesce(m.started_at, m.created_at) < ${to} group by 1`.catch(() => []);
  return new Map(rows.map((r) => [r.loc as string, { held: r.held as number, logged: r.logged as number, noNextStep: r.no_next as number }]));
}

/** Is the Meetings list switched on for this company? The receipt gets its meetings line only then (flags default off). */
export async function meetingsOn(installationId: string): Promise<boolean> {
  try {
    const [r] = await sql()`select plan from installations where id = ${installationId}`;
    const { resolveEntitlements } = await import("../flags");
    const ent = await resolveEntitlements((r?.plan as "free" | "starter" | "pro" | undefined) ?? "pro", installationId);
    return ent.features.mn_list === true && !ent.locked.includes("mn_list");
  } catch { return false; }
}
