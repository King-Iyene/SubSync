import { properName } from "../people/names.ts";
import { sql } from "../db";
import { changedLine, changedSince, mergeTimeline, noShowToRebook, personHeadline, spanWords, type Headline, type PersonFacts, type TimelineItem } from "../people/person";
import { channelLabel, waitingState } from "./waiting";
import { isNeverAnswered } from "./speed-intel";
import { countedInScope, dealScopeJoins, outOfScope } from "./stage-rules-sql";

// Everything the lead panel knows about ONE person from SubSync's own copy and its event store (stage PEOPLE): the facts for the headline, the open deals, the tags with
// the day SubSync first saw each, and a timeline of what happened (contact added, first reply, last message, calls logged in SubSync, appointments and their status
// changes, deal stage moves, tags added and removed). Read only. The account is checked against `allowed` first, in the query itself, so a person outside the
// caller's accounts answers "not found" and nothing about them is read. The live read of custom fields and the CRM's own calls is done by the route (it needs the
// account's token) and is not stored.

const DAY = 86_400_000;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const dayLabel = (t: string) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const timeLabel = (t: string) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });

const OUTCOME_WORDS: Record<string, string> = { answered: "Answered", voicemail: "Voicemail", no_answer: "No answer", wrong_number: "Wrong number", booked: "Booked", not_interested: "Not interested", follow_up: "Follow up" };
const APPT_WORDS: Record<string, string> = { showed: "Showed", noshow: "No-show", confirmed: "Confirmed", cancelled: "Cancelled", booked: "Booked", new: "Booked", invalid: "Invalid" };
const apptWord = (s: string | null) => (s ? APPT_WORDS[s] ?? s.charAt(0).toUpperCase() + s.slice(1) : "No outcome marked");

export type DealOut = { id: string; name: string | null; status: string; value: number; stage: string | null; stale: boolean };

export type PersonDetail = {
  contact: {
    contactId: string; locationId: string; locationName: string | null; name: string; email: string | null; phone: string | null; tags: string[]; source: string | null; dnd: boolean;
    lastActivityAt: string | null; dateAdded: string | null; owner: string | null; timeZone: string | null;
  };
  deals: DealOut[];
  unread: number;
  tagDates: Record<string, string>;
  /** Tags whose date is the exact time (SubSync applied it) rather than the day SubSync first saw it. */
  tagExact: Record<string, boolean>;
  watchingSince: string | null;
  appointments: Array<{ at: string; status: string | null }>;
  loggedCalls: Array<{ at: string; outcome: string; note: string | null }>;
  timeline: TimelineItem[];
  headline: Headline;
  /** The conversation to read messages and calls from (live), when there is one. Used by the route, never sent to the browser. */
  conversationId: string | null;
};

/** Deals in play and stale for the headline: the same "counted deal" and staleness rule as Today's stale deals (value above zero, an owner, in play, no movement for `staleDays`). */
export async function personDetail(a: { installationId: string; allowed: string[] | null; locationId: string; contactId: string; staleDays: number; nowMs: number; label: (id: string | null | undefined) => string }): Promise<PersonDetail | null> {
  if (a.allowed && !a.allowed.includes(a.locationId)) return null;
  const db = sql();
  const { installationId: inst, locationId: loc, contactId: id } = a;
  const [[c], deals, [convo], touches, appts, apptEvents, calls, tagEvents, dealEvents, stages] = await Promise.all([
    db`select c.contact_id, c.location_id, l.name location_name, l.timezone, coalesce(nullif(c.full_name, ''), nullif(c.email, ''), 'Unnamed contact') name, c.email, c.phone, c.tags, c.source, c.dnd,
        c.date_added, c.last_activity_at, nullif(c.assigned_to, '') owner
       from cached_contacts c join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
       where c.installation_id = ${inst} and c.location_id = ${loc} and c.contact_id = ${id}`,
    db`select o.opportunity_id id, o.name, o.status, o.monetary_value::float8 value, sc_st.nm stage_name, o.created_remote_at, o.last_status_change_at,
        coalesce(greatest(o.last_stage_change_at, o.last_action_at, o.updated_remote_at, o.last_status_change_at), o.created_remote_at, o.synced_at) act,
        (o.status = 'open' and not ${outOfScope()}) in_play, (o.status = 'open' and ${countedInScope()}) counted
       from cached_opportunities o ${dealScopeJoins()}
       where o.installation_id = ${inst} and o.location_id = ${loc} and o.contact_id = ${id} order by o.created_remote_at desc nulls last limit 30`,
    db`select conversation_id, last_message_type, last_message_direction, last_message_at, unread_count from cached_conversations
       where installation_id = ${inst} and location_id = ${loc} and contact_id = ${id} order by last_message_at desc nulls last limit 1`,
    db`select lead_at, touch_at, touch_user_id, excluded from lead_touches where installation_id = ${inst} and location_id = ${loc} and contact_id = ${id} order by lead_at desc limit 3`,
    db`select appointment_id, start_at, status, title from cached_appointments where installation_id = ${inst} and location_id = ${loc} and contact_id = ${id} order by start_at desc nulls last limit 12`,
    db`select e.occurred_at, e.to_value, a.start_at from appointment_events e
       join cached_appointments a on a.installation_id = e.installation_id and a.location_id = e.location_id and a.appointment_id = e.appointment_id
       where a.installation_id = ${inst} and a.location_id = ${loc} and a.contact_id = ${id} and e.kind = 'status' and e.to_value is not null order by e.occurred_at desc limit 20`,
    db`select created_at, outcome, note, follow_up_at from call_outcomes where installation_id = ${inst} and location_id = ${loc} and contact_id = ${id} order by created_at desc limit 20`,
    db`select at, kind, tag, exact from contact_tag_events where installation_id = ${inst} and location_id = ${loc} and contact_id = ${id} order by at desc limit 60`,
    db`select e.at, e.kind, e.from_value, e.to_value, o.name deal_name from deal_events e
       join cached_opportunities o on o.installation_id = e.installation_id and o.location_id = e.location_id and o.opportunity_id = e.opportunity_id
       where e.installation_id = ${inst} and e.location_id = ${loc} and o.contact_id = ${id} order by e.at desc limit 30`,
    db`select stages from pipelines where installation_id = ${inst} and location_id = ${loc}`,
  ]);
  if (!c) return null;
  const now = a.nowMs;
  const stageName = new Map<string, string>();
  for (const p of stages) for (const s of (p.stages as Array<{ id: string; name: string }> | null) ?? []) stageName.set(s.id, s.name);

  // ---- tags: the day SubSync first saw each tag added (the CRM does not say) ----
  const tagDates: Record<string, string> = {};
  const tagExact: Record<string, boolean> = {};
  for (const e of [...tagEvents].reverse()) if (e.kind === "added") { tagDates[e.tag as string] = iso(e.at) as string; tagExact[e.tag as string] = e.exact === true; }
  const [since] = await db`select min(at) at from contact_tag_events where installation_id = ${inst} ${a.allowed ? db`and location_id = any(${a.allowed}::text[])` : db``}`;

  // ---- deals ----
  const dealsOut: DealOut[] = deals.map((d) => ({
    id: d.id as string, name: (d.name as string | null) ?? null, status: d.status as string, value: Number(d.value ?? 0), stage: (d.stage_name as string | null) ?? null,
    stale: d.counted === true && ms(d.act) !== null && now - (ms(d.act) as number) > a.staleDays * DAY,
  }));
  const inPlay = deals.filter((d) => d.in_play === true);
  const counted = deals.filter((d) => d.counted === true);
  const staleDeals = counted.filter((d) => ms(d.act) !== null && now - (ms(d.act) as number) > a.staleDays * DAY);
  const biggest = [...counted].sort((x, y) => Number(y.value) - Number(x.value))[0] ?? inPlay[0];

  // ---- conversation, leads waiting, appointments, follow-ups ----
  const lastMsgMs = ms(convo?.last_message_at);
  const convWaiting = convo && waitingState({ direction: (convo.last_message_direction as string | null) ?? null, at: lastMsgMs, type: (convo.last_message_type as string | null) ?? null }, now, 0);
  const pendingLead = touches.find((t) => t.touch_at === null && t.excluded === null && now - (ms(t.lead_at) as number) < 14 * DAY);
  const waitStart = [convWaiting === "waiting" || convWaiting === "pending" ? lastMsgMs : null, pendingLead ? ms(pendingLead.lead_at) : null].filter((t): t is number => t !== null);
  const waiting = waitStart.length ? { sinceMs: Math.min(...waitStart), never: pendingLead ? isNeverAnswered(Math.round((now - (ms(pendingLead.lead_at) as number)) / 60_000)) : false } : null;

  const apptRows = appts.filter((r) => r.start_at).map((r) => ({ startMs: ms(r.start_at) as number, status: (r.status as string | null) ?? null }));
  const lastNoShow = apptRows.filter((r) => r.status === "noshow" && r.startMs <= now).sort((x, y) => y.startMs - x.startMs)[0];
  const noShow = lastNoShow && noShowToRebook(lastNoShow.startMs, now, apptRows) ? { atMs: lastNoShow.startMs } : null;
  const upcoming = apptRows.filter((r) => r.startMs > now && !["cancelled", "invalid"].includes(r.status ?? "")).sort((x, y) => x.startMs - y.startMs)[0];
  const lastCall = calls[0];
  const followUpDue = lastCall && lastCall.outcome === "follow_up" && lastCall.follow_up_at && ms(lastCall.follow_up_at)! <= now ? ms(lastCall.follow_up_at) : null;

  const facts: PersonFacts = {
    nowMs: now, dnd: c.dnd === true, hasPhone: !!(c.phone as string | null)?.trim(), waiting, noShow, nextAppointmentMs: upcoming?.startMs ?? null,
    openDeals: {
      count: inPlay.length, value: counted.reduce((s, d) => s + Number(d.value ?? 0), 0),
      staleDays: staleDeals.length ? Math.max(...staleDeals.map((d) => Math.floor((now - (ms(d.act) as number)) / DAY))) : null, stage: (biggest?.stage_name as string | undefined) ?? null,
    },
    wonDeals: deals.filter((d) => d.status === "won").length, lastActivityMs: ms(c.last_activity_at), addedMs: ms(c.date_added), followUpDueMs: followUpDue,
  };

  // ---- the timeline: what SubSync knows happened, newest first ----
  const t: TimelineItem[][] = [[], [], [], [], [], [], []];
  if (c.date_added) t[0].push({ at: iso(c.date_added) as string, kind: "contact", title: "Added as a contact", detail: c.source ? `Source: ${c.source}` : undefined });
  for (const k of touches) {
    if (k.excluded !== null) continue;
    const leadAt = iso(k.lead_at) as string;
    if (k.touch_at) {
      const mins = Math.max(0, Math.round(((ms(k.touch_at) as number) - (ms(k.lead_at) as number)) / 60_000));
      t[0].push({ at: iso(k.touch_at) as string, kind: "touch", title: `First reply${k.touch_user_id ? ` by ${a.label(k.touch_user_id as string)}` : ""}`, detail: `${mins < 1 ? "under a minute" : spanWords(mins * 60_000)} after the lead came in` });
    } else t[0].push({ at: leadAt, kind: "touch", title: "Lead came in", detail: "No reply yet" });
  }
  if (convo?.last_message_at) {
    const inbound = convo.last_message_direction === "inbound";
    const ch = channelLabel(convo.last_message_type as string | null);
    t[1].push({ at: iso(convo.last_message_at) as string, kind: "message", title: `Last message: ${ch.toLowerCase()} ${inbound ? "from them" : "from your team"}`, detail: inbound && (convo.unread_count as number) > 0 ? `${convo.unread_count} unread` : undefined });
  }
  for (const r of calls) t[2].push({ at: iso(r.created_at) as string, kind: "call", title: `Call logged: ${OUTCOME_WORDS[r.outcome as string] ?? r.outcome}`, detail: (r.note as string | null) || undefined });
  for (const r of appts) if (r.start_at) t[3].push({ at: iso(r.start_at) as string, kind: "appointment", title: `Appointment ${(ms(r.start_at) as number) > now ? "on" : "was on"} ${timeLabel(iso(r.start_at) as string)}`, detail: `${apptWord((r.status as string | null) ?? null)}${r.title ? ` · ${r.title}` : ""}` });
  for (const e of apptEvents) t[3].push({ at: iso(e.occurred_at) as string, kind: "appointment", title: `Appointment of ${dayLabel(iso(e.start_at) as string)} marked ${apptWord(e.to_value as string).toLowerCase()}` });
  for (const d of deals) {
    if (d.created_remote_at) t[4].push({ at: iso(d.created_remote_at) as string, kind: "deal", title: `Deal created: ${d.name ?? "Untitled"}`, detail: Number(d.value) > 0 ? money(Number(d.value)) : undefined });
    if (d.status !== "open" && d.last_status_change_at) t[4].push({ at: iso(d.last_status_change_at) as string, kind: "deal", title: `Deal ${d.status}: ${d.name ?? "Untitled"}`, detail: Number(d.value) > 0 ? money(Number(d.value)) : undefined });
  }
  for (const e of dealEvents) {
    if (e.kind === "created") continue;
    const to = e.kind === "status" ? (e.to_value as string | null) : e.to_value ? stageName.get(e.to_value as string) ?? "another stage" : null;
    t[4].push({ at: iso(e.at) as string, kind: "deal", title: `${e.deal_name ?? "A deal"} ${e.kind === "status" ? `marked ${to ?? "?"}` : `moved to ${to ?? "?"}`}` });
  }
  for (const e of tagEvents) t[5].push({ at: iso(e.at) as string, kind: "tag", title: `Tag ${e.kind === "added" ? "added" : "removed"}: ${e.tag}` });
  const timeline = mergeTimeline(t);

  return {
    contact: {
      contactId: c.contact_id as string, locationId: c.location_id as string, locationName: (c.location_name as string | null) ?? null, name: properName(c.name as string), email: (c.email as string | null) ?? null,
      phone: (c.phone as string | null) ?? null, tags: (c.tags as string[] | null) ?? [], source: (c.source as string | null) ?? null, dnd: c.dnd === true, lastActivityAt: iso(c.last_activity_at), dateAdded: iso(c.date_added),
      owner: (c.owner as string | null) ?? null, timeZone: (c.timezone as string | null) ?? null,
    },
    deals: dealsOut, unread: (convo?.unread_count as number | undefined) ?? 0, tagDates, tagExact, watchingSince: iso(since?.at),
    appointments: appts.filter((r) => r.start_at).map((r) => ({ at: iso(r.start_at) as string, status: (r.status as string | null) ?? null })),
    loggedCalls: calls.map((r) => ({ at: iso(r.created_at) as string, outcome: r.outcome as string, note: (r.note as string | null) ?? null })),
    timeline, headline: personHeadline(facts), conversationId: (convo?.conversation_id as string | undefined) ?? null,
  };
}

export { changedLine, changedSince };
