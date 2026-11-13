import { createHash } from "node:crypto";
import { sql } from "../../db";
import { dealTrust } from "../../analytics/deal-trust-queries";
import { findingRows, portfolio, portfolioScore } from "../../analytics/quality-queries";
import { FINDING_ORDER, FINDINGS, type FindingId } from "../../analytics/quality";
import { leadLedger } from "../../analytics/speed-queries";
import { listGroups, tierCounts, type Scope } from "../../analytics/dq-queries";
import { decodeCur } from "../../dq/dq-core";
import { countedInScope, dealIsStale, dealScopeJoins } from "../../analytics/stage-rules-sql";
import { addDays, dayStartMs, isRealDay, localDay, windowMs, zoneWord } from "../../design/zone";
import { coverageFor, coverageFindings, findingsFor, rankFindings } from "../../workflows/health";
import { accountNames, loadItems } from "../../workflows/store";
import { factsFor, factsText } from "../../notifications/alert-text";
import type { AiTool, Tenant, ToolResult } from "../tools";

// The READ-ONLY analytics whitelist for "Ask your data" and the data review (docs/AI_JOBS_SPEC.md). Every tool wraps one of OUR existing query functions; there is no raw SQL from a model and no write.
//   - The tenant (company, one account or the allowed accounts) comes from the verified session, never from an argument. The model cannot name a company, an account or a date: the date bar's window
//     arrives on the tenant (docs/DATE_RULES.md) and tools that are "as of now" say so in their result.
//   - Every tool builds ONE dataset: its numbers (summary), its total and its rows come from the same query, so a number and the rows behind it ("Rows" button) cannot disagree.
//   - `rowsHash` is a short address ("leads_waiting~from=..~to=..") that `openRows` decodes, re-validates and runs again for the same tenant. A forged address for another tenant opens that tenant's own rows.
//   - Names go to a model only after the account's opt-in; otherwise tools use stable aliases ("Account 4821") and the server swaps real names back for display.

export type Cell = string | number | null;
export type Dataset = { summary: Record<string, unknown>; total: number; columns: string[]; page(offset: number, limit: number): Promise<Cell[][]> };
type Props = Record<string, { type: "string"; enum: readonly string[]; description: string }>;
type Def = { name: string; description: string; props: Props; build(t: Tenant, a: Record<string, string>): Promise<Dataset> };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const ROW_PAGE_MAX = 100;
export const OFFSET_MAX = 2000;
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null);
const HOUR = 3_600_000;

/** The date bar's window for this request, or the last 7 days when none was sent. */
export function windowOf(t: Tenant, now = Date.now()): { from: string; to: string; fromMs: number; toMs: number; label: string } {
  const today = localDay(now);
  let from = t.range?.from ?? addDays(today, -6), to = t.range?.to ?? today;
  if (!isRealDay(from) || !isRealDay(to) || from > to) { from = addDays(today, -6); to = today; }
  if (to > today) to = today;
  const w = windowMs(from, to) ?? { fromMs: dayStartMs(addDays(today, -6)) ?? now - 7 * 86_400_000, toMs: now };
  return { from, to, ...w, label: `${from} to ${to}, ${zoneWord()} time` };
}

/** The alias a model sees for a name when the account has not opted in to sharing names. The same name always gets the same alias; the map lets the server restore it for display. */
export function nameFor(t: Tenant, kind: "Account" | "Person", real: string): string {
  if (t.shareNames) return real;
  const a = `${kind} ${1000 + (parseInt(sha(`${t.installationId}|${kind}|${real}`).slice(0, 6), 16) % 9000)}`;
  t.aliases?.set(a, real);
  return a;
}

/** The accounts this tenant may read: one account, the allowed list, or all of the company's (never ignored accounts). */
async function scopeIds(t: Tenant): Promise<Array<{ id: string; name: string }>> {
  const db = sql();
  const only = t.locationId ? [t.locationId] : t.allowed ?? null;
  const rows = await db`select location_id, coalesce(name, 'Unnamed account') name from locations where installation_id = ${t.installationId} and not ignored ${only ? db`and location_id = any(${only}::text[])` : db``} order by lower(coalesce(name, '')), location_id limit 5000`;
  return rows.map((r) => ({ id: r.location_id as string, name: r.name as string }));
}
const idsOnly = async (t: Tenant) => (await scopeIds(t)).map((x) => x.id);
const scopeFor = (t: Tenant, ids: string[]): Scope => ({ inst: t.installationId, allowed: ids, location: null });

const inMem = (columns: string[], rows: Cell[][], summary: Record<string, unknown>): Dataset => ({ summary, total: rows.length, columns, page: async (o, l) => rows.slice(o, o + l) });

const median = (xs: number[]) => (xs.length === 0 ? null : xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2);
const pctile = (xs: number[], p: number) => (xs.length === 0 ? null : xs[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)]);
const mins = (ms: number) => Math.max(0, Math.round(ms / 60_000));

// ------------------------------------------------------------------------------------------------ the tools

const DEFS: Def[] = [
  {
    name: "accounts_in_scope", description: "How many client accounts this person can see. Use it to answer 'how many clients'.", props: {},
    async build(t) {
      const accts = await scopeIds(t);
      return inMem(["Account"], accts.map((a) => [a.name]), { accounts: accts.length });
    },
  },
  {
    name: "leads_waiting", description: "New leads (last 14 days) that nobody has replied to yet, right now. As of now: the date bar does not change it.", props: {},
    async build(t) {
      const now = Date.now();
      const all = await leadLedger(t.installationId, t.locationId ? [t.locationId] : t.allowed ?? null, now);
      const waiting = all.filter((r) => r.touchAt === null).sort((a, b) => a.leadAt - b.leadAt);
      const by = new Map<string, number>();
      for (const r of waiting) by.set(r.accountName, (by.get(r.accountName) ?? 0) + 1);
      const top = [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([name, waitingNow]) => ({ account: nameFor(t, "Account", name), waitingNow }));
      const hrs = (r: { leadAt: number }) => (now - r.leadAt) / HOUR;
      return inMem(["Account", "Lead", "Source", "Owner", "Arrived", "Hours waiting"], waiting.map((r) => [r.accountName, r.name, r.source, r.ownerName, new Date(r.leadAt).toISOString(), Math.floor(hrs(r))]), {
        asOfNow: true, coversDays: 14, waitingNow: waiting.length, waitingOverOneHour: waiting.filter((r) => hrs(r) >= 1).length, waitingOverOneDay: waiting.filter((r) => hrs(r) >= 24).length,
        oldestHoursWaiting: waiting[0] ? Math.floor(hrs(waiting[0])) : 0, worstAccounts: top,
      });
    },
  },
  {
    name: "first_reply_times", description: "How fast leads that arrived in the date bar's window got their first reply (minutes). Covers at most the last 14 days. Optionally grouped by client account or by team member.",
    props: { by: { type: "string", enum: ["all", "account", "person"], description: "Group the slowest and fastest by client account or by team member. Default all." } },
    async build(t, a) {
      const now = Date.now(), w = windowOf(t, now);
      const all = await leadLedger(t.installationId, t.locationId ? [t.locationId] : t.allowed ?? null, now);
      const inWin = all.filter((r) => r.leadAt >= w.fromMs && r.leadAt < w.toMs);
      const answered = inWin.filter((r) => r.touchAt !== null).sort((x, y) => y.touchAt! - y.leadAt - (x.touchAt! - x.leadAt));
      const times = answered.map((r) => mins(r.touchAt! - r.leadAt)).sort((x, y) => x - y);
      const groups = new Map<string, number[]>();
      if (a.by === "account" || a.by === "person") for (const r of answered) {
        const k = a.by === "account" ? r.accountName : r.touchBy;
        if (!k) continue;
        (groups.get(k) ?? groups.set(k, []).get(k)!).push(mins(r.touchAt! - r.leadAt));
      }
      const grouped = [...groups].filter(([, v]) => v.length >= 3).map(([k, v]) => ({ name: nameFor(t, a.by === "account" ? "Account" : "Person", k), answered: v.length, medianMinutes: median(v.sort((x, y) => x - y)) as number }))
        .sort((x, y) => y.medianMinutes - x.medianMinutes || x.name.localeCompare(y.name));
      return inMem(["Account", "Lead", "Replied by", "Arrived", "Minutes to first reply"], answered.map((r) => [r.accountName, r.name, r.touchBy, new Date(r.leadAt).toISOString(), mins(r.touchAt! - r.leadAt)]), {
        windowNote: "Only leads that arrived in this window, and only the last 14 days exist here.", leadsArrived: inWin.length, answered: answered.length, notAnsweredYet: inWin.length - answered.length,
        medianMinutes: median(times), slowestTenPercentMinutes: pctile(times, 0.9), ...(a.by === "account" || a.by === "person" ? { slowestFirst: grouped.slice(0, 5), onlyGroupsWithThreeOrMoreReplies: true } : {}),
      });
    },
  },
  {
    name: "appointments_summary", description: "Appointments. view=all: booked for the date bar's window with show rate; no_shows: no-shows in the window; unmarked: appointments already past with no outcome recorded (as of now).",
    props: { view: { type: "string", enum: ["all", "no_shows", "unmarked"], description: "Which list. Default all." } },
    async build(t, a) {
      const db = sql(), ids = await idsOnly(t), w = windowOf(t), view = a.view || "all";
      const from = new Date(w.fromMs), to = new Date(w.toMs);
      const cond = view === "unmarked"
        ? db`coalesce(a.status, 'new') not in ('showed', 'noshow', 'cancelled', 'invalid') and a.start_at < now() - interval '3 hours' and a.start_at > now() - interval '90 days'`
        : view === "no_shows" ? db`a.status = 'noshow' and a.start_at >= ${from} and a.start_at < ${to}` : db`a.start_at >= ${from} and a.start_at < ${to}`;
      const base = db`from cached_appointments a join locations l on l.installation_id = a.installation_id and l.location_id = a.location_id and not l.ignored
        left join cached_contacts c on c.installation_id = a.installation_id and c.location_id = a.location_id and c.contact_id = a.contact_id
        where a.installation_id = ${t.installationId} and a.location_id = any(${ids}::text[]) and ${cond}`;
      const [agg] = await db`select count(*)::int total, count(*) filter (where a.status = 'showed')::int showed, count(*) filter (where a.status = 'noshow')::int noshow,
        count(*) filter (where a.status in ('cancelled', 'canceled'))::int cancelled ${base}`;
      const total = n(agg?.total), showed = n(agg?.showed), noshow = n(agg?.noshow), outcomes = showed + noshow;
      const summary: Record<string, unknown> = view === "unmarked"
        ? { asOfNow: true, pastWithNoOutcome: total }
        : { appointments: total, showed, noShows: noshow, cancelled: n(agg?.cancelled), outcomesRecorded: outcomes, showRatePercent: outcomes >= 5 ? Math.round((showed / outcomes) * 100) : null, showRateNote: outcomes >= 5 ? "showed out of showed plus no-shows" : "Not enough recorded outcomes yet for a show rate (needs 5)." };
      return {
        summary, total, columns: ["Account", "Contact", "Calendar", "Starts", "Status"],
        page: async (o, l) => (await db`select l.name loc, coalesce(c.full_name, 'Unnamed contact') who, a.calendar_name, a.start_at, coalesce(a.status, 'new') status ${base} order by a.start_at desc, a.appointment_id limit ${l} offset ${o}`)
          .map((r) => [(r.loc as string | null) ?? "Account", r.who as string, (r.calendar_name as string | null) ?? null, iso(r.start_at), r.status as string]),
      };
    },
  },
  {
    name: "deals_summary", description: "Deals. open: what is open right now (not changed by the date bar); won or lost: closed inside the date bar's window. Grouped by stage, owner or nothing.",
    props: {
      view: { type: "string", enum: ["open", "won", "lost"], description: "Default open." },
      group: { type: "string", enum: ["none", "stage", "owner"], description: "How to break the numbers down. Default none." },
    },
    async build(t, a) {
      const db = sql(), ids = await idsOnly(t), w = windowOf(t), view = a.view || "open", group = a.group || "none";
      const cond = view === "open" ? db`o.status = 'open'` : db`o.status = ${view} and o.last_status_change_at >= ${new Date(w.fromMs)} and o.last_status_change_at < ${new Date(w.toMs)}`;
      const base = db`from cached_opportunities o ${dealScopeJoins()} join locations l on l.installation_id = o.installation_id and l.location_id = o.location_id and not l.ignored
        left join team_names tn on tn.installation_id = o.installation_id and tn.user_id = o.assigned_to
        where o.installation_id = ${t.installationId} and o.location_id = any(${ids}::text[]) and ${cond}`;
      const [agg] = await db`select count(*)::int total, coalesce(sum(o.monetary_value) filter (where o.monetary_value > 0), 0)::float8 dollars,
        count(*) filter (where ${countedInScope()})::int counted, coalesce(sum(o.monetary_value) filter (where ${countedInScope()}), 0)::float8 counted_dollars ${base}`;
      const total = n(agg?.total);
      let groups: unknown[] = [];
      if (group !== "none") {
        const key = group === "stage" ? db`coalesce(o.stage_name, 'No stage')` : db`coalesce(tn.name, case when o.assigned_to is null then 'Not assigned' else 'Team member (name not available)' end)`;
        const g = await db`select ${key} k, count(*)::int c, coalesce(sum(o.monetary_value) filter (where o.monetary_value > 0), 0)::float8 d ${base} group by 1 order by c desc, 1 limit 8`;
        groups = g.map((r) => ({ [group]: group === "owner" ? nameFor(t, "Person", r.k as string) : (r.k as string), deals: n(r.c), dollars: Math.round(n(r.d)) }));
      }
      return {
        summary: {
          view, ...(view === "open" ? { asOfNow: true, dollarsRule: "Dollars count only deals with a real value, an owner, and not left out by the deal-trust rules.", dealsCountedForDollars: n(agg?.counted), countedDollars: Math.round(n(agg?.counted_dollars)) } : { estimatedDollars: Math.round(n(agg?.dollars)) }),
          deals: total, ...(group !== "none" ? { [`by_${group}`]: groups } : {}),
        },
        total, columns: ["Account", "Deal", "Stage", "Value", "Owner"],
        page: async (o, l) => (await db`select l.name loc, coalesce(o.name, o.contact_name, 'Deal') dn, coalesce(o.stage_name, '') stage, o.monetary_value::float8 v, tn.name owner ${base} order by o.monetary_value desc nulls last, o.opportunity_id limit ${l} offset ${o}`)
          .map((r) => [(r.loc as string | null) ?? "Account", r.dn as string, (r.stage as string) || null, r.v === null ? null : Math.round(n(r.v)), (r.owner as string | null) ?? null]),
      };
    },
  },
  {
    name: "money_at_risk", description: "Open deals that are stale (past their own stage's usual time), counted with the deal-trust rules, plus the deals left out of the dollars and why. As of now.", props: {},
    async build(t) {
      const db = sql(), ids = await idsOnly(t);
      const trust = await dealTrust(t.installationId, ids);
      const base = db`from cached_opportunities o ${dealScopeJoins()} join locations l on l.installation_id = o.installation_id and l.location_id = o.location_id and not l.ignored
        left join team_names tn on tn.installation_id = o.installation_id and tn.user_id = o.assigned_to
        where o.installation_id = ${t.installationId} and o.location_id = any(${ids}::text[]) and o.status = 'open' and ${countedInScope()} and ${dealIsStale()}`;
      const [s] = await db`select count(*)::int c, coalesce(sum(o.monetary_value), 0)::float8 d ${base}`;
      return {
        summary: {
          asOfNow: true, estimate: true, staleDeals: n(s?.c), staleDollars: Math.round(n(s?.d)), openDealsCounted: trust.counted.deals, openDollarsCounted: trust.counted.dollars,
          leftOutDeals: trust.leftOut.deals, leftOutDollars: trust.leftOut.dollars, leftOutBecause: trust.leftOut.parts.map((p) => ({ reason: p.reason, deals: p.deals })),
        },
        total: n(s?.c), columns: ["Account", "Deal", "Stage", "Value", "Last moved"],
        page: async (o, l) => (await db`select l.name loc, coalesce(o.name, o.contact_name, 'Deal') dn, coalesce(o.stage_name, '') stage, o.monetary_value::float8 v, coalesce(o.last_stage_change_at, o.created_remote_at) at ${base} order by v desc, o.opportunity_id limit ${l} offset ${o}`)
          .map((r) => [(r.loc as string | null) ?? "Account", r.dn as string, (r.stage as string) || null, Math.round(n(r.v)), iso(r.at)]),
      };
    },
  },
  {
    name: "duplicates_counts", description: "Possible duplicate contacts, in three tiers (certain, likely, possible). The tier picked decides which groups the rows list. As of now.",
    props: { tier: { type: "string", enum: ["certain", "likely", "possible"], description: "Which tier's groups to list. Default likely." } },
    async build(t, a) {
      const tier = (a.tier || "likely") as "certain" | "likely" | "possible", s = scopeFor(t, await idsOnly(t));
      const tc = await tierCounts(s);
      return {
        summary: { asOfNow: true, certain: tc.certain, likely: tc.likely, possible: tc.possible, listedTier: tier, note: "A group is a set of contacts that look like one person. Nothing is merged without a person's approval." },
        total: tc[tier].groups, columns: ["Account", "Why they match", "People"],
        page: async (offset, limit) => {
          const out: Cell[][] = []; let after: Array<string | number> | null = null, seen = 0;
          for (let i = 0; i < 40 && out.length < limit; i++) {
            const pg = await listGroups(s, tier, after, 100);
            for (const g of pg.rows) { if (seen++ >= offset && out.length < limit) out.push([g.locationName ?? "Account", g.badge, g.people.map((p) => p.name).slice(0, 4).join(", ")]); }
            if (!pg.next) break;
            after = decodeCur(pg.next, 2);
          }
          return out;
        },
      };
    },
  },
  {
    name: "workflow_health", description: "Automation (workflow) problems and missing standard workflows (missed-call text back, new lead follow-up, reminders, no-show follow-up) across the client accounts. As of now; found by workflow names, so an estimate.", props: {},
    async build(t) {
      const ids = await idsOnly(t), now = Date.now();
      const [{ items, available }, accounts] = await Promise.all([loadItems(t.installationId, ids), accountNames(t.installationId, ids)]);
      if (!available) return inMem(["Account", "Finding", "Level", "What to do"], [], { available: false, note: "The automation list is not available yet (permission or first sync)." });
      const live = accounts.filter((x) => !x.ignored), known = new Set(items.map((i) => i.locationId));
      const findings = rankFindings([...findingsFor(items, { now, logsKnown: false }), ...coverageFindings(live, items, known)]);
      const nameOf = new Map(live.map((x) => [x.locationId, x.name]));
      const missing = new Map<string, number>();
      for (const x of live) if (known.has(x.locationId)) for (const m of coverageFor(x.locationId, items).missing) missing.set(m, (missing.get(m) ?? 0) + 1);
      const sev = (s: string) => findings.filter((f) => f.severity === s).length;
      return inMem(["Account", "Finding", "Level", "What to do"], findings.map((f) => [nameOf.get(f.locationId) ?? "Account", f.title, f.severity, f.next]), {
        asOfNow: true, estimate: true, accountsChecked: known.size, findings: findings.length, critical: sev("critical"), warning: sev("warning"), info: sev("info"),
        accountsMissingEach: Object.fromEntries([...missing].map(([k, v]) => [k, v])),
      });
    },
  },
  {
    name: "contacts_no_owner", description: "Contacts that have no team member assigned. As of now.", props: {},
    async build(t) {
      const db = sql(), ids = await idsOnly(t);
      const base = db`from cached_contacts c join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored where c.installation_id = ${t.installationId} and c.location_id = any(${ids}::text[]) and coalesce(c.assigned_to, '') = ''`;
      const [s] = await db`select count(*)::int c ${base}`;
      return {
        summary: { asOfNow: true, contactsWithNoOwner: n(s?.c) }, total: n(s?.c), columns: ["Account", "Contact", "Email", "Phone", "Added"],
        page: async (o, l) => (await db`select l.name loc, coalesce(nullif(c.full_name, ''), 'Unnamed contact') who, c.email, c.phone, c.date_added ${base} order by c.date_added desc nulls last, c.contact_id limit ${l} offset ${o}`)
          .map((r) => [(r.loc as string | null) ?? "Account", r.who as string, (r.email as string | null) ?? null, (r.phone as string | null) ?? null, iso(r.date_added)]),
      };
    },
  },
  {
    name: "unassigned_deals", description: "Open deals that have no owner. As of now.", props: {},
    async build(t) {
      const db = sql(), ids = await idsOnly(t);
      const base = db`from cached_opportunities o join locations l on l.installation_id = o.installation_id and l.location_id = o.location_id and not l.ignored where o.installation_id = ${t.installationId} and o.location_id = any(${ids}::text[]) and o.status = 'open' and o.assigned_to is null`;
      const [s] = await db`select count(*)::int c ${base}`;
      return {
        summary: { asOfNow: true, openDealsWithNoOwner: n(s?.c) }, total: n(s?.c), columns: ["Account", "Deal", "Stage", "Value"],
        page: async (off, l) => (await db`select l.name loc, coalesce(o.name, o.contact_name, 'Deal') dn, coalesce(o.stage_name, '') stage, o.monetary_value::float8 v ${base} order by o.monetary_value desc nulls last, o.opportunity_id limit ${l} offset ${off}`)
          .map((r) => [(r.loc as string | null) ?? "Account", r.dn as string, (r.stage as string) || null, r.v === null ? null : Math.round(n(r.v))]),
      };
    },
  },
  {
    name: "data_quality", description: "Data health of the contacts: score, and how many contacts have each problem (junk or test records, no way to reach them, bad phone or email, formatting). With a check, the rows are those contacts; without, one row per account. As of now.",
    props: { check: { type: "string", enum: ["accounts", ...FINDING_ORDER], description: "A problem to list, or 'accounts' for one row per account. Default accounts." } },
    async build(t, a) {
      const ids = await idsOnly(t), check = a.check || "accounts";
      const p = await portfolio(t.installationId, ids, 5000), score = portfolioScore(p.rows);
      const totals: Record<string, number> = {};
      for (const r of p.rows) for (const [k, v] of Object.entries(r.counts)) if (v) totals[FINDINGS[k as FindingId]?.label ?? k] = (totals[FINDINGS[k as FindingId]?.label ?? k] ?? 0) + v;
      const summary = { asOfNow: true, accounts: p.rows.length, accountsNotScannedYet: p.pending, averageScore: score.score, problemsFound: totals, duplicateGroups: p.rows.reduce((s, r) => s + r.duplicateGroups, 0) };
      if (check === "accounts") return inMem(["Account", "Score", "Contacts"], p.rows.map((r) => [r.name ?? "Account", r.score, r.contacts]), summary);
      const id = check as FindingId, readFrom = p.rows.filter((r) => (r.counts[id] ?? 0) > 0).slice(0, 500);
      const total = readFrom.reduce((s, r) => s + (r.counts[id] ?? 0), 0);
      return {
        summary: { ...summary, listedProblem: FINDINGS[id].label, contactsWithThisProblem: total, accountsRead: readFrom.length }, total, columns: ["Account", "Contact", "Email", "Phone", "Suggested fix"],
        page: async (offset, limit) => {
          const out: Cell[][] = []; let skip = offset;
          for (const r of readFrom) {
            const c = r.counts[id] ?? 0;
            if (skip >= c) { skip -= c; continue; }
            const got = await findingRows(t.installationId, r.locationId, id, null, Math.min(500, skip + limit));
            for (const row of got.rows.slice(skip)) { if (out.length < limit) out.push([r.name ?? "Account", row.name, row.email, row.phone, row.fix?.map((f) => `${f.field}: ${f.after}`).join("; ") ?? null]); }
            skip = 0; if (out.length >= limit) break;
          }
          return out;
        },
      };
    },
  },
  {
    name: "alerts_report", description: "SubSync's alerts for the client accounts. view=open: alerts still open now (as of now). view=in_window: alerts raised inside the date bar's window. Use it for 'what alerts fired today?' and to explain an alert: the top alerts come with the facts behind them (counts, window, usual level, biggest causes).",
    props: { view: { type: "string", enum: ["open", "in_window"], description: "open (default) or in_window." } },
    async build(t, a) {
      const db = sql(), ids = await idsOnly(t), w = windowOf(t), inWindow = a.view === "in_window";
      const cond = inWindow ? db`a.created_at >= ${new Date(w.fromMs)} and a.created_at <= ${new Date(w.toMs)}` : db`a.resolved_at is null`;
      const base = db`from alerts a join locations l on l.installation_id = a.installation_id and l.location_id = a.location_id and not l.ignored where a.installation_id = ${t.installationId} and a.location_id = any(${ids}::text[]) and a.recipient_user_key is null and a.severity <> 'info' and ${cond}`;
      const [s] = await db`select count(*)::int c, count(*) filter (where a.severity = 'critical')::int crit ${base}`;
      const top = await db`select a.kind, a.severity, a.title, a.detail, a.id, a.location_id, l.name loc ${base} order by case a.severity when 'critical' then 0 else 1 end, a.created_at desc limit 5`;
      const facts = top.map((r) => factsText(factsFor({ id: r.id as string, kind: r.kind as string, severity: r.severity as "warning" | "critical", title: r.title as string, locationId: r.location_id as string, detail: (r.detail ?? {}) as Record<string, unknown> }, nameFor(t, "Account", (r.loc as string | null) ?? "Account"))));
      return {
        summary: { view: inWindow ? "in_window" : "open", asOfNow: !inWindow, alerts: n(s?.c), critical: n(s?.crit), topAlertFacts: facts }, total: n(s?.c), columns: ["Account", "Alert", "Kind", "Severity", "Raised", "Status"],
        page: async (o, l) => (await db`select l.name loc, a.title, a.kind, a.severity, a.created_at, a.resolved_at ${base} order by a.created_at desc, a.id limit ${l} offset ${o}`)
          .map((r) => [(r.loc as string | null) ?? "Account", r.title as string, r.kind as string, r.severity as string, iso(r.created_at), r.resolved_at ? "Cleared" : "Open"]),
      };
    },
  },
];

// ------------------------------------------------------------------------------------------------ registry, addresses, rows

const SAFE = /^[a-z_]{1,24}$/;
function parseArgs(def: Def, raw: Record<string, unknown>): { ok: true; args: Record<string, string> } | { ok: false; error: string } {
  const args: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    const p = def.props[k];
    if (!p) return { ok: false, error: `Unknown argument ${String(k).slice(0, 20)}.` };
    if (typeof v !== "string" || !p.enum.includes(v)) return { ok: false, error: `${k} must be one of: ${p.enum.join(", ")}.` };
    args[k] = v;
  }
  return { ok: true, args };
}

export const addressOf = (name: string, args: Record<string, string>, w: { from: string; to: string }): string =>
  [name, ...Object.entries(args).filter(([, v]) => v).sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => `${k}=${v}`), `from=${w.from}`, `to=${w.to}`].join("~");

export function toTool(def: Def): AiTool {
  return {
    spec: { name: def.name, description: def.description, parameters: { type: "object", properties: Object.fromEntries(Object.entries(def.props).map(([k, p]) => [k, { type: "string", enum: p.enum, description: p.description }])), additionalProperties: false } },
    parse: (a) => parseArgs(def, a),
    async run(tenant, args): Promise<ToolResult> {
      const w = windowOf(tenant), ds = await def.build(tenant, args as Record<string, string>);
      return { data: { window: w.label, ...ds.summary }, rowsHash: addressOf(def.name, args as Record<string, string>, w), rowCount: ds.total };
    },
  };
}

export const DATA_TOOL_NAMES = DEFS.map((d) => d.name);
export const DATA_TOOLS: Record<string, AiTool> = Object.fromEntries(DEFS.map((d) => [d.name, toTool(d)]));
const BY_NAME = new Map(DEFS.map((d) => [d.name, d]));

export type Address = { tool: string; args: Record<string, string>; from: string; to: string };
/** Decodes an address a person (or a saved answer) sends back. Anything not exactly one of our tools with allowed arguments is refused. */
export function decodeAddress(h: unknown): Address | null {
  if (typeof h !== "string" || h.length > 200) return null;
  const [tool, ...parts] = h.split("~");
  const def = BY_NAME.get(tool);
  if (!def || !SAFE.test(tool)) return null;
  const kv: Record<string, string> = {};
  for (const p of parts) { const i = p.indexOf("="); if (i < 1) return null; kv[p.slice(0, i)] = p.slice(i + 1); }
  const { from, to, ...rest } = kv;
  if (!isRealDay(from) || !isRealDay(to) || from > to) return null;
  const ok = parseArgs(def, rest);
  return ok.ok ? { tool, args: ok.args, from, to } : null;
}

/** Opens the exact rows behind a cited number, for the SAME tenant that asked. Returns null for an unknown address. */
export async function openRows(tenant: Tenant, address: string, offset: number, limit: number): Promise<{ columns: string[]; rows: Cell[][]; total: number; window: string } | null> {
  const d = decodeAddress(address);
  if (!d) return null;
  const t: Tenant = { ...tenant, range: { from: d.from, to: d.to } };
  const ds = await BY_NAME.get(d.tool)!.build(t, d.args);
  const off = Math.min(Math.max(0, Math.floor(offset) || 0), OFFSET_MAX), lim = Math.min(Math.max(1, Math.floor(limit) || 25), ROW_PAGE_MAX);
  return { columns: ds.columns, rows: await ds.page(off, lim), total: ds.total, window: windowOf(t).label };
}

/** Does this citation (address + count) still match what the tool says right now? Used to check an answer before it is shown. */
export async function citationHolds(tenant: Tenant, address: string, rowCount: number): Promise<boolean> {
  const d = decodeAddress(address);
  if (!d) return false;
  const ds = await BY_NAME.get(d.tool)!.build({ ...tenant, range: { from: d.from, to: d.to } }, d.args);
  return ds.total === rowCount;
}

/** The dataset itself (summary, total, rows) for a job that builds its own input from the same functions an answer cites. Same tenant rules. */
export async function datasetFor(tenant: Tenant, tool: string, args: Record<string, string> = {}): Promise<{ summary: Record<string, unknown>; total: number; address: string; window: string } | null> {
  const def = BY_NAME.get(tool);
  if (!def) return null;
  const ok = parseArgs(def, args);
  if (!ok.ok) return null;
  const w = windowOf(tenant), ds = await def.build(tenant, ok.args);
  return { summary: ds.summary, total: ds.total, address: addressOf(tool, ok.args, w), window: w.label };
}
