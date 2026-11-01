import { sql } from "../db";
import {
  appointmentValue, bestAndWorstSlot, bookingVelocity, calendarHealth, confirmationSummary, doubleBookings, fairness, followUpGaps, funnel, heatmap, prepBrief,
  recovery, repeatNoShows, sameDayPerformance, showRateBySource, volumeForecast, WEEKDAYS, type Lead,
} from "./appointment-deep";
import { isActive, needsOutcome, rates, type Appt } from "./appointment-intel";

const DAY = 86_400_000;
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);

// Everything the Insights tab shows, for the accounts the caller may see.
export async function appointmentInsights(installationId: string, allowed: string[] | null, now = Date.now()) {
  const db = sql();
  const [locs, rows, people] = await Promise.all([
    db`select location_id, name, timezone from locations where installation_id = ${installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}`,
    db`
      select a.appointment_id, a.location_id, a.calendar_id, a.calendar_name, a.contact_id, a.status, a.start_at, a.created_remote_at, a.assigned_to
      from cached_appointments a join locations l on l.installation_id = a.installation_id and l.location_id = a.location_id and not l.ignored
      where a.installation_id = ${installationId} ${allowed ? db`and a.location_id = any(${allowed}::text[])` : db``}
        and a.start_at between ${new Date(now - 180 * DAY)} and ${new Date(now + 60 * DAY)} order by a.start_at desc limit 60000`,
    db`select user_id, name from team_names where installation_id = ${installationId}`,
  ]);
  const appts: Appt[] = rows.map((r) => ({
    id: r.appointment_id, locationId: r.location_id, calendarId: r.calendar_id, calendarName: r.calendar_name, contactId: r.contact_id, status: r.status ?? "new",
    startAt: ms(r.start_at) ?? 0, createdAt: ms(r.created_remote_at), assignedTo: r.assigned_to,
  }));
  const tz = new Map(locs.map((l) => [l.location_id as string, (l.timezone as string | null) ?? "UTC"]));
  const names = new Map(locs.map((l) => [l.location_id as string, l.name as string | null]));
  const who = new Map(people.map((p) => [p.user_id as string, p.name as string]));
  const person = (id: string) => who.get(id) ?? (id === "unassigned" ? "Unassigned" : "Team member " + id.slice(-4));

  const locIds = locs.map((l) => l.location_id as string);
  const contactIds = [...new Set(appts.map((a) => a.contactId).filter((x): x is string => !!x))];
  const [contacts, leadsRows, won, convs] = await Promise.all([
    contactIds.length === 0 ? Promise.resolve([]) : db`
      select location_id, contact_id, coalesce(nullif(full_name, ''), email, 'Unnamed contact') name, source, phone, tags, date_added from cached_contacts
      where installation_id = ${installationId} and contact_id = any(${contactIds}::text[]) and location_id = any(${locIds}::text[])`,
    locIds.length === 0 ? Promise.resolve([]) : db`
      select location_id, contact_id, source, date_added from cached_contacts
      where installation_id = ${installationId} and location_id = any(${locIds}::text[]) and date_added > ${new Date(now - 180 * DAY)} limit 60000`,
    locIds.length === 0 ? Promise.resolve([]) : db`
      select location_id, contact_id, count(*) filter (where status = 'won')::int won, coalesce(sum(monetary_value) filter (where status = 'won'), 0)::float8 won_value,
        count(*) filter (where status = 'open')::int open, coalesce(sum(monetary_value) filter (where status = 'open'), 0)::float8 open_value
      from cached_opportunities where installation_id = ${installationId} and location_id = any(${locIds}::text[]) and contact_id is not null group by 1, 2`,
    locIds.length === 0 ? Promise.resolve([]) : db`
      select location_id, contact_id, last_message_direction, last_message_at from cached_conversations where installation_id = ${installationId} and location_id = any(${locIds}::text[]) and contact_id is not null`,
  ]);
  const key = (l: string, c: string) => `${l}:${c}`;
  const contactBy = new Map(contacts.map((c) => [key(c.location_id as string, c.contact_id as string), c]));
  const wonBy = new Map(won.map((w) => [key(w.location_id as string, w.contact_id as string), w]));
  const wonContacts = new Set(won.filter((w) => w.won > 0).map((w) => key(w.location_id as string, w.contact_id as string)));
  const wonValue = new Map(won.map((w) => [key(w.location_id as string, w.contact_id as string), w.won_value as number]));
  const lastOutbound = new Map<string, number>();
  const lastMessage = new Map<string, number>();
  for (const c of convs) {
    const k = key(c.location_id as string, c.contact_id as string);
    const at = ms(c.last_message_at);
    if (at === null) continue;
    lastMessage.set(k, at);
    if (c.last_message_direction === "outbound") lastOutbound.set(k, at);
  }
  const leads: Lead[] = leadsRows.map((l) => ({ id: l.contact_id as string, locationId: l.location_id as string, createdAt: ms(l.date_added), source: l.source as string | null }));
  const sourceOf = (loc: string, contactId: string) => (contactBy.get(key(loc, contactId))?.source as string | null) ?? null;
  const nameOf = (loc: string, contactId: string) => (contactBy.get(key(loc, contactId))?.name as string | undefined) ?? "Contact";

  const last30 = rates(appts, now - 30 * DAY, now, now);
  const fair = fairness(appts, now);
  const conf = confirmationSummary(appts, now);
  const past = appts.filter((a) => a.startAt < now && a.startAt > now - 30 * DAY && isActive(a));
  const health = calendarHealth({
    showRate: last30.showRate, confirmedShare: conf.next48 >= 3 ? conf.confirmed / conf.next48 : null,
    unmarkedShare: past.length ? past.filter((a) => needsOutcome(a, now)).length / past.length : 0, fairnessSkewed: fair.skewed,
  });
  const cells = heatmap(appts, (l) => tz.get(l) ?? "UTC", now);
  const slot = bestAndWorstSlot(cells);
  const slotText = (h: { weekday: number; hour: number }) => `${WEEKDAYS[h.weekday]} at ${h.hour % 12 === 0 ? 12 : h.hour % 12}${h.hour < 12 ? "am" : "pm"}`;
  const fu = followUpGaps(appts, lastOutbound, now);

  // The next appointments with a plain-English prep brief (1.8).
  const upcoming = appts.filter((a) => isActive(a) && a.contactId && a.startAt >= now && a.startAt < now + 7 * DAY).sort((a, b) => a.startAt - b.startAt).slice(0, 8);
  const briefs = upcoming.map((a) => {
    const c = contactBy.get(key(a.locationId, a.contactId as string));
    const w = wonBy.get(key(a.locationId, a.contactId as string));
    const earlier = appts.filter((x) => x.contactId === a.contactId && x.locationId === a.locationId && x.id !== a.id && x.startAt < a.startAt && isActive(x)).length;
    const lm = lastMessage.get(key(a.locationId, a.contactId as string));
    return {
      contactId: a.contactId as string, locationId: a.locationId, locationName: names.get(a.locationId) ?? null, name: (c?.name as string | undefined) ?? "Contact", at: a.startAt,
      brief: prepBrief({
        name: (c?.name as string | undefined) ?? "your contact", at: a.startAt, calendar: a.calendarName, source: (c?.source as string | null) ?? null, leadAddedAt: ms(c?.date_added),
        openDeals: (w?.open as number | undefined) ?? 0, openValue: (w?.open_value as number | undefined) ?? 0, wonBefore: (w?.won as number | undefined) ?? 0, previousAppointments: earlier,
        lastReplyHours: lm === undefined ? null : Math.max(0, (now - lm) / 3_600_000), tags: (c?.tags as string[] | undefined) ?? [],
      }, now),
    };
  });

  return {
    health,
    funnel: funnel(leads, appts, wonContacts, now),
    heat: { cells, best: slot ? { label: slotText(slot.best), showRate: slot.best.showRate } : null, worst: slot ? { label: slotText(slot.worst), showRate: slot.worst.showRate } : null, ratio: slot?.ratio ?? null },
    recovery: recovery(appts, now),
    repeatNoShows: repeatNoShows(appts).slice(0, 12).map((r) => ({ ...r, name: nameOf(r.locationId, r.contactId), locationName: names.get(r.locationId) ?? null, phone: (contactBy.get(key(r.locationId, r.contactId))?.phone as string | null) ?? null })),
    velocity: bookingVelocity(leads, appts),
    bySource: showRateBySource(appts, sourceOf, now),
    confirmations: conf,
    sameDay: sameDayPerformance(appts, now),
    fairness: { ...fair, rows: fair.rows.map((r) => ({ ...r, label: person(r.key) })) },
    doubleBookings: doubleBookings(appts, now, undefined, (id) => tz.get(id) ?? "UTC").slice(0, 10).map((d) => ({ kind: d.kind, at: d.at, locationName: names.get(d.locationId) ?? null, who: d.kind === "person" ? person(d.key.split(":")[1] ?? "") : nameOf(d.locationId, d.key.split(":")[1] ?? "") })),
    value: appointmentValue(appts, wonValue, now),
    forecast: volumeForecast(appts, now),
    followUp: { held: fu.held, withoutFollowUp: fu.withoutFollowUp, gapRate: fu.gapRate, contacts: fu.contacts.map((c) => ({ ...c, name: nameOf(c.locationId, c.contactId), locationName: names.get(c.locationId) ?? null })) },
    briefs,
    sampleSize: appts.length,
  };
}
