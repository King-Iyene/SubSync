import { createHash } from "node:crypto";
import { sql } from "../db";
import { decodeKey, encodeKey, isDay, addDays, cleanAmount, statementCsv, type CsvLine, type PayBasis, type Role } from "./finance-core";
import { financeCache, forgetFinance, getSettings, nameMap, type Range, type Scope } from "./finance-queries";
import { ownedUser, visibleMember, type Scope as PScope } from "./people3-queries";

// The setter and closer payout report. READ ONLY against the CRM copies; the rates, the frozen periods and the disputes are SubSync's own records.
// Setter: whoever booked the appointment (the CRM's "booked by"), else the lead's owner. Closer: the person the appointment is assigned to. Docs: docs/NEEDS_KING.md item 8.
// The caller is a manager (level "all": agency owner or admin) or anyone else, who is forced to their OWN lines in SQL below (`self`), never trusting a person id from the request.

type Db = ReturnType<typeof sql>;
type Frag = import("postgres").PendingQuery<import("postgres").Row[]>;
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(v as string).toISOString() : null);

export type Who = { level: "all" | "other"; selfId: string | null };
export type PayWin = { from: string; toEx: string; basis: PayBasis; windowDays: number };

/** The counted source rows for one period, all three kinds. Each row names the three people who could be paid: who booked, the lead's owner, and who the appointment is assigned to. */
function source(db: Db, inst: string, ids: string[], w: PayWin): Frag {
  const base = (kind: string, at: Frag, cond: Frag) => db`
    select a.location_id, a.appointment_id::text ref_id, ${kind}::text kind, ${at} at, null::numeric value, a.booked_by_user, c.assigned_to lead_owner, a.assigned_to closer
    from cached_appointments a left join cached_contacts c on c.installation_id = a.installation_id and c.location_id = a.location_id and c.contact_id = a.contact_id
    where a.installation_id = ${inst} and a.location_id = any(${ids}::text[]) and ${cond}`;
  return db`
    ${base("booked", db`a.created_remote_at`, db`a.created_remote_at >= ${w.from}::date and a.created_remote_at < ${w.toEx}::date and lower(coalesce(a.status, '')) not in ('cancelled', 'invalid')`)}
    union all
    ${base("showed", db`a.start_at`, db`a.start_at >= ${w.from}::date and a.start_at < ${w.toEx}::date and lower(coalesce(a.status, '')) = 'showed'`)}
    union all
    select o.location_id, o.opportunity_id::text ref_id, 'won'::text kind, o.last_status_change_at at, o.monetary_value value, ap.booked_by_user, c.assigned_to lead_owner, ap.assigned_to closer
    from cached_opportunities o
    join lateral (select a.booked_by_user, a.assigned_to from cached_appointments a
      where a.installation_id = o.installation_id and a.location_id = o.location_id and a.contact_id = o.contact_id and a.start_at <= o.last_status_change_at
        and a.start_at >= o.last_status_change_at - make_interval(days => ${w.windowDays}) and lower(coalesce(a.status, '')) not in ('cancelled', 'invalid') order by a.start_at desc limit 1) ap on true
    left join cached_contacts c on c.installation_id = o.installation_id and c.location_id = o.location_id and c.contact_id = o.contact_id
    where o.installation_id = ${inst} and o.location_id = any(${ids}::text[]) and o.status = 'won' and coalesce(o.monetary_value, 0) > 0 and o.last_status_change_at >= ${w.from}::date and o.last_status_change_at < ${w.toEx}::date`;
}

/** Every counted line with its person, rate and amount. Only lines of the chosen basis carry an amount. `only` narrows to one person (the private statement). */
function rated(db: Db, inst: string, ids: string[], w: PayWin, only: string | null): Frag {
  return db`
    with s as materialized (${source(db, inst, ids, w)})
    select l.*, l.kind || ':' || l.location_id || ':' || l.ref_id || ':' || l.role line_key, coalesce(r.pct, 0)::float8 pct, coalesce(r.flat, 0)::float8 flat,
      case when l.kind = ${w.basis} then round((coalesce(r.flat, 0) + case when l.kind = 'won' then coalesce(l.value, 0) * coalesce(r.pct, 0) / 100 else 0 end)::numeric, 2) else 0 end::float8 amount
    from (
      select s.location_id, s.ref_id, s.kind, s.at, s.value::float8 value, 'setter'::text role, coalesce(nullif(s.booked_by_user, ''), nullif(s.lead_owner, '')) person from s
      union all
      select s.location_id, s.ref_id, s.kind, s.at, s.value::float8 value, 'closer'::text role, nullif(s.closer, '') person from s
    ) l
    left join lateral (select r.pct, r.flat from fn_pay_rates r where r.installation_id = ${inst} and r.role = l.role and r.person_id in (l.person, '') and r.location_id in (l.location_id, '')
      order by (r.person_id <> '')::int * 2 + (r.location_id <> '')::int desc limit 1) r on true
    where l.person is not null and l.person not like '~%' ${only ? db`and l.person = ${only}` : db``}`;
}

/** Every account id the caller may read (the plan's allowed list, or all of the company's accounts). */
async function idsOf(s: Scope): Promise<string[]> {
  if (s.allowed) return s.allowed;
  const rows = await sql()`select location_id from locations where installation_id = ${s.inst} and not ignored limit 5000`;
  return rows.map((y) => y.location_id as string);
}

export const rangeWin = (r: Range, basis: PayBasis, windowDays: number): PayWin => ({ from: r.from, toEx: addDays(r.to, 1), basis, windowDays });

export type PayPerson = { personId: string; name: string; roleLabel: string | null; booked: number; showed: number; closed: number; wonValue: number; setWonValue: number; counted: number; paying: number; disputed: number; payable: number; held: number };

export async function summary(s: Scope, who: Who, r: Range, basis: PayBasis, o: { cursor: string | null; size: number; q: string | null }) {
  const db = sql(), st = await getSettings(s.inst);
  const ids = await idsOf(s);
  const empty = { rows: [] as PayPerson[], total: 0, next: null as string | null, totals: { booked: 0, showed: 0, closed: 0, wonValue: 0, payable: 0, held: 0, counted: 0, paying: 0, disputed: 0 }, currency: st.currency, unattributed: { count: 0, value: 0 }, basis, range: r, windowDays: st.dealWindowDays };
  if (who.level !== "all" || !ids.length) return empty;
  const w = rangeWin(r, basis, st.dealWindowDays);
  const key = JSON.stringify([s.inst, "paysum", createHash("sha1").update(ids.join(",")).digest("hex").slice(0, 16), r, basis, st.dealWindowDays]);
  type Sum = { rows: PayPerson[]; unatt: { count: number; value: number } };
  let sum = financeCache.get(key) as Sum | undefined;
  if (!sum) {
    const rows = await db`
      select b.person, count(*) filter (where b.role = 'setter' and b.kind = 'booked')::int booked, count(*) filter (where b.role = 'setter' and b.kind = 'showed')::int showed,
        count(*) filter (where b.role = 'closer' and b.kind = 'won')::int closed, coalesce(sum(b.value) filter (where b.role = 'closer' and b.kind = 'won'), 0)::float8 won_value,
        coalesce(sum(b.value) filter (where b.role = 'setter' and b.kind = 'won'), 0)::float8 set_won, count(*) filter (where b.kind = ${basis})::int counted, count(*) filter (where b.kind = ${basis} and b.amount > 0)::int paying,
        count(*) filter (where b.kind = ${basis} and d.line_key is not null)::int disputed, coalesce(sum(b.amount) filter (where d.line_key is null), 0)::float8 payable, coalesce(sum(b.amount) filter (where d.line_key is not null), 0)::float8 held
      from (${rated(db, s.inst, ids, w, null)}) b
      left join fn_pay_disputes d on d.installation_id = ${s.inst} and d.line_key = b.line_key and d.status = 'open'
      group by b.person limit 2000`;
    const un = await db`select count(*)::int c, coalesce(sum(o.monetary_value), 0)::float8 v from cached_opportunities o where o.installation_id = ${s.inst} and o.location_id = any(${ids}::text[]) and o.status = 'won'
      and coalesce(o.monetary_value, 0) > 0 and o.last_status_change_at >= ${w.from}::date and o.last_status_change_at < ${w.toEx}::date
      and not exists (select 1 from cached_appointments a where a.installation_id = o.installation_id and a.location_id = o.location_id and a.contact_id = o.contact_id and a.start_at <= o.last_status_change_at
        and a.start_at >= o.last_status_change_at - make_interval(days => ${w.windowDays}) and lower(coalesce(a.status, '')) not in ('cancelled', 'invalid'))`;
    const names = await nameMap(s.inst, rows.map((x) => x.person as string));
    const roles = await db`select user_id, role from team_member_roles where installation_id = ${s.inst} and location_id = '' and user_id = any(${rows.map((x) => x.person as string)}::text[])`.catch(() => []);
    const RL = new Map(roles.map((x) => [x.user_id as string, x.role as string]));
    sum = {
      rows: rows.map((x) => ({ personId: x.person as string, name: names.get(x.person as string) ?? "Team member", roleLabel: RL.get(x.person as string) ?? null, booked: n(x.booked), showed: n(x.showed), closed: n(x.closed), wonValue: n(x.won_value), setWonValue: n(x.set_won), counted: n(x.counted), paying: n(x.paying), disputed: n(x.disputed), payable: n(x.payable), held: n(x.held) })),
      unatt: { count: n(un[0]?.c), value: n(un[0]?.v) },
    };
    financeCache.set(key, sum);
  }
  const q = (o.q ?? "").trim().toLowerCase();
  const all = sum.rows.filter((x) => !q || x.name.toLowerCase().includes(q)).sort((a, b) => b.payable - a.payable || (a.personId < b.personId ? 1 : -1));
  const cur = decodeKey(o.cursor);
  const start = cur ? all.findIndex((x) => x.payable < Number(cur.k) || (x.payable === Number(cur.k) && x.personId < cur.id)) : 0;
  const from = start === -1 ? all.length : start, page = all.slice(from, from + o.size), last = page[page.length - 1];
  const t = all.reduce((a, x) => ({ booked: a.booked + x.booked, showed: a.showed + x.showed, closed: a.closed + x.closed, wonValue: a.wonValue + x.wonValue, payable: a.payable + x.payable, held: a.held + x.held, counted: a.counted + x.counted, paying: a.paying + x.paying, disputed: a.disputed + x.disputed }), { booked: 0, showed: 0, closed: 0, wonValue: 0, payable: 0, held: 0, counted: 0, paying: 0, disputed: 0 });
  return { rows: page, total: all.length, next: from + o.size < all.length && last ? encodeKey({ k: last.payable, id: last.personId }) : null, totals: { ...t, payable: Math.round(t.payable * 100) / 100, held: Math.round(t.held * 100) / 100 }, currency: st.currency, unattributed: sum.unatt, basis, range: r, windowDays: st.dealWindowDays };
}

export type StatementLine = { lineKey: string; at: string; locationId: string; account: string; role: Role; kind: PayBasis; refId: string; value: number | null; rate: { pct: number; flat: number }; amount: number; paid: boolean; disputed: boolean; disputeNote: string | null };
export type StatementFilter = { kind: PayBasis | null; role: Role | null; disputedOnly: boolean };

/** One person's lines for a period, newest first, keyset paged. `kind` defaults to the chosen basis (the lines that pay); other kinds are the rows behind the counts and carry no amount. */
export async function statement(s: Scope, who: Who, personId: string, r: Range, basis: PayBasis, f: StatementFilter, o: { cursor: string | null; size: number }, frozenId: string | null = null) {
  const db = sql(), st = await getSettings(s.inst);
  const ids = await idsOf(s);
  const only = who.level === "all" ? personId : who.selfId;
  const kind = f.kind ?? basis;
  const out = { rows: [] as StatementLine[], total: 0, next: null as string | null, totals: { count: 0, payable: 0, held: 0, disputed: 0, value: 0 }, person: { personId: only ?? "", name: "" }, currency: st.currency, basis, kind, range: r, frozen: frozenId !== null };
  if (!only || (!ids.length && !frozenId)) return out;
  const w = rangeWin(r, basis, st.dealWindowDays);
  const lines = frozenId
    ? db`select l.location_id, l.ref_id, l.kind, l.at, l.value::float8 value, l.role, l.person_id person, l.line_key, l.rate_pct::float8 pct, l.rate_flat::float8 flat, l.amount::float8 amount from fn_pay_lines l where l.installation_id = ${s.inst} and l.period_id = ${frozenId}::uuid and l.person_id = ${only}`
    : rated(db, s.inst, ids, w, only);
  const cur = decodeKey(o.cursor);
  const where = db`true ${kind ? db`and b.kind = ${kind}` : db``} ${f.role ? db`and b.role = ${f.role}` : db``} ${f.disputedOnly ? db`and d.line_key is not null` : db``}`;
  const base = db`select b.*, l.name account, d.line_key dk, d.note dnote from (${lines}) b left join locations l on l.installation_id = ${s.inst} and l.location_id = b.location_id
    left join fn_pay_disputes d on d.installation_id = ${s.inst} and d.line_key = b.line_key and d.status = 'open' where ${where}`;
  const [rows, tot, nm] = await Promise.all([
    db`select * from (${base}) z ${cur ? db`where (z.at, z.line_key) < (${String(cur.k)}::timestamptz, ${cur.id}::text)` : db``} order by z.at desc, z.line_key desc limit ${o.size + 1}`,
    db`select count(*)::int c, coalesce(sum(z.amount) filter (where z.dk is null), 0)::float8 p, coalesce(sum(z.amount) filter (where z.dk is not null), 0)::float8 h, count(*) filter (where z.dk is not null)::int dq, coalesce(sum(z.value), 0)::float8 v from (${base}) z`,
    nameMap(s.inst, [only]),
  ]);
  const page = rows.slice(0, o.size), last = page[page.length - 1];
  return {
    ...out, person: { personId: only, name: nm.get(only) ?? "Team member" },
    rows: page.map((x): StatementLine => ({ lineKey: x.line_key as string, at: iso(x.at) as string, locationId: x.location_id as string, account: (x.account as string | null) ?? "Client account", role: x.role as Role, kind: x.kind as PayBasis, refId: x.ref_id as string, value: x.value === null ? null : n(x.value), rate: { pct: n(x.pct), flat: n(x.flat) }, amount: n(x.amount), paid: x.kind === basis || frozenId !== null, disputed: x.dk !== null && x.dk !== undefined, disputeNote: (x.dnote as string | null) ?? null })),
    total: n(tot[0]?.c), next: rows.length > o.size && last ? encodeKey({ k: iso(last.at) as string, id: last.line_key as string }) : null,
    totals: { count: n(tot[0]?.c), payable: Math.round(n(tot[0]?.p) * 100) / 100, held: Math.round(n(tot[0]?.h) * 100) / 100, disputed: n(tot[0]?.dq), value: Math.round(n(tot[0]?.v)) },
  };
}

/** The statement as a CSV: every line (up to the cap), formula-safe cells. Same filters, so the file has exactly as many rows as the screen says. */
export async function statementFile(s: Scope, who: Who, personId: string, r: Range, basis: PayBasis, f: StatementFilter, frozenId: string | null): Promise<{ csv: string; rows: number; name: string }> {
  const lines: CsvLine[] = [];
  let cursor: string | null = null, name = "";
  for (let i = 0; i < 100; i++) {
    const p = await statement(s, who, personId, r, basis, f, { cursor, size: 100 }, frozenId);
    name = p.person.name;
    for (const x of p.rows) lines.push({ at: x.at, person: p.person.name, role: x.role, account: x.account, kind: x.kind, ref: x.refId, value: x.value, amount: x.paid ? x.amount : 0, disputed: x.disputed });
    if (!p.next) break;
    cursor = p.next;
  }
  const st = await getSettings(s.inst);
  return { csv: statementCsv(lines, st.currency), rows: lines.length, name };
}

// ---------- rates ----------

export type RateOut = { personId: string; person: string | null; locationId: string; account: string | null; role: Role; pct: number; flat: number };
export async function listRates(s: Scope): Promise<RateOut[]> {
  const db = sql();
  const rows = await db`select r.person_id, r.location_id, r.role, r.pct::float8 pct, r.flat::float8 flat, l.name account from fn_pay_rates r left join locations l on l.installation_id = r.installation_id and l.location_id = r.location_id
    where r.installation_id = ${s.inst} ${s.allowed ? db`and (r.location_id = '' or r.location_id = any(${s.allowed}::text[]))` : db``} order by r.role, r.person_id, r.location_id limit 500`;
  const names = await nameMap(s.inst, rows.map((x) => x.person_id as string).filter(Boolean));
  return rows.map((x) => ({ personId: x.person_id as string, person: x.person_id ? names.get(x.person_id as string) ?? "Team member" : null, locationId: x.location_id as string, account: x.location_id ? (x.account as string | null) ?? "Client account" : null, role: x.role as Role, pct: n(x.pct), flat: n(x.flat) }));
}
export function checkRate(b: Record<string, unknown>): { ok: true; role: Role; pct: number; flat: number } | { ok: false; error: string } {
  if (b.role !== "setter" && b.role !== "closer") return { ok: false, error: "Choose setter or closer" };
  const pct = b.pct === undefined || b.pct === "" ? 0 : Number(b.pct), flat = cleanAmount(b.flat ?? 0, 1e6);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, error: "The percentage must be 0 to 100" };
  if (flat === null) return { ok: false, error: "Enter the flat amount as a number" };
  return { ok: true, role: b.role, pct: Math.round(pct * 100) / 100, flat };
}
export async function saveRate(inst: string, personId: string, locationId: string, v: { role: Role; pct: number; flat: number }, actor: string | null): Promise<void> {
  await sql()`insert into fn_pay_rates (installation_id, person_id, location_id, role, pct, flat, updated_by) values (${inst}, ${personId}, ${locationId}, ${v.role}, ${v.pct}, ${v.flat}, ${actor})
    on conflict (installation_id, person_id, location_id, role) do update set pct = excluded.pct, flat = excluded.flat, updated_by = excluded.updated_by, updated_at = now()`;
  forgetFinance(inst);
}
export async function removeRate(inst: string, personId: string, locationId: string, role: Role): Promise<boolean> {
  const r = await sql()`delete from fn_pay_rates where installation_id = ${inst} and person_id = ${personId} and location_id = ${locationId} and role = ${role} returning role`;
  forgetFinance(inst);
  return r.length > 0;
}

// ---------- disputes ----------

/** A line key is shaped kind:account:ref:role. It is usable only when it names an account the caller may read and, for a non-manager, a line that is theirs. */
export function parseLineKey(v: unknown): { kind: PayBasis; locationId: string; refId: string; role: Role } | null {
  if (typeof v !== "string" || v.length > 400) return null;
  const m = /^(booked|showed|won):([A-Za-z0-9_-]{3,128}):([^:]{1,200}):(setter|closer)$/.exec(v);
  return m ? { kind: m[1] as PayBasis, locationId: m[2], refId: m[3], role: m[4] as Role } : null;
}
export async function raiseDispute(inst: string, key: string, loc: string, personId: string, note: string | null, actor: string | null): Promise<void> {
  await sql()`insert into fn_pay_disputes (installation_id, line_key, location_id, person_id, note, raised_by) values (${inst}, ${key}, ${loc}, ${personId}, ${note ? note.slice(0, 500) : null}, ${actor})
    on conflict (installation_id, line_key) do update set note = excluded.note, status = 'open', resolved_at = null, raised_at = now(), raised_by = excluded.raised_by`;
  forgetFinance(inst);
}
export async function resolveDispute(inst: string, key: string): Promise<boolean> {
  const r = await sql()`update fn_pay_disputes set status = 'resolved', resolved_at = now() where installation_id = ${inst} and line_key = ${key} and status = 'open' returning line_key`;
  forgetFinance(inst);
  return r.length > 0;
}
export async function disputeList(s: Scope, who: Who) {
  const db = sql();
  const rows = await db`select d.line_key, d.location_id, d.person_id, d.note, d.status, d.raised_at, l.name account from fn_pay_disputes d left join locations l on l.installation_id = d.installation_id and l.location_id = d.location_id
    where d.installation_id = ${s.inst} and d.status = 'open' ${s.allowed ? db`and d.location_id = any(${s.allowed}::text[])` : db``} ${who.level === "all" ? db`` : who.selfId ? db`and d.person_id = ${who.selfId}` : db`and false`} order by d.raised_at desc limit 100`;
  const names = await nameMap(s.inst, rows.map((x) => x.person_id as string));
  return rows.map((x) => ({ lineKey: x.line_key as string, locationId: x.location_id as string, account: (x.account as string | null) ?? "Client account", personId: x.person_id as string, person: names.get(x.person_id as string) ?? "Team member", note: (x.note as string | null) ?? null, raisedAt: iso(x.raised_at) as string }));
}
/** Is this line one the caller may flag: a manager, or the person it pays. Checked against the live lines, so a made-up key finds nothing. */
export async function lineExists(s: Scope, who: Who, key: string, r: Range, basis: PayBasis): Promise<{ personId: string; locationId: string } | null> {
  const k = parseLineKey(key);
  if (!k) return null;
  const rows = await statementForKey(s, who, k, r, basis);
  return rows;
}
async function statementForKey(s: Scope, who: Who, k: { kind: PayBasis; locationId: string; refId: string; role: Role }, r: Range, basis: PayBasis) {
  const db = sql(), st = await getSettings(s.inst);
  if (s.allowed && !s.allowed.includes(k.locationId)) return null;
  const w = rangeWin(r, basis, st.dealWindowDays);
  const rows = await db`select b.person from (${rated(db, s.inst, [k.locationId], w, who.level === "all" ? null : who.selfId)}) b where b.line_key = ${`${k.kind}:${k.locationId}:${k.refId}:${k.role}`} limit 1`;
  return rows[0] ? { personId: rows[0].person as string, locationId: k.locationId } : null;
}
/** A line of a FROZEN period (read from the copy, never recomputed). */
export async function frozenLine(s: Scope, who: Who, periodId: string, key: string): Promise<{ personId: string; locationId: string } | null> {
  const db = sql();
  const rows = await db`select person_id, location_id from fn_pay_lines where installation_id = ${s.inst} and period_id = ${periodId}::uuid and line_key = ${key} ${who.level === "all" ? db`` : who.selfId ? db`and person_id = ${who.selfId}` : db`and false`} ${s.allowed ? db`and location_id = any(${s.allowed}::text[])` : db``}`;
  return rows[0] ? { personId: rows[0].person_id as string, locationId: rows[0].location_id as string } : null;
}

// ---------- freeze / lock ----------

const UUID = /^[0-9a-f-]{36}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export type PeriodRow = { id: string; label: string; from: string; to: string; basis: PayBasis; currency: string; lines: number; accounts: number; total: number; frozenAt: string; frozenBy: string | null };

export async function listPeriods(s: Scope): Promise<PeriodRow[]> {
  const rows = await sql()`select id, label, date_from::text f, date_to::text t, basis, currency, line_count, accounts, total::float8 total, frozen_at, frozen_by from fn_pay_periods where installation_id = ${s.inst} order by date_from desc, frozen_at desc limit 100`;
  return rows.map((x) => ({ id: x.id as string, label: x.label as string, from: x.f as string, to: x.t as string, basis: x.basis as PayBasis, currency: x.currency as string, lines: n(x.line_count), accounts: n(x.accounts), total: n(x.total), frozenAt: iso(x.frozen_at) as string, frozenBy: (x.frozen_by as string | null) ?? null }));
}
export const periodLabel = (r: Range, basis: PayBasis) => `${r.from} to ${r.to} (${basis})`;

export async function freezePeriod(s: Scope, r: Range, basis: PayBasis, actor: string | null): Promise<{ ok: true; id: string; lines: number } | { ok: false; error: string; status: number }> {
  if (!isDay(r.from) || !isDay(r.to) || r.to < r.from) return { ok: false, error: "Choose the dates", status: 400 };
  const db = sql(), st = await getSettings(s.inst);
  const ids = await idsOf(s);
  if (!ids.length) return { ok: false, error: "There are no client accounts to freeze", status: 400 };
  const w = rangeWin(r, basis, st.dealWindowDays);
  const label = periodLabel(r, basis);
  return await db.begin(async (tx) => {
    const t = tx as unknown as Db;
    const made = await t`insert into fn_pay_periods (installation_id, label, date_from, date_to, basis, currency, accounts, frozen_by) values (${s.inst}, ${label}, ${r.from}::date, ${r.to}::date, ${basis}, ${st.currency}, ${ids.length}, ${actor})
      on conflict (installation_id, date_from, date_to, basis) do nothing returning id`;
    if (!made[0]) return { ok: false as const, error: "This period is already frozen. Open it in Frozen periods.", status: 409 };
    const id = made[0].id as string;
    await t`insert into fn_pay_lines (period_id, installation_id, line_key, location_id, person_id, role, kind, ref_id, at, value, rate_pct, rate_flat, amount)
      select ${id}::uuid, ${s.inst}, b.line_key, b.location_id, b.person, b.role, b.kind, b.ref_id, b.at, b.value, b.pct, b.flat, b.amount from (${rated(t, s.inst, ids, w, null)}) b where b.kind = ${basis}
      on conflict (period_id, line_key) do nothing`;
    const tot = await t`select count(*)::int c, coalesce(sum(amount), 0)::float8 s from fn_pay_lines where period_id = ${id}::uuid`;
    await t`update fn_pay_periods set line_count = ${n(tot[0]?.c)}, total = ${n(tot[0]?.s)} where id = ${id}::uuid`;
    return { ok: true as const, id, lines: n(tot[0]?.c) };
  }) as { ok: true; id: string; lines: number } | { ok: false; error: string; status: number };
}
export async function periodOwn(inst: string, id: unknown): Promise<PeriodRow | null> {
  if (!isUuid(id)) return null;
  const rows = await sql()`select id, label, date_from::text f, date_to::text t, basis, currency, line_count, accounts, total::float8 total, frozen_at, frozen_by from fn_pay_periods where installation_id = ${inst} and id = ${id}::uuid`;
  const x = rows[0];
  return x ? { id: x.id as string, label: x.label as string, from: x.f as string, to: x.t as string, basis: x.basis as PayBasis, currency: x.currency as string, lines: n(x.line_count), accounts: n(x.accounts), total: n(x.total), frozenAt: iso(x.frozen_at) as string, frozenBy: (x.frozen_by as string | null) ?? null } : null;
}
export async function unfreezePeriod(inst: string, id: string): Promise<boolean> {
  const r = await sql()`delete from fn_pay_periods where installation_id = ${inst} and id = ${id}::uuid returning id`;
  forgetFinance(inst);
  return r.length > 0;
}
/** People of a frozen period (totals), manager only. */
export async function frozenSummary(s: Scope, periodId: string, o: { cursor: string | null; size: number }) {
  const db = sql();
  const cur = decodeKey(o.cursor);
  const base = db`select l.person_id, count(*)::int lines, coalesce(sum(l.amount), 0)::float8 total, coalesce(sum(l.value), 0)::float8 value from fn_pay_lines l where l.installation_id = ${s.inst} and l.period_id = ${periodId}::uuid group by 1`;
  const [rows, cnt] = await Promise.all([
    db`select * from (${base}) z ${cur ? db`where (z.total, z.person_id) < (${Number(cur.k)}::float8, ${cur.id}::text)` : db``} order by z.total desc, z.person_id desc limit ${o.size + 1}`,
    db`select count(*)::int c from (${base}) z`,
  ]);
  const page = rows.slice(0, o.size), last = page[page.length - 1];
  const names = await nameMap(s.inst, page.map((x) => x.person_id as string));
  return { rows: page.map((x) => ({ personId: x.person_id as string, name: names.get(x.person_id as string) ?? "Team member", lines: n(x.lines), total: n(x.total), value: Math.round(n(x.value)) })), total: n(cnt[0]?.c), next: rows.length > o.size && last ? encodeKey({ k: n(last.total), id: last.person_id as string }) : null };
}

export type { PScope };
export { ownedUser, visibleMember };
