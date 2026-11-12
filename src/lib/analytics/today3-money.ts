import { sql } from "../db";
import { NOSHOW_WINDOW_DAYS } from "../design/deep-link";
import { WAIT_OLD_HOURS, clampSize } from "./clients3-intel";
import { countedInScope, dealIsStale, dealScopeJoins } from "./stage-rules-sql";
import { dealTrust, leftOutRows } from "./deal-trust-queries";
import { HOW_LEFT_OUT, HOW_STALE_WORKED_OUT, LEFT_OUT_CHIP, countingLine, leftOutLine } from "./deal-trust";
import { board, historyStartsOf, type Scope } from "./today3-queries";
import {
  AT_RISK_FORMULA, PIPELINE_FORMULA, RECOVERED_DAYS, RECOVERED_FORMULA, biggestOf, coversPrevious, expectedOf, historyShort, totalAtRisk, whyNoRisk,
} from "./today3-money-core";
import type { Td3List, Td3ListKind, Td3Money, Td3Row } from "./today3-types";

// The database side of the money row on Today. Read only. Every read starts from the accounts of the caller's own installation inside the caller's `allowed` set (today3-queries `board`,
// which is accountsCore, the one place a scope becomes ids); a team member (level "self") gets nothing. An id from the address never reaches a query here (the route checks it first). Counts equal the rows of the list they open
// because the count and the rows come from the same fragment.

type Frag = import("postgres").PendingQuery<import("postgres").Row[]>;
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const DAY = 86_400_000;

export const MONEY_LIST_KINDS = ["risk_all", "risk_stale", "risk_waiting", "risk_noshow", "recovered_won", "left_out"] as const;
export const isMoneyList = (k: string): boolean => (MONEY_LIST_KINDS as readonly string[]).includes(k);

/** Open deals (value above $0, an owner, in play) with the ONE cause that put them at risk: quiet first, then waiting over a day, then a no-show not booked again. */
function riskDeals(inst: string, ids: string[]): Frag {
  const db = sql();
  return db`(
    select o.opportunity_id, o.location_id, o.contact_id, coalesce(o.contact_name, o.name) contact_name, o.stage_name, o.monetary_value::float8 v, coalesce(o.last_stage_change_at, o.created_remote_at) at,
      case
        when ${dealIsStale()} then 'stale'
        when o.contact_id is not null and exists (select 1 from cached_conversations c where c.installation_id = o.installation_id and c.location_id = o.location_id and c.contact_id = o.contact_id
          and c.last_message_direction = 'inbound' and c.last_message_at > now() - interval '30 days' and c.last_message_at < now() - ${`${WAIT_OLD_HOURS} hours`}::interval) then 'waiting'
        when o.contact_id is not null and exists (select 1 from cached_appointments a left join appointment_facts fa on fa.installation_id = a.installation_id and fa.location_id = a.location_id and fa.appointment_id = a.appointment_id
          where a.installation_id = o.installation_id and a.location_id = o.location_id and a.contact_id = o.contact_id and fa.deleted_at is null and a.status = 'noshow'
            and a.start_at >= now() - ${`${NOSHOW_WINDOW_DAYS} days`}::interval and a.start_at < now() and (fa.snoozed_until is null or fa.snoozed_until < now())
            and not exists (select 1 from cached_appointments b where b.installation_id = a.installation_id and b.location_id = a.location_id and b.contact_id = a.contact_id and b.start_at > a.start_at
              and b.appointment_id <> a.appointment_id and b.status not in ('cancelled', 'invalid'))) then 'noshow'
      end cause
    from cached_opportunities o ${dealScopeJoins()}
    where o.installation_id = ${inst} and o.location_id = any(${ids}::text[]) and o.status = 'open' and ${countedInScope()}
  ) r`;
}

/** Deals marked won after SubSync saw the person answered, called back or rebooked, inside [from, to). Each deal once (the earliest matching recovery). */
function wonAfterRecovery(inst: string, ids: string[], from: Date, to: Date): Frag {
  const db = sql();
  return db`(
    select distinct on (e.location_id, e.opportunity_id) e.location_id, e.opportunity_id, o.contact_id, coalesce(o.contact_name, o.name) contact_name, o.stage_name, o.monetary_value::float8 v, e.at, i.recovered_how
    from deal_events e
    join cached_opportunities o on o.installation_id = e.installation_id and o.location_id = e.location_id and o.opportunity_id = e.opportunity_id
    join cf_recover_items i on i.installation_id = e.installation_id and i.location_id = e.location_id and i.contact_id = o.contact_id and o.contact_id is not null
      and i.recovered_how in ('replied', 'called_back', 'rebooked') and i.recovered_at is not null and e.at >= i.recovered_at
    where e.installation_id = ${inst} and e.location_id = any(${ids}::text[]) and e.kind = 'status' and e.to_value = 'won' and e.at >= ${from} and e.at < ${to}
    order by e.location_id, e.opportunity_id, e.at
  ) w`;
}

const EMPTY_CAUSE = { deals: 0, dollars: null as number | null };

export async function moneyHero(s: Scope, one: string | null, now = Date.now()): Promise<Td3Money> {
  const none = (hidden: boolean): Td3Money => ({
    hidden,
    atRisk: { dollars: null, deals: 0, byCause: { stale: { ...EMPTY_CAUSE }, waiting: { ...EMPTY_CAUSE }, noshow: { ...EMPTY_CAUSE } }, why: "Not enough data yet: no client accounts are read yet.", formula: AT_RISK_FORMULA },
    recovered: { dollars: null, deals: 0, people: 0, days: RECOVERED_DAYS, previousDollars: null, previousDeals: null, historyStarts: null, short: true, why: "Not enough data yet: our record starts at your first refresh.", formula: RECOVERED_FORMULA },
    pipeline: { open: 0, dollars: null, expected: null, expectedWhy: "Not enough data yet: no open deal has a dollar value and an owner.", leftOut: 0, formula: PIPELINE_FORMULA },
    biggest: null, trust: null,
  });
  if (s.level === "self") return none(true);
  const { cores } = await board(s, one, now);
  const ids = cores.map((c) => c.locationId);
  if (!ids.length) return none(false);
  const db = sql();
  const to = new Date(now), from = new Date(now - RECOVERED_DAYS * DAY), pFrom = new Date(now - 2 * RECOVERED_DAYS * DAY);
  const [risk, open, openBy, closed, recNow, recPrev, people, hist, trust] = await Promise.all([
    db`select r.cause, count(*)::int c, coalesce(sum(r.v), 0)::float8 d from ${riskDeals(s.inst, ids)} where r.cause is not null group by r.cause`.catch(() => []),
    db`select count(*) filter (where coalesce(o.monetary_value, 0) > 0 and o.assigned_to is not null)::int c, coalesce(sum(o.monetary_value) filter (where coalesce(o.monetary_value, 0) > 0 and o.assigned_to is not null), 0)::float8 d,
         count(*) filter (where not (coalesce(o.monetary_value, 0) > 0 and o.assigned_to is not null))::int skipped
       from cached_opportunities o ${dealScopeJoins()} where o.installation_id = ${s.inst} and o.location_id = any(${ids}::text[]) and o.status = 'open' and ${countedInScope()}`.catch(() => [{ c: 0, d: 0, skipped: 0 }]),
    db`select o.location_id loc, coalesce(sum(o.monetary_value), 0)::float8 d from cached_opportunities o ${dealScopeJoins()}
       where o.installation_id = ${s.inst} and o.location_id = any(${ids}::text[]) and o.status = 'open' and ${countedInScope()} and coalesce(o.monetary_value, 0) > 0 and o.assigned_to is not null group by o.location_id`.catch(() => []),
    db`select o.location_id loc, count(*) filter (where o.status = 'won')::int w, count(*) filter (where o.status = 'lost')::int l from cached_opportunities o
       where o.installation_id = ${s.inst} and o.location_id = any(${ids}::text[]) and o.status in ('won', 'lost') group by o.location_id`.catch(() => []),
    db`select count(*)::int c, coalesce(sum(w.v) filter (where w.v > 0), 0)::float8 d, count(*) filter (where w.v > 0)::int priced from ${wonAfterRecovery(s.inst, ids, from, to)}`.catch(() => null),
    db`select count(*)::int c, coalesce(sum(w.v) filter (where w.v > 0), 0)::float8 d, count(*) filter (where w.v > 0)::int priced from ${wonAfterRecovery(s.inst, ids, pFrom, from)}`.catch(() => null),
    db`select count(*)::int c from cf_recover_items i where i.installation_id = ${s.inst} and i.location_id = any(${ids}::text[]) and i.recovered_how in ('replied', 'called_back', 'rebooked') and i.recovered_at >= ${from}`.catch(() => [{ c: 0 }]),
    historyStartsOf(s.inst, ids).catch(() => null),
    dealTrust(s.inst, ids).catch(() => null),
  ]);

  const by = { stale: { ...EMPTY_CAUSE }, waiting: { ...EMPTY_CAUSE }, noshow: { ...EMPTY_CAUSE } };
  for (const r of risk) { const k = r.cause as keyof typeof by; if (k in by) by[k] = { deals: n(r.c), dollars: Math.round(n(r.d)) }; }
  const t = totalAtRisk(by);
  const openCount = n(open[0]?.c);
  const ex = expectedOf(openBy.map((r) => ({ loc: r.loc as string, dollars: n(r.d) })), closed.map((r) => ({ loc: r.loc as string, won: n(r.w), lost: n(r.l) })));
  const short = historyShort(hist, now);
  const rec = recNow ? { deals: n(recNow[0]?.c), dollars: n(recNow[0]?.priced) > 0 ? Math.round(n(recNow[0]?.d)) : null } : null;
  const prevOk = recPrev !== null && coversPrevious(hist, now);
  return {
    hidden: false,
    // Real zero ("nothing priced is at risk") only when there ARE priced open deals; with none, the figure is unknown and says so.
    atRisk: { dollars: t.dollars ?? (openCount > 0 && t.deals === 0 ? 0 : null), deals: t.deals, byCause: by, why: t.dollars === null && !(openCount > 0 && t.deals === 0) ? whyNoRisk(0, openCount) ?? "Not enough data yet: the deals at risk have no dollar value." : null, formula: AT_RISK_FORMULA },
    recovered: {
      dollars: rec ? rec.dollars : null, deals: rec?.deals ?? 0, people: n(people[0]?.c), days: RECOVERED_DAYS,
      previousDollars: prevOk && n(recPrev?.[0]?.priced) > 0 ? Math.round(n(recPrev?.[0]?.d)) : null, previousDeals: prevOk ? n(recPrev?.[0]?.c) : null,
      historyStarts: hist, short, why: rec === null ? "Not available yet: the recovery record is not switched on for your account." : hist === null ? "History starts at your next refresh." : null, formula: RECOVERED_FORMULA,
    },
    pipeline: {
      open: openCount, dollars: openCount > 0 ? Math.round(n(open[0]?.d)) : null, expected: ex.expected,
      expectedWhy: ex.expected === null ? "Not enough data yet: an account needs 20 won or lost deals before its win rate prices anything." : ex.priced < ex.accounts ? `${ex.priced} of ${ex.accounts} accounts have 20 won or lost deals; the others are not priced.` : null,
      leftOut: trust?.leftOut.deals ?? 0, formula: PIPELINE_FORMULA,
    },
    biggest: biggestOf(by),
    trust: trust ? { counting: countingLine(trust.counted.deals, trust.leftOut), leftOutLine: leftOutLine(trust.leftOut), leftOutDeals: trust.leftOut.deals, leftOutDollars: trust.leftOut.dollars, notJudged: trust.leftOut.notJudged, howStale: HOW_STALE_WORKED_OUT, howLeftOut: HOW_LEFT_OUT } : null,
  };
}

/** The exact rows behind the money row's numbers. Same scope as the count (the caller's accounts only); an unknown kind never gets here (the route checks the list of kinds). */
export async function moneyRows(s: Scope, one: string | null, kind: Td3ListKind, o: { page: number; size: number }, links: { account: (l: string) => string; contact: (l: string, c: string) => string }, now = Date.now()): Promise<Td3List> {
  const size = clampSize(o.size), page = Math.min(Math.max(0, o.page), 500), off = page * size;
  const label = kind === "left_out" ? "Deals left out of the dollar figures" : kind === "recovered_won" ? "Deals won after a late reply or a rebooked no-show" : kind === "risk_stale" ? "Quiet deals" : kind === "risk_waiting" ? "Deals whose person has waited over a day" : kind === "risk_noshow" ? "Deals whose person missed an appointment" : "Deals at risk";
  const empty: Td3List = { rows: [], total: 0, page, size, pages: 1, truncated: false, kind, label };
  if (s.level === "self") return empty;
  const { cores } = await board(s, one, now);
  const ids = cores.map((c) => c.locationId);
  if (!ids.length) return empty;
  const db = sql();
  const name = (loc: unknown) => cores.find((c) => c.locationId === loc)?.name ?? "Client account";
  const row = (r: Record<string, unknown>, detail: string, at: unknown): Td3Row => ({
    locationId: r.location_id as string, accountName: name(r.location_id), contactId: (r.contact_id as string | null) ?? null, contactName: ((r.contact_name as string | null) ?? "").trim() || "Unknown contact",
    detail, at: at ? new Date(at as string).toISOString() : null, value: n(r.v) > 0 ? n(r.v) : null, url: r.contact_id ? links.contact(r.location_id as string, r.contact_id as string) : links.account(r.location_id as string),
  });
  const page_ = (rows: Td3Row[], total: number): Td3List => ({ rows, total, page, size, pages: Math.max(1, Math.ceil(total / size)), truncated: total > 500 * size, kind, label });
  if (kind === "recovered_won") {
    const from = new Date(now - RECOVERED_DAYS * DAY), to = new Date(now);
    const total = n((await db`select count(*)::int c from ${wonAfterRecovery(s.inst, ids, from, to)}`.catch(() => [{ c: 0 }]))[0]?.c);
    const rows = await db`select w.* from ${wonAfterRecovery(s.inst, ids, from, to)} order by w.v desc nulls last, w.opportunity_id limit ${size} offset ${off}`.catch(() => []);
    const how: Record<string, string> = { replied: "won after a reply", called_back: "won after a call back", rebooked: "won after a rebooked visit" };
    return page_(rows.map((r) => row(r, `${(r.stage_name as string | null) ?? "Won"}: ${how[r.recovered_how as string] ?? "won after we saw them answered"}`, r.at)), total);
  }
  if (kind === "left_out") {
    const lo = await leftOutRows(s.inst, ids, null, size, off);
    return page_(lo.rows.map((r) => row({ location_id: r.locationId, contact_id: r.contactId, contact_name: r.contactName, v: r.value }, `${r.pipeline} / ${r.stage}: ${LEFT_OUT_CHIP[r.reason]}`, null)), lo.total);
  }
  const cond = kind === "risk_stale" ? db`r.cause = 'stale'` : kind === "risk_waiting" ? db`r.cause = 'waiting'` : kind === "risk_noshow" ? db`r.cause = 'noshow'` : db`r.cause is not null`;
  const total = n((await db`select count(*)::int c from ${riskDeals(s.inst, ids)} where ${cond}`)[0]?.c);
  const rows = await db`select r.* from ${riskDeals(s.inst, ids)} where ${cond} order by r.v desc, r.opportunity_id limit ${size} offset ${off}`;
  const words: Record<string, string> = { stale: "Quiet for 30 days or more", waiting: "Customer waiting over a day", noshow: "Missed an appointment, not rebooked" };
  return page_(rows.map((r) => row(r, `${(r.stage_name as string | null) ?? "Open"}: ${words[r.cause as string] ?? ""}`, r.at)), total);
}
