import { sql } from "../db";
import { ownersOf } from "./clients-actions-queries";
import { accountsCore, clientsCache, cleanId, receipt, setup, type Core, type Links, type Scope } from "./clients3-queries";
import { parseWindow, rate } from "./clients3-intel";
import type { Cl3Receipt } from "./clients3-types";
import { atRiskOf, DAY, DEFAULT_QUIET_DAYS, encodeCursor, facetsOf, matches, needsPlanLook, pageAfter, decodeCursor, planAccessOf, planOf, sortRows, todayOf, type BillingRow, type Cl2Filter, type Cl2Sort } from "./clients2-core";
import { VERTICAL_LABEL, VERTICALS, type Vertical } from "./moat-core";
import type { Cl2Account, Cl2Attention, Cl2List, Cl2Note, Cl2Options, Cl2Row, Cl2Today, Cl2View } from "./clients2-types";

// Clients v2 reads: one roster of every client account (plan, payment status, health, activity, manager, kind of business), built from a few grouped queries (never one query per account)
// and kept for a minute. The list filters, sorts and pages that roster with a keyset cursor, so the first screen is fast whatever the number of leads and messages behind it.
// Every number is a count of rows the list can show. Nothing here writes to the CRM. The account ids come from the caller's scope only (Scope.allowed, decided from the session).

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(v as string).toISOString() : null);
const VERTICAL_SET = new Set<string>(VERTICALS);
const vlabel = (v: string | null) => (v && VERTICAL_SET.has(v) ? VERTICAL_LABEL[v as Vertical] : v);

type Roster = { rows: Cl2Row[]; cores: Map<string, Core>; builtAt: number; quietDays: number };

async function billingRows(inst: string, ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  if (!ids.length) return new Map();
  const db = sql();
  let rows: Record<string, unknown>[];
  try {
    rows = await db`select location_id, state, plan_id, plan_name, subscription_status, price_amount, price_currency, billing_interval, status_since, http_status, reason, fetched_at
      from client_billing where installation_id = ${inst} and location_id = any(${ids}::text[])`;
  } catch {
    try { rows = await db`select location_id, state, plan_id, plan_name, subscription_status, fetched_at from client_billing where installation_id = ${inst} and location_id = any(${ids}::text[])`; } catch { rows = []; }
  }
  return new Map(rows.map((r) => [r.location_id as string, r]));
}

/** Every account the caller may read, with its plan, health, activity and tags. Cached per installation and scope for a minute (a change to a tag, manager or quiet mark clears it). */
export async function roster(s: Scope, links: Links, now = Date.now()): Promise<Roster> {
  const key = JSON.stringify([s.inst, "roster", s.allowed]);
  const hit = clientsCache.get(key) as Roster | undefined;
  if (hit) return hit;
  const w = parseWindow(null, null, now);
  const cores = await accountsCore(s, { from: w.from, to: w.to, location: null, q: null, industry: null, level: null }, now);
  const ids = cores.map((c) => c.locationId);
  const db = sql();
  const [bill, vert, mail, out, newest, people, owners] = await Promise.all([
    billingRows(s.inst, ids),
    ids.length ? db`select location_id, vertical from account_profiles where installation_id = ${s.inst} and location_id = any(${ids}::text[])`.catch(() => []) : [],
    ids.length ? db`select location_id, email from locations where installation_id = ${s.inst} and location_id = any(${ids}::text[])` : [],
    ids.length ? db`select location_id, max(at) m from touch_events where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and direction = 'outbound' and kind = 'message' and not automated and user_id is not null group by 1`.catch(() => []) : [],
    ids.length ? db`select location_id, max(date_added) m from cached_contacts where installation_id = ${s.inst} and location_id = any(${ids}::text[]) group by 1`.catch(() => []) : [],
    ids.length ? db`select location_id, count(*)::int c from location_users where installation_id = ${s.inst} and location_id = any(${ids}::text[]) group by 1`.catch(() => []) : [],
    ownersOf(s.inst, ids).catch(() => ({ ready: false, owners: {} as Record<string, string> })),
  ]);
  const by = (rows: unknown, col: string) => new Map((rows as Record<string, unknown>[]).map((r) => [r.location_id as string, r[col]]));
  const vBy = by(vert, "vertical"), eBy = by(mail, "email"), oBy = by(out, "m"), nBy = by(newest, "m"), pBy = by(people, "c");
  const quietDays = DEFAULT_QUIET_DAYS;
  const rows: Cl2Row[] = cores.map((c) => {
    const last = [oBy.get(c.locationId), nBy.get(c.locationId)].map((v) => (v ? new Date(v as string | Date).getTime() : 0)).reduce((a, b) => Math.max(a, b), 0);
    const lastIso = last ? new Date(last).toISOString() : null;
    const age = last ? Math.floor((now - last) / DAY) : null;
    const v = (vBy.get(c.locationId) as string | null | undefined) ?? null;
    return {
      locationId: c.locationId, name: c.name, email: (eBy.get(c.locationId) as string | null | undefined) ?? null, vertical: v, verticalLabel: vlabel(v), manager: owners.owners[c.locationId] ?? null,
      plan: planOf(bill.get(c.locationId) as BillingRow | undefined, now),
      level: c.level, summary: c.summary, waiting: c.waiting, openValue: c.openValue,
      lastActivityAt: lastIso, quietDays: age, quiet: age !== null ? age >= quietDays : !!c.lastSyncAt, people: Number(pBy.get(c.locationId) ?? 0), peopleQuiet: c.staffIdle,
      url: links.account(c.locationId),
    };
  });
  const out2: Roster = { rows, cores: new Map(cores.map((c) => [c.locationId, c])), builtAt: now, quietDays };
  clientsCache.set(key, out2);
  return out2;
}

export async function list(s: Scope, links: Links, f: Cl2Filter, o: { sort: Cl2Sort; cursor: string | null; size: number }, now = Date.now()): Promise<Cl2List> {
  const r = await roster(s, links, now);
  const hits = sortRows(r.rows.filter((x) => matches(x, f)), o.sort);
  const p = pageAfter(hits, o.sort, decodeCursor(o.cursor), o.size);
  return { rows: p.rows, total: hits.length, next: p.next, size: o.size, all: r.rows.length };
}

export async function options(s: Scope, links: Links, now = Date.now()): Promise<Cl2Options> {
  const r = await roster(s, links, now);
  const STATUS: Record<string, string> = { paid: "Paid up", past_due: "Past due", cancelled: "Cancelled", paused: "Paused", other: "Other", none: "Not on a paid plan", unknown: "Not checked" };
  const LEVEL: Record<string, string> = { act: "Act now", watch: "Keep an eye", ok: "Fine", unknown: "No data yet" };
  return {
    total: r.rows.length,
    status: [{ key: "attention", label: "Plans needing a look", count: r.rows.filter((x) => needsPlanLook(x.plan.pay)).length }, ...facetsOf(r.rows, (x) => x.plan.pay, (k) => STATUS[k] ?? k)],
    plan: facetsOf(r.rows, (x) => x.plan.name),
    health: facetsOf(r.rows, (x) => x.level, (k) => LEVEL[k] ?? k),
    vertical: [...facetsOf(r.rows, (x) => x.vertical, (k) => vlabel(k) ?? k), ...(r.rows.some((x) => x.vertical === null) ? [{ key: "none", label: "No kind set", count: r.rows.filter((x) => x.vertical === null).length }] : [])],
    manager: [...facetsOf(r.rows, (x) => x.manager), ...(r.rows.some((x) => x.manager === null) ? [{ key: "none", label: "No manager", count: r.rows.filter((x) => x.manager === null).length }] : [])],
    verticals: VERTICALS.map((v) => ({ value: v, label: VERTICAL_LABEL[v] })),
    quietDays: r.quietDays,
  };
}

export async function today(s: Scope, links: Links, now = Date.now()): Promise<Cl2Today> {
  const r = await roster(s, links, now);
  const access = planAccessOf(r.rows), t = todayOf({ rows: r.rows, planAccess: access });
  const cnt = (f: Cl2Filter) => r.rows.filter((x) => matches(x, f)).length;
  return {
    headline: t.headline, button: t.button,
    tiles: [
      { key: "past_due", label: "Past due", count: cnt({ status: "past_due" }), filter: { status: "past_due" } },
      { key: "act", label: "Need you now", count: cnt({ level: "act" }), filter: { level: "act" } },
      { key: "plans", label: "Plans to look at", count: cnt({ status: "attention" }), filter: { status: "attention" } },
      { key: "quiet", label: `Quiet ${r.quietDays} days`, count: cnt({ quiet: true }), filter: { quiet: true } },
    ],
    atRisk: atRiskOf(r.rows), planAccess: access,
  };
}

/** Plans needing attention: every account whose paid plan is past due, cancelled, paused or in a status we do not recognise, longest in that state first, with the agency's own note. */
export async function plans(s: Scope, links: Links, o: { cursor: string | null; size: number }, now = Date.now()): Promise<Cl2Attention> {
  const r = await roster(s, links, now);
  const hits = r.rows.filter((x) => needsPlanLook(x.plan.pay)).sort((a, b) => (b.plan.daysInStatus ?? -1) - (a.plan.daysInStatus ?? -1) || (b.plan.monthly ?? 0) - (a.plan.monthly ?? 0) || a.name.localeCompare(b.name) || a.locationId.localeCompare(b.locationId));
  const after = decodeCursor(o.cursor);
  let start = 0;
  if (after) { start = hits.findIndex((x) => x.locationId === after.id); start = start < 0 ? hits.length : start + 1; }
  const page = hits.slice(start, start + o.size);
  const ids = page.map((x) => x.locationId);
  let notes: Record<string, unknown>[] = [];
  if (ids.length) notes = await sql()`select distinct on (location_id) location_id, body, created_at from cl2_notes where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and kind = 'plan' order by location_id, created_at desc`.catch(() => []);
  const nBy = new Map(notes.map((x) => [x.location_id as string, x]));
  const last = page[page.length - 1];
  const firstSeen = hits.map((x) => x.plan.since).filter((x): x is string => !!x).sort()[0] ?? null;
  const access = planAccessOf(r.rows);
  return {
    rows: page.map((x) => ({ ...x, note: (nBy.get(x.locationId)?.body as string | undefined) ?? null, noteAt: iso(nBy.get(x.locationId)?.created_at) })),
    total: hits.length, next: last && start + o.size < hits.length ? encodeCursor({ k: 0, n: "", id: last.locationId }) : null,
    atRisk: atRiskOf(hits), needPermission: access === "needs_permission", notChecked: access === "not_checked",
    sinceNote: firstSeen ? `Days are counted from when SubSync first saw each status (${firstSeen.slice(0, 10)} at the earliest). The platform does not keep older history.` : null,
  };
}

// ---------- the account page ----------

const clean = (v: string | null) => v?.replace(/\s+/g, " ").trim() ?? "";
export async function account(s: Scope, links: Links, id: string, canNote: boolean, now = Date.now()): Promise<Cl2Account | null> {
  const loc = cleanId(id);
  if (!loc) return null;
  const r = await roster(s, links, now);
  const row = r.rows.find((x) => x.locationId === loc), core = r.cores.get(loc);
  if (!row || !core) return null;
  const db = sql();
  const [bill, events, wallet, act, appts, contactsN, notes, setupRows, rcpt, userN] = await Promise.all([
    db`select subscription_id, trial_days, user_limit, contact_limit, http_status, reason from client_billing where installation_id = ${s.inst} and location_id = ${loc}`.catch(() => []),
    db`select at, from_status, to_status from cl2_plan_events where installation_id = ${s.inst} and location_id = ${loc} order by at desc limit 12`.catch(() => []),
    db`select wallet_state, wallet_balance, wallet_credits, wallet_at from client_billing where installation_id = ${s.inst} and location_id = ${loc}`.catch(() => []),
    db`select (select max(last_message_at) from cached_conversations where installation_id = ${s.inst} and location_id = ${loc} and last_message_direction = 'inbound') inbound,
        (select max(at) from touch_events where installation_id = ${s.inst} and location_id = ${loc} and direction = 'outbound' and kind = 'message' and not automated and user_id is not null) outbound,
        (select max(date_added) from cached_contacts where installation_id = ${s.inst} and location_id = ${loc}) contact`.catch(() => []),
    db`select (select min(start_at) from cached_appointments where installation_id = ${s.inst} and location_id = ${loc} and start_at > now() and status not in ('cancelled', 'invalid')) next_at,
        (select max(start_at) from cached_appointments where installation_id = ${s.inst} and location_id = ${loc} and start_at <= now() and status not in ('cancelled', 'invalid')) last_at`.catch(() => []),
    db`select contacts from client_rollup_state where installation_id = ${s.inst} and location_id = ${loc}`.catch(() => []),
    canNote ? listNotes(s.inst, loc) : Promise.resolve([] as Cl2Note[]),
    setup(s, { from: new Date(now - 30 * DAY), to: new Date(now), location: loc }, { page: 0, size: 20 }, now).catch(() => null),
    receipt(s, { q: null, industry: null }, loc, null, now).catch(() => null),
    db`select count(*)::int c from location_users where installation_id = ${s.inst} and location_id = ${loc}`.catch(() => [{ c: 0 }]),
  ]);
  const b = (bill as Record<string, unknown>[])[0] ?? {}, w = (wallet as Record<string, unknown>[])[0] ?? {}, a = (act as Record<string, unknown>[])[0] ?? {}, ap = (appts as Record<string, unknown>[])[0] ?? {};
  const su = setupRows?.rows[0] ?? null, rc = rcpt && "lines" in rcpt ? (rcpt as Cl3Receipt) : null;
  const walletState = (w.wallet_state as string | null) ?? null;
  const walletOk = walletState === "ok";
  const contacts = (contactsN as Record<string, unknown>[])[0] ? n((contactsN as Record<string, unknown>[])[0].contacts) : null;
  const users = n((userN as Record<string, unknown>[])[0]?.c);
  const showRate = rate(core.showed, core.showed + core.noshowN, 5);
  const staleN = core.staleDealsPct.n, openDeals = core.staleDealsPct.of;
  const checklist = [
    { id: "connected", ok: !!core.lastSyncAt, text: core.lastSyncAt ? "Connected and read" : "Not read yet" },
    { id: "fresh", ok: !core.syncOld, text: core.syncOld ? "Data is out of date (older than a day)" : "Data is fresh" },
    { id: "permissions", ok: core.needsPermission.length === 0, text: core.needsPermission.length ? "Needs permission: reconnect" : "All permissions in place" },
    { id: "team", ok: users > 0, text: users > 0 ? `${users} team ${users === 1 ? "member" : "members"} found` : "No team members found" },
    { id: "plan", ok: row.plan.state === "ok" || row.plan.state === "no_plan", text: row.plan.state === "ok" ? `On the paid plan "${row.plan.name ?? "unnamed"}"` : row.plan.state === "no_plan" ? "Not on a paid plan from you" : row.plan.payLabel },
    { id: "manager", ok: !!row.manager, text: row.manager ? `Looked after by ${row.manager}` : "Nobody looks after this client yet" },
    { id: "kind", ok: !!row.vertical, text: row.vertical ? `Kind of business: ${row.verticalLabel}` : "Kind of business not set" },
  ];
  const summary = [
    `${row.name}`,
    `Paid plan: ${row.plan.state === "ok" ? `${row.plan.name ?? "unnamed"}, ${row.plan.payLabel.toLowerCase()}` : row.plan.payLabel}`,
    `Health: ${row.summary ?? (row.level === "unknown" ? "no data yet" : "all good")}`,
    `Leads waiting for a reply: ${core.waiting}${core.waitingOld ? ` (${core.waitingOld} over a day)` : ""}`,
    `Typical first reply: ${core.medianReplyMinutes === null ? "not enough data" : `${Math.round(core.medianReplyMinutes)} min`}`,
    `Show rate: ${showRate.enough && showRate.value !== null ? `${Math.round(showRate.value * 100)}% of ${showRate.of}` : "not enough data"}`,
    `Open deals: ${openDeals} worth $${Math.round(core.openValue).toLocaleString("en-US")}`,
  ].join("\n");
  const history = (events as Record<string, unknown>[]).map((e) => ({ at: iso(e.at) as string, from: (e.from_status as string | null) ?? null, to: (e.to_status as string | null) ?? null }));
  return {
    locationId: loc, name: row.name, email: row.email, url: row.url, row,
    plan: { ...row.plan, subscriptionId: (b.subscription_id as string | null) ?? null, trialDays: b.trial_days === null || b.trial_days === undefined ? null : n(b.trial_days), userLimit: b.user_limit === null || b.user_limit === undefined ? null : n(b.user_limit), contactLimit: b.contact_limit === null || b.contact_limit === undefined ? null : n(b.contact_limit), httpStatus: (b.http_status as number | null) ?? null, reason: (b.reason as string | null) ?? null, history, historyStarts: row.plan.since?.slice(0, 10) ?? null },
    wallet: walletOk
      ? { state: "ok", balance: w.wallet_balance === null ? null : n(w.wallet_balance), credits: w.wallet_credits === null ? null : n(w.wallet_credits), checkedAt: iso(w.wallet_at), message: "Credit balance as the platform reports it." }
      : walletState === "needs_permission" ? { state: "needs_permission", balance: null, credits: null, checkedAt: iso(w.wallet_at), message: "Needs permission: reconnect and allow wallet access to see the credit balance." }
      : walletState === "not_available" ? { state: "not_available", balance: null, credits: null, checkedAt: iso(w.wallet_at), message: "Not available from the platform yet." }
      : { state: "not_checked", balance: null, credits: null, checkedAt: null, message: "Not read yet. The next hourly read fills this in." },
    usage: { contacts, contactLimit: b.contact_limit === null || b.contact_limit === undefined ? null : n(b.contact_limit), users, userLimit: b.user_limit === null || b.user_limit === undefined ? null : n(b.user_limit) },
    activity: { lastInboundAt: iso(a.inbound), lastOutboundAt: iso(a.outbound), lastContactAt: iso(a.contact), nextAppointmentAt: iso(ap.next_at), lastAppointmentAt: iso(ap.last_at), lastSyncAt: core.lastSyncAt },
    health: { level: core.level, summary: core.summary, reasons: core.reasons.map((x) => ({ reason: x.reason, label: x.label, why: x.why, count: x.count })), historyStarts: core.historyStarts },
    work: {
      openValue: core.openValue, staleDealsPct: core.staleDealsPct.enough ? core.staleDealsPct.value : null, staleDealsN: staleN, openDeals, medianReplyMinutes: core.medianReplyMinutes, waiting: core.waiting, waitingOld: core.waitingOld,
      showRate: showRate.enough ? showRate.value : null, showRateN: showRate.of, unmarked: core.unmarked, noshows: core.noshows, newLeads: core.newLeads.current, wonValue: core.wonValue.current,
    },
    setup: su
      ? { connected: su.connected, syncOld: su.syncOld, message: su.message, scopes: su.scopes, channelsSeen: su.channelsSeen, needsHelp: su.needsHelp, contacts: su.contacts, conversations: su.conversations, appointments: su.appointments, deals: su.deals }
      : { connected: !!core.lastSyncAt, syncOld: core.syncOld, message: null, scopes: { calendar: "unknown", users: "unknown" }, channelsSeen: [], needsHelp: [], contacts: contacts ?? 0, conversations: 0, appointments: 0, deals: 0 },
    team: { people: users, quiet: core.staffIdle },
    apps: { available: false, message: "Not available from the platform yet. The platform does not tell SubSync which apps are installed in a client account." },
    checklist,
    receipt: rc ? { lines: rc.lines, weekStart: rc.weekStart, enough: rc.enough } : null,
    summary, notes,
  };
}

// ---------- notes, next steps and promises (SubSync-only) ----------

const NOTE_KINDS = ["note", "next_step", "promise", "plan"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const isNoteKind = (v: unknown): v is NoteKind => typeof v === "string" && (NOTE_KINDS as readonly string[]).includes(v);
const noteOf = (r: Record<string, unknown>): Cl2Note => ({ id: r.id as string, kind: r.kind as NoteKind, body: r.body as string, pinned: r.pinned === true, done: r.done === true, dueOn: r.due_on ? String(r.due_on).slice(0, 10) : null, author: (r.author as string | null) ?? null, createdAt: iso(r.created_at) as string, updatedAt: iso(r.updated_at) as string });
export async function listNotes(inst: string, loc: string): Promise<Cl2Note[]> {
  try {
    const rows = await sql()`select id, kind, body, pinned, done, due_on, author, created_at, updated_at from cl2_notes where installation_id = ${inst} and location_id = ${loc} order by pinned desc, done asc, created_at desc limit 200`;
    return rows.map(noteOf);
  } catch { return []; }
}
export const parseNoteBody = (v: unknown): string | null => { const t = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : ""; return t.length >= 1 && t.length <= 2000 ? t : null; };
export const parseDue = (v: unknown): string | null | undefined => (v === null || v === "" || v === undefined ? null : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) ? v : undefined);
/** The words a person types to delete a note: its first words, so the confirmation names the item. */
export const noteTitle = (body: string): string => clean(body).slice(0, 30);

export async function addNote(inst: string, loc: string, p: { kind: NoteKind; body: string; dueOn: string | null; pinned: boolean; author: string | null }): Promise<Cl2Note | null> {
  try {
    const rows = await sql()`insert into cl2_notes (installation_id, location_id, kind, body, due_on, pinned, author) values (${inst}, ${loc}, ${p.kind}, ${p.body}, ${p.dueOn}, ${p.pinned}, ${p.author})
      returning id, kind, body, pinned, done, due_on, author, created_at, updated_at`;
    return rows[0] ? noteOf(rows[0]) : null;
  } catch { return null; }
}
export async function updateNote(inst: string, loc: string, id: string, p: { body?: string; pinned?: boolean; done?: boolean; dueOn?: string | null }): Promise<Cl2Note | null> {
  const db = sql();
  const cur = (await db`select id, kind, body, pinned, done, due_on, author, created_at, updated_at from cl2_notes where installation_id = ${inst} and location_id = ${loc} and id = ${id}::uuid`.catch(() => []))[0];
  if (!cur) return null;
  const rows = await db`update cl2_notes set body = ${p.body ?? (cur.body as string)}, pinned = ${p.pinned ?? cur.pinned === true}, done = ${p.done ?? cur.done === true}, due_on = ${p.dueOn === undefined ? (cur.due_on as string | null) : p.dueOn}, updated_at = now()
    where installation_id = ${inst} and location_id = ${loc} and id = ${id}::uuid returning id, kind, body, pinned, done, due_on, author, created_at, updated_at`;
  return rows[0] ? noteOf(rows[0]) : null;
}
export async function noteBody(inst: string, loc: string, id: string): Promise<string | null> {
  const r = await sql()`select body from cl2_notes where installation_id = ${inst} and location_id = ${loc} and id = ${id}::uuid`.catch(() => []);
  return r[0] ? (r[0].body as string) : null;
}
export async function removeNote(inst: string, loc: string, id: string): Promise<boolean> {
  const r = await sql()`delete from cl2_notes where installation_id = ${inst} and location_id = ${loc} and id = ${id}::uuid returning 1`.catch(() => []);
  return r.length > 0;
}

// ---------- kind of business (vertical), saved views, export ----------

/** Set the kind of business on accounts the caller already proved are theirs. null clears it. Returns how many were written. */
export async function setVertical(inst: string, ids: string[], vertical: Vertical | null): Promise<number> {
  let done = 0;
  for (const id of ids) {
    await sql()`insert into account_profiles (installation_id, location_id, vertical) values (${inst}, ${id}, ${vertical})
      on conflict (installation_id, location_id) do update set vertical = excluded.vertical, updated_at = now()`;
    done++;
  }
  return done;
}

const VIEW_PAGE = "clients2";
export async function listViews(inst: string, owner: string): Promise<Cl2View[]> {
  const rows = await sql()`select id, name, filters from saved_views where installation_id = ${inst} and owner = ${owner} and page = ${VIEW_PAGE} order by name limit 30`.catch(() => []);
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, filters: (r.filters && typeof r.filters === "object" ? r.filters : {}) as Record<string, string> }));
}
const FILTER_KEYS = ["q", "status", "plan", "level", "vertical", "manager", "quiet", "sort"];
export function cleanFilters(v: unknown): Record<string, string> {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const k of FILTER_KEYS) { const x = o[k]; if ((typeof x === "string" || typeof x === "boolean") && String(x).trim()) out[k] = String(x).trim().slice(0, 80); }
  return out;
}
export async function saveView(inst: string, owner: string, name: string, filters: Record<string, string>): Promise<Cl2View | null> {
  const rows = await sql()`insert into saved_views (installation_id, owner, page, name, filters) values (${inst}, ${owner}, ${VIEW_PAGE}, ${name}, ${sql().json(filters as never)})
    on conflict (installation_id, owner, page, name) do update set filters = excluded.filters returning id, name, filters`.catch(() => []);
  return rows[0] ? { id: rows[0].id as string, name: rows[0].name as string, filters } : null;
}
export async function viewName(inst: string, owner: string, id: string): Promise<string | null> {
  const r = await sql()`select name from saved_views where installation_id = ${inst} and owner = ${owner} and page = ${VIEW_PAGE} and id = ${id}::uuid`.catch(() => []);
  return r[0] ? (r[0].name as string) : null;
}
export async function removeView(inst: string, owner: string, id: string): Promise<boolean> {
  const r = await sql()`delete from saved_views where installation_id = ${inst} and owner = ${owner} and page = ${VIEW_PAGE} and id = ${id}::uuid returning 1`.catch(() => []);
  return r.length > 0;
}

/** A spreadsheet cell that starts with = + - @ is read as a formula: prefix it so it stays text. */
export const csvCell = (v: unknown): string => {
  let t = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
export async function exportCsv(s: Scope, links: Links, f: Cl2Filter, now = Date.now()): Promise<string> {
  const r = await roster(s, links, now);
  const head = ["Account", "Email", "Paid plan", "Payment status", "Price per month", "Currency", "Days in this status", "Health", "Leads waiting", "Open deals value", "Last activity", "Manager", "Kind of business"];
  const lines = sortRows(r.rows.filter((x) => matches(x, f)), "attention").map((x) => [x.name, x.email, x.plan.name, x.plan.payLabel, x.plan.monthly, x.plan.currency, x.plan.daysInStatus, x.summary ?? x.level, x.waiting, Math.round(x.openValue), x.lastActivityAt?.slice(0, 10), x.manager, x.verticalLabel].map(csvCell).join(","));
  return [head.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}
