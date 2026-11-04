import { sql } from "../db";
import { ttlCache } from "../ttl-cache";
import { personLabel, loadAppts, type Loaded } from "./appointment-queries";
import { clampTarget, DEFAULT_SHOW_RATE_TARGET, parseWindow, type ParsedWindow } from "./appointment-f3";
import {
  compareBy, DAY, inOutcomeBucket, INLINE_ROWS, outcomeCounts, OUTCOME_BUCKETS, pageOf, reasonFor, selectWork, showRateOf, valueOfPeople, workLists,
  type By, type Counts, type ListQuery, type OutcomeBucket, type WorkItem, type WorkKind,
} from "./appointment-work";
import { countedInScope, dealScopeJoins } from "./stage-rules-sql";

// The reads behind the rebuilt Appointments page (docs/APPOINTMENTS_REVIEW.md, docs/METRICS.md "Appointments, the work lists"). Read only. One build per installation
// and set of accounts is kept for 30 seconds, so the page, its "See all" panel and a second person opening it share one read; the lists, counts and comparison
// tables are all cut from that one build, so a number and the list behind it cannot disagree. The accounts are decided by the router from the signed session
// (`allowed`), never by anything the browser sends.

const HISTORY_DAYS = 90;
const FUTURE_DAYS = 60;
/** The largest window list built in one go (a chart bar opened): it is cut newest-first and says so. */
const WINDOW_CAP = 20_000;

type Loc = { id: string; name: string | null; zone: string | null; access: string | null };
type ContactInfo = { name: string; phone: string | null; email: string | null; dnd: boolean; source: string | null };

export type Base = {
  now: number; appts: Loaded[]; locs: Loc[]; names: Map<string, string | null>; zones: Map<string, string | null>; label: (id: string | null | undefined) => string;
  lists: ReturnType<typeof workLists<Loaded>>; items: WorkItem[]; namesNeedPermission: number; earliest: number | null;
};

const hash = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };

async function contactsFor(installationId: string, ids: string[]): Promise<Map<string, ContactInfo>> {
  const out = new Map<string, ContactInfo>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 5_000) {
    const rows = await sql()`
      select contact_id, location_id, coalesce(nullif(full_name, ''), nullif(email, ''), 'Unnamed contact') name, phone, email, dnd, source
      from cached_contacts where installation_id = ${installationId} and contact_id = any(${uniq.slice(i, i + 5_000)}::text[])`;
    for (const r of rows) out.set(`${r.location_id}:${r.contact_id}`, { name: r.name as string, phone: (r.phone as string | null) ?? null, email: (r.email as string | null) ?? null, dnd: r.dnd === true, source: (r.source as string | null) || null });
  }
  return out;
}

/** Counted open deal dollars per person (the same "counted deal" rule as every dollar figure: value above zero, an owner, in play). */
async function valuesFor(installationId: string, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 5_000) {
    const rows = await sql()`
      select o.location_id, o.contact_id, sum(o.monetary_value)::float8 v
      from cached_opportunities o ${dealScopeJoins()}
      where o.installation_id = ${installationId} and o.status = 'open' and o.contact_id = any(${uniq.slice(i, i + 5_000)}::text[]) and ${countedInScope()}
      group by o.location_id, o.contact_id`;
    for (const r of rows) out.set(`${r.location_id}:${r.contact_id}`, r.v as number);
  }
  return out;
}

function toItem(a: Loaded, kind: WorkKind | "window", c: { info: Map<string, ContactInfo>; value: Map<string, number>; names: Map<string, string | null>; zones: Map<string, string | null>; label: (id: string | null | undefined) => string }, now: number, extra: { why?: Array<"unconfirmed" | "missed_before">; lastMissed?: number | null } = {}): WorkItem {
  const k = a.contactId ? `${a.locationId}:${a.contactId}` : null;
  const info = k ? c.info.get(k) : undefined;
  const zone = c.zones.get(a.locationId) ?? null;
  const reason = kind === "window" ? `${a.status === "noshow" ? "No-show" : a.status === "showed" ? "Showed" : a.status === "cancelled" ? "Cancelled" : "No outcome marked"} on ${new Date(a.startAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}${a.calendarName ? ` · ${a.calendarName}` : ""}`
    : reasonFor(kind, { at: a.startAt, now, calendar: a.calendarName, why: extra.why, lastMissed: extra.lastMissed, timeZone: zone });
  return {
    key: `${a.locationId}:${a.id}`, kind, id: a.id, locationId: a.locationId, locationName: c.names.get(a.locationId) ?? null, contactId: a.contactId,
    name: info?.name ?? (a.contactId ? "Contact not in the copy yet" : "No contact on this booking"), phone: info?.phone ?? null, email: info?.email ?? null, dnd: info?.dnd ?? false, timeZone: zone,
    calendarId: a.calendarId, calendar: a.calendarName, at: a.startAt, status: a.status, assignedKey: a.assignedTo ?? "unassigned", assigned: c.label(a.assignedTo),
    source: info?.source ?? null, value: k ? c.value.get(k) ?? 0 : 0, reason, why: extra.why ?? [],
  };
}

async function build(installationId: string, allowed: string[] | null): Promise<Base> {
  const db = sql();
  const now = Date.now();
  const [locRows, appts, people] = await Promise.all([
    db`select location_id, name, timezone, appointments_access, users_access from locations where installation_id = ${installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}`,
    loadAppts(installationId, allowed, now - HISTORY_DAYS * DAY, now + FUTURE_DAYS * DAY),
    db`select user_id, name from team_names where installation_id = ${installationId}`,
  ]);
  const locs: Loc[] = locRows.map((l) => ({ id: l.location_id as string, name: (l.name as string | null) ?? null, zone: (l.timezone as string | null) ?? null, access: (l.appointments_access as string | null) ?? null }));
  const names = new Map(locs.map((l) => [l.id, l.name]));
  const zones = new Map(locs.map((l) => [l.id, l.zone]));
  const label = personLabel(new Map(people.map((p) => [p.user_id as string, p.name as string])));
  const lists = workLists(appts, now);
  const ids = [...lists.record, ...lists.recover, ...lists.upcoming.map((u) => u.a)].map((a) => a.contactId).filter((x): x is string => !!x);
  const [info, value] = await Promise.all([contactsFor(installationId, ids), valuesFor(installationId, ids)]);
  const c = { info, value, names, zones, label };
  const items = [
    ...lists.recover.map((a) => toItem(a, "recover", c, now)),
    ...lists.record.map((a) => toItem(a, "record", c, now)),
    ...lists.upcoming.map((u) => toItem(u.a, "upcoming", c, now, { why: u.why, lastMissed: u.lastMissed })),
  ];
  return {
    now, appts, locs, names, zones, label, lists, items, namesNeedPermission: locRows.filter((l) => l.users_access === "needs_permission").length,
    earliest: appts.length ? appts.reduce((m, a) => Math.min(m, a.startAt), Infinity) : null,
  };
}

const cache = ttlCache<Base>(30_000, 40);
const building = new Map<string, Promise<Base>>();
const keyOf = (installationId: string, allowed: string[] | null) => `${installationId}|${allowed ? hash([...allowed].sort().join(",")) : "all"}`;

export async function workBase(installationId: string, allowed: string[] | null): Promise<Base> {
  const key = keyOf(installationId, allowed);
  const hit = cache.get(key);
  if (hit) return hit;
  const running = building.get(key);
  if (running) return running;
  const p = build(installationId, allowed).then((b) => { cache.set(key, b); return b; }).finally(() => building.delete(key));
  building.set(key, p);
  return p;
}
/** Forget an installation's builds (tests; a sync could also call it). */
export const forgetWork = (installationId: string) => cache.clear(installationId + "|");

// ---------------- counts, the same everywhere on the page ----------------

export function countsOf(b: Base): Counts {
  const by = (k: WorkKind) => b.items.filter((i) => i.kind === k);
  return { record: by("record").length, recover: by("recover").length, upcoming: by("upcoming").length, recoverValue: valueOfPeople(by("recover")), value: valueOfPeople(b.items) };
}

const DEFAULT_QUERY: ListQuery = { q: "", sort: "important", location: null, user: null, calendar: null };

/** The page: the headline numbers, the true show rate over the card's own window, five rows of each list and the first lines of the comparison. */
export async function workOverview(installationId: string, allowed: string[] | null, opts: { window?: ParsedWindow } = {}) {
  const [b, cfg] = await Promise.all([workBase(installationId, allowed), sql()`select appointment_show_rate_target from settings where installation_id = ${installationId}`]);
  const now = b.now;
  const win = opts.window ?? parseWindow({}, now);
  const cur = win.current;
  const counts = countsOf(b);
  const kindRows = (k: WorkKind) => selectWork(b.items.filter((i) => i.kind === k), k, DEFAULT_QUERY);
  const cmpFor = (by: By) => compareBy(b.appts, by, cur.from, cur.to, labelFor(b, by), { record: b.lists.record, recover: b.lists.recover, upcoming: b.lists.upcoming.map((u) => u.a) });
  const several = b.locs.length > 1;
  const lists = Object.fromEntries((["recover", "record", "upcoming"] as WorkKind[]).map((k) => {
    const all = kindRows(k);
    return [k, { total: all.length, value: valueOfPeople(all), rows: all.slice(0, INLINE_ROWS) }];
  })) as Record<WorkKind, { total: number; value: number; rows: WorkItem[] }>;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const people = cmpFor("person");
  const accounts = several ? cmpFor("account") : [];
  const calendars = cmpFor("calendar");
  return {
    now,
    access: { total: b.locs.length, needsPermission: b.locs.filter((l) => l.access === "needs_permission").map((l) => ({ locationId: l.id, name: l.name })), namesNeedPermission: b.namesNeedPermission },
    several, counts, lists,
    target: (() => { const t = clampTarget(cfg[0]?.appointment_show_rate_target) ?? DEFAULT_SHOW_RATE_TARGET; return { showRate: t, isDefault: t === DEFAULT_SHOW_RATE_TARGET }; })(),
    window: { from: iso(cur.from), to: iso(cur.to - DAY), defaulted: win.defaulted, problem: win.problem },
    compareWindow: win.compare ? { from: iso(win.compare.from), to: iso(win.compare.to - DAY) } : null,
    rate: showRateOf(b.appts, cur.from, cur.to, now),
    rateBefore: win.compare ? showRateOf(b.appts, win.compare.from, win.compare.to, now) : null,
    outcomes: { counts: outcomeCounts(b.appts, cur.from, cur.to, now), buckets: OUTCOME_BUCKETS },
    historyFrom: b.earliest === null ? null : iso(b.earliest),
    people: { total: people.length, rows: people.slice(0, INLINE_ROWS) },
    calendars: { total: calendars.length, rows: calendars.slice(0, INLINE_ROWS) },
    accounts: { total: accounts.length, rows: accounts.slice(0, INLINE_ROWS) },
  };
}

function labelFor(b: Base, by: By) {
  const cal = new Map(b.appts.filter((a) => a.calendarId).map((a) => [a.calendarId as string, a.calendarName ?? "Calendar"]));
  return (key: string) => (by === "person" ? b.label(key) : by === "account" ? b.names.get(key) ?? "Unnamed account" : key === "none" ? "No calendar" : cal.get(key) ?? "Calendar");
}

/** A page of a list. kind "all" is the three lists together; "window" is one outcome bar of the show-rate card (the rows behind its count). */
export async function workList(installationId: string, allowed: string[] | null, p: { kind: WorkKind | "all" | "window"; bucket: OutcomeBucket | null; window?: ParsedWindow; query: ListQuery; page: number; size: number }) {
  const b = await workBase(installationId, allowed);
  const several = b.locs.length > 1;
  let items: WorkItem[];
  let capped = false;
  if (p.kind === "window") {
    const win = p.window ?? parseWindow({}, b.now);
    const bucket = p.bucket ?? "unmarked";
    const inside = b.appts.filter((a) => a.startAt >= win.current.from && a.startAt < win.current.to && inOutcomeBucket(a, bucket, b.now));
    capped = inside.length > WINDOW_CAP;
    const used = inside.slice(0, WINDOW_CAP);
    const ids = used.map((a) => a.contactId).filter((x): x is string => !!x);
    const [info, value] = await Promise.all([contactsFor(installationId, ids), valuesFor(installationId, ids)]);
    items = used.map((a) => toItem(a, "window", { info, value, names: b.names, zones: b.zones, label: b.label }, b.now));
  } else items = p.kind === "all" ? b.items : b.items.filter((i) => i.kind === p.kind);
  const selected = selectWork(items, p.kind === "window" ? "bucket" : p.kind, p.query);
  const page = pageOf(selected, p.page, p.size);
  const countBy = (get: (i: WorkItem) => string, nameOf: (k: string) => string, cap: number) => {
    const m = new Map<string, number>();
    for (const i of items) m.set(get(i), (m.get(get(i)) ?? 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, cap).map(([key, count]) => ({ key, label: nameOf(key), count }));
  };
  return {
    kind: p.kind, bucket: p.bucket, ...page, value: valueOfPeople(selected), capped, windowCap: WINDOW_CAP,
    options: {
      accounts: several ? countBy((i) => i.locationId, (k) => b.names.get(k) ?? "Unnamed account", 100) : [],
      people: countBy((i) => i.assignedKey, (k) => b.label(k), 60),
      calendars: countBy((i) => i.calendarId ?? "none", labelFor(b, "calendar"), 40),
    },
    several,
  };
}

/** A page of the person, client account or calendar comparison. */
export async function workCompare(installationId: string, allowed: string[] | null, p: { by: By; window?: ParsedWindow; q: string; sort: "todo" | "name" | "rate"; page: number; size: number }) {
  const b = await workBase(installationId, allowed);
  const win = p.window ?? parseWindow({}, b.now);
  const label = labelFor(b, p.by);
  let rows = compareBy(b.appts, p.by, win.current.from, win.current.to, label, { record: b.lists.record, recover: b.lists.recover, upcoming: b.lists.upcoming.map((u) => u.a) });
  const q = p.q.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.label.toLowerCase().includes(q));
  if (p.sort === "name") rows = [...rows].sort((x, y) => x.label.localeCompare(y.label));
  else if (p.sort === "rate") rows = [...rows].sort((x, y) => (y.rate ?? -1) - (x.rate ?? -1) || x.label.localeCompare(y.label));
  return { by: p.by, ...pageOf(rows, p.page, p.size) };
}
