import { sql } from "../db";
import {
  appointmentValue, bestAndWorstSlot, bookingVelocity, calendarHealth, confirmationSummary, doubleBookings, fairness, followUpGaps, funnel, heatmap, heatmapReadiness, localSlot, prepBrief,
  recovery, repeatNoShows, sameDayPerformance, showRateBySource, splitSources, volumeForecast, WEEKDAYS, type Lead,
} from "./appointment-deep";
import { isActive, needsOutcome, rates, type Appt } from "./appointment-intel";
import { clampTarget, DEFAULT_SHOW_RATE_TARGET, filterAppts, filterOptions, parseWindow, type ApptFilters, type ParsedWindow } from "./appointment-f3";
import { personLabel } from "./appointment-queries";

const DAY = 86_400_000;
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);
const ITEM_CAP = 800;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

// Everything the Insights tab shows, for the accounts the caller may see. The range and the three filters narrow the analysis (best times, lead source,
// lead to customer) and every other card; the cards that look at "the next two days" or "the last two weeks" say so in their own text.
export async function appointmentInsights(installationId: string, allowed: string[] | null, now = Date.now(), opts: { window?: ParsedWindow; filters?: ApptFilters } = {}) {
  const db = sql();
  // The analysis window. With no dates it is the last 90 days, as it always was.
  const asked = opts.window ?? parseWindow({}, now);
  const span = asked.defaulted ? { from: now - 90 * DAY, to: now } : { from: asked.current.from, to: Math.min(asked.current.to, now) };
  const days = Math.max(1, Math.ceil((span.to - span.from) / DAY));
  const end = span.to;
  const [locs, rows, people, cfgRows] = await Promise.all([
    db`select location_id, name, timezone from locations where installation_id = ${installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}`,
    db`
      select a.appointment_id, a.location_id, a.calendar_id, a.calendar_name, a.contact_id, a.status, a.start_at, a.created_remote_at, a.assigned_to
      from cached_appointments a join locations l on l.installation_id = a.installation_id and l.location_id = a.location_id and not l.ignored
      where a.installation_id = ${installationId} ${allowed ? db`and a.location_id = any(${allowed}::text[])` : db``}
        and a.start_at between ${new Date(Math.min(now - 180 * DAY, span.from))} and ${new Date(now + 60 * DAY)} order by a.start_at desc limit 60000`,
    db`select user_id, name from team_names where installation_id = ${installationId}`,
    db`select appointment_show_rate_target from settings where installation_id = ${installationId}`,
  ]);
  const all: Appt[] = rows.map((r) => ({
    id: r.appointment_id, locationId: r.location_id, calendarId: r.calendar_id, calendarName: r.calendar_name, contactId: r.contact_id, status: r.status ?? "new",
    startAt: ms(r.start_at) ?? 0, createdAt: ms(r.created_remote_at), assignedTo: r.assigned_to,
  }));
  const tz = new Map(locs.map((l) => [l.location_id as string, (l.timezone as string | null) ?? "UTC"]));
  const names = new Map(locs.map((l) => [l.location_id as string, l.name as string | null]));
  const who = new Map(people.map((p) => [p.user_id as string, p.name as string]));
  const person = personLabel(who);
  const target = clampTarget(cfgRows[0]?.appointment_show_rate_target) ?? DEFAULT_SHOW_RATE_TARGET;

  const locIds = locs.map((l) => l.location_id as string);
  const contactIds = [...new Set(all.map((a) => a.contactId).filter((x): x is string => !!x))];
  const [contacts, leadsRows, won, convs] = await Promise.all([
    contactIds.length === 0 ? Promise.resolve([]) : db`
      select location_id, contact_id, coalesce(nullif(full_name, ''), email, 'Unnamed contact') name, source, phone, tags, date_added from cached_contacts
      where installation_id = ${installationId} and contact_id = any(${contactIds}::text[]) and location_id = any(${locIds}::text[])`,
    locIds.length === 0 ? Promise.resolve([]) : db`
      select location_id, contact_id, source, date_added from cached_contacts
      where installation_id = ${installationId} and location_id = any(${locIds}::text[]) and date_added > ${new Date(Math.min(now - 180 * DAY, span.from))} limit 60000`,
    locIds.length === 0 ? Promise.resolve([]) : db`
      select location_id, contact_id, count(*) filter (where status = 'won')::int won, coalesce(sum(monetary_value) filter (where status = 'won'), 0)::float8 won_value,
        count(*) filter (where status = 'open')::int open, coalesce(sum(monetary_value) filter (where status = 'open'), 0)::float8 open_value
      from cached_opportunities where installation_id = ${installationId} and location_id = any(${locIds}::text[]) and contact_id is not null group by 1, 2`,
    locIds.length === 0 ? Promise.resolve([]) : db`
      select location_id, contact_id, last_message_direction, last_message_at from cached_conversations where installation_id = ${installationId} and location_id = any(${locIds}::text[]) and contact_id is not null`,
  ]);
  const key = (l: string, c: string) => `${l}:${c}`;
  const contactBy = new Map(contacts.map((c) => [key(c.location_id as string, c.contact_id as string), c]));
  const sourceOf = (loc: string, contactId: string) => ((contactBy.get(key(loc, contactId))?.source as string | null) || null);
  const nameOf = (loc: string, contactId: string) => (contactBy.get(key(loc, contactId))?.name as string | undefined) ?? "Contact";
  // The filters apply to every card: one calendar, one person, one lead source.
  const appts = filterAppts(all, opts.filters ?? {}, sourceOf);
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
  const leads: Lead[] = leadsRows.map((l) => ({ id: l.contact_id as string, locationId: l.location_id as string, createdAt: ms(l.date_added), source: l.source as string | null })).filter((l) => l.createdAt === null || l.createdAt <= end);

  const last30 = rates(appts, now - 30 * DAY, now, now);
  const fair = fairness(appts, now);
  const conf = confirmationSummary(appts, now);
  const past = appts.filter((a) => a.startAt < now && a.startAt > now - 30 * DAY && isActive(a));
  const pastUnmarked = past.filter((a) => needsOutcome(a, now)).length;
  const health = calendarHealth({
    showRate: last30.showRate, confirmedShare: conf.next48 >= 3 ? conf.confirmed / conf.next48 : null,
    unmarkedShare: past.length ? pastUnmarked / past.length : null, fairnessSkewed: fair.judged ? fair.skewed : null, unmarked: pastUnmarked, past: past.length,
  });
  // The best-times grid and the lead-source table look at exactly the window's appointments, so the list behind a cell or a row has the same count.
  const inSpan = appts.filter((a) => a.startAt >= span.from);
  const cells = heatmap(inSpan, (l) => tz.get(l) ?? "UTC", end, days);
  const ready = heatmapReadiness(cells);
  const slot = ready.ready ? bestAndWorstSlot(cells) : null;
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

  const fun = funnel(leads, appts, wonContacts, end, days);
  // The leads behind each funnel step get names (at most 60 per step), from the contacts already copied.
  const memberKeys = [...new Set(fun.steps.flatMap((s) => s.members))];
  const needNames = memberKeys.filter((k) => !contactBy.has(k));
  const extra = needNames.length === 0 ? [] : await db`
    select location_id, contact_id, coalesce(nullif(full_name, ''), email, 'Unnamed contact') name from cached_contacts
    where installation_id = ${installationId} and contact_id = any(${needNames.map((k) => k.slice(k.indexOf(":") + 1))}::text[]) and location_id = any(${locIds}::text[])`;
  const extraBy = new Map(extra.map((c) => [key(c.location_id as string, c.contact_id as string), c.name as string]));
  const memberOf = (k: string) => {
    const i = k.indexOf(":");
    const loc = k.slice(0, i), id = k.slice(i + 1);
    return { locationId: loc, contactId: id, name: (contactBy.get(k)?.name as string | undefined) ?? extraBy.get(k) ?? "Contact", locationName: names.get(loc) ?? null };
  };
  const funnelOut = { ...fun, steps: fun.steps.map((s) => ({ ...s, members: s.members.map(memberOf) })) };
  const unmarkedInWindow = appts.filter((a) => a.startAt >= span.from && a.startAt < end && needsOutcome(a, now)).length;

  // Compact rows for the lists behind the best-times grid and the lead-source table: the window's appointments, newest first, capped.
  const inWin = appts.filter((a) => a.startAt >= span.from && a.startAt <= end && a.status !== "invalid").sort((a, b) => b.startAt - a.startAt);
  const calendarNames = new Set(appts.map((a) => a.calendarName).filter((x): x is string => !!x));
  const bySource = splitSources(showRateBySource(inSpan, sourceOf, end, days), calendarNames);
  const items = inWin.slice(0, ITEM_CAP).map((a) => {
    const slotOf = localSlot(a.startAt, tz.get(a.locationId) ?? "UTC");
    return {
      id: a.id, locationId: a.locationId, locationName: names.get(a.locationId) ?? null, contactId: a.contactId, name: a.contactId ? nameOf(a.locationId, a.contactId) : "No contact on this booking", calendar: a.calendarName, at: a.startAt,
      status: a.status, assigned: person(a.assignedTo), source: a.contactId ? sourceOf(a.locationId, a.contactId) : null, weekday: slotOf?.weekday ?? null, hour: slotOf?.hour ?? null,
    };
  });

  return {
    window: { from: isoDay(span.from), to: isoDay(end), days, defaulted: asked.defaulted, problem: asked.problem },
    filters: opts.filters ?? {},
    target: { showRate: target, isDefault: target === DEFAULT_SHOW_RATE_TARGET },
    health,
    funnel: { ...funnelOut, unmarked: unmarkedInWindow },
    heat: {
      cells, ...ready,
      best: slot ? { label: slotText(slot.best), showRate: slot.best.showRate } : null, worst: slot ? { label: slotText(slot.worst), showRate: slot.worst.showRate } : null, ratio: slot?.ratio ?? null,
    },
    recovery: recovery(appts, now),
    repeatNoShows: repeatNoShows(appts).slice(0, 12).map((r) => ({ ...r, name: nameOf(r.locationId, r.contactId), locationName: names.get(r.locationId) ?? null, phone: (contactBy.get(key(r.locationId, r.contactId))?.phone as string | null) ?? null })),
    velocity: bookingVelocity(leads, appts),
    bySource, sourceNote: bySource.some((s) => s.isCalendar) ? "Some contacts have the name of a calendar as their source. They are grouped on their own line because a calendar is where they booked, not where the lead came from." : null,
    confirmations: conf,
    sameDay: sameDayPerformance(appts, now),
    fairness: { ...fair, rows: fair.rows.map((r) => ({ ...r, label: person(r.key) })) },
    doubleBookings: doubleBookings(appts, now, undefined, (id) => tz.get(id) ?? "UTC").slice(0, 10).map((d) => ({ kind: d.kind, at: d.at, locationName: names.get(d.locationId) ?? null, who: d.kind === "person" ? person(d.key.split(":")[1] ?? "") : nameOf(d.locationId, d.key.split(":")[1] ?? "") })),
    value: appointmentValue(appts, wonValue, now),
    forecast: volumeForecast(appts, now),
    followUp: { held: fu.held, withoutFollowUp: fu.withoutFollowUp, gapRate: fu.gapRate, contacts: fu.contacts.map((c) => ({ ...c, name: nameOf(c.locationId, c.contactId), locationName: names.get(c.locationId) ?? null })) },
    briefs,
    items, itemsTotal: inWin.length, itemCap: ITEM_CAP,
    // What the three filters offer: everything in the accounts, before any of them is applied, so a choice can always be changed.
    options: filterOptions(all, (id) => person(id), sourceOf, (id) => names.get(id) ?? null, locs.length > 1),
    sampleSize: appts.length,
  };
}
