import { sql } from "../db";
import { emailProblem, leadScore, vipScore, daysIdle, tagVariants, effectiveColdTags, qualityFigures, QUIET_AFTER_DAYS, type LeadFacts } from "./contact-intel";
import { percentChange } from "./metrics";
import { pgTextArray as pgArray } from "./queries";
import { countedInScope, dealScopeJoins, outOfScope } from "./stage-rules-sql";

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);

// Visible client accounts: not ignored, and within the plan limit when there is one.
function visible(installationId: string, allowed: string[] | null) {
  const db = sql();
  return db`select location_id, name from locations where installation_id = ${installationId} and not ignored
    ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}`;
}

// The same rules as isValidEmail and isValidPhone in contact-intel.ts, written for Postgres. A database test (tests/unit/f1-deal-scope-db.test.ts)
// feeds both the same addresses and numbers and fails if they disagree, so the two cannot drift apart (N46).
const EMAIL_PATTERN = "^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]{2,}$";
const EMAIL_BAD_SHAPE = "([.][.]|^[.])"; // two dots in a row, or a dot at the very start
const SAME_DIGIT = "^(.)\\1+$"; // 0000000, 1111111...
/** True for an email that was typed and cannot work. Needs the alias c (cached_contacts). */
const emailInvalid = () => sql()`(nullif(btrim(c.email), '') is not null and (btrim(c.email) !~ ${EMAIL_PATTERN} or btrim(c.email) ~ ${EMAIL_BAD_SHAPE} or length(btrim(c.email)) > 254))`;
const phoneInvalid = () => sql()`(nullif(c.phone, '') is not null and (length(coalesce(c.phone_digits, '')) < 7 or length(coalesce(c.phone_digits, '')) > 15 or coalesce(c.phone_digits, '') ~ ${SAME_DIGIT}))`;

const DISPOSABLE_LIST = [
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org", "throwawaymail.com", "yopmail.com",
  "trashmail.com", "sharklasers.com", "getnada.com", "maildrop.cc", "dispostable.com", "fakeinbox.com", "mintemail.com",
];

export type ContactOverview = Awaited<ReturnType<typeof contactOverview>>;

export async function contactOverview(installationId: string, allowed: string[] | null, chosenColdTags: string[] | null = null) {
  const db = sql();
  const [[life], [aging], [quiet], growth, accountGrowth, tags, [quality], imports, cohorts, [syncState]] = await Promise.all([
    // lifecycle: where each contact sits, from the deals they have
    db`
      with loc as (${visible(installationId, allowed)}),
      deals as (
        -- "open" is an open deal in play (not in a closed-out stage or an unused pipeline); "counted" is one that also has a value and an owner,
        -- the only kind that reaches a dollar figure (docs/METRICS.md). Both are shown, with the difference said in words (UX-02).
        select o.location_id, o.contact_id, bool_or(o.status = 'open' and not ${outOfScope()}) open, bool_or(o.status = 'open' and ${countedInScope()}) counted,
          bool_or(o.status = 'won') won, bool_or(o.status = 'lost') lost, bool_or(o.status = 'open' and ${outOfScope()}) closed_out
        from cached_opportunities o ${dealScopeJoins()} where o.installation_id = ${installationId} and o.contact_id is not null group by o.location_id, o.contact_id)
      select count(*)::int total,
        count(*) filter (where d.won)::int customers,
        count(*) filter (where d.open and not coalesce(d.won, false))::int opportunities,
        count(*) filter (where d.counted and not coalesce(d.won, false))::int opportunities_counted,
        -- A contact whose only deals are lost, or sit in a closed-out stage, is "lost": every contact is in exactly one group, so the groups add up.
        count(*) filter (where (d.lost or d.closed_out) and not d.open and not d.won)::int lost,
        count(*) filter (where d.contact_id is null)::int leads
      from cached_contacts c join loc on loc.location_id = c.location_id
      left join deals d on d.location_id = c.location_id and d.contact_id = c.contact_id
      where c.installation_id = ${installationId}`,
    // leads (no deal at all) that have been waiting
    db`
      with loc as (${visible(installationId, allowed)}),
      deals as (select distinct location_id, contact_id from cached_opportunities where installation_id = ${installationId} and contact_id is not null)
      select count(*) filter (where c.date_added < now() - interval '30 days')::int over30,
        count(*) filter (where c.date_added < now() - interval '60 days')::int over60,
        count(*) filter (where c.date_added < now() - interval '90 days')::int over90
      from cached_contacts c join loc on loc.location_id = c.location_id
      left join deals d on d.location_id = c.location_id and d.contact_id = c.contact_id
      where c.installation_id = ${installationId} and d.contact_id is null`,
    // inactivity
    db`
      with loc as (${visible(installationId, allowed)})
      select count(*)::int total,
        count(*) filter (where c.last_activity_at is null)::int never,
        count(*) filter (where coalesce(c.last_activity_at, c.date_added) < now() - interval '30 days')::int d30,
        count(*) filter (where coalesce(c.last_activity_at, c.date_added) < now() - interval '60 days')::int d60,
        count(*) filter (where coalesce(c.last_activity_at, c.date_added) < now() - interval '90 days')::int d90,
        count(*) filter (where coalesce(c.last_activity_at, c.date_added) < now() - interval '180 days')::int d180,
        count(*) filter (where c.last_activity_at is not null and c.last_activity_at < now() - interval '90 days')::int silent
      from cached_contacts c join loc on loc.location_id = c.location_id where c.installation_id = ${installationId}`,
    // new contacts per week, last 12 weeks
    db`
      with loc as (${visible(installationId, allowed)})
      select date_trunc('week', c.date_added)::date as week, count(*)::int n
      from cached_contacts c join loc on loc.location_id = c.location_id
      where c.installation_id = ${installationId} and c.date_added > now() - interval '12 weeks'
      group by 1 order by 1`,
    // growth per account: last 30 days against the 30 before
    db`
      with loc as (${visible(installationId, allowed)})
      select loc.location_id, loc.name,
        count(*) filter (where c.date_added > now() - interval '30 days')::int last30,
        count(*) filter (where c.date_added <= now() - interval '30 days' and c.date_added > now() - interval '60 days')::int prev30
      from loc left join cached_contacts c on c.installation_id = ${installationId} and c.location_id = loc.location_id
      group by loc.location_id, loc.name order by last30 desc`,
    // tag usage
    db`
      with loc as (${visible(installationId, allowed)})
      select t.tag, count(*)::int n
      from cached_contacts c join loc on loc.location_id = c.location_id, unnest(c.tags) t(tag)
      where c.installation_id = ${installationId} group by t.tag order by n desc limit 300`,
    // data quality
    db`
      with loc as (${visible(installationId, allowed)})
      select count(*)::int total,
        count(*) filter (where nullif(c.email, '') is not null)::int with_email,
        count(*) filter (where nullif(c.phone, '') is not null)::int with_phone,
        count(*) filter (where ${emailInvalid()})::int bad_email,
        count(*) filter (where nullif(btrim(c.email), '') is not null and not ${emailInvalid()} and lower(split_part(btrim(c.email), '@', 2)) = any(${DISPOSABLE_LIST}::text[]))::int disposable,
        count(*) filter (where ${phoneInvalid()})::int bad_phone
      from cached_contacts c join loc on loc.location_id = c.location_id where c.installation_id = ${installationId}`,
    // bulk imports: days with a large number of contacts added at once
    db`
      with loc as (${visible(installationId, allowed)})
      select loc.name, c.date_added::date as day, count(*)::int n,
        round(100.0 * count(*) filter (where nullif(c.email, '') is null) / count(*))::int no_email,
        round(100.0 * count(*) filter (where nullif(c.phone, '') is null) / count(*))::int no_phone
      from cached_contacts c join loc on loc.location_id = c.location_id
      where c.installation_id = ${installationId} and c.date_added > now() - interval '180 days'
      group by loc.name, c.date_added::date having count(*) >= 50 order by day desc limit 12`,
    // 7.8 cohorts: contacts grouped by the month they arrived, and how many have since won a deal
    db`
      with loc as (${visible(installationId, allowed)}),
      won as (select location_id, contact_id, sum(monetary_value) v from cached_opportunities
        where installation_id = ${installationId} and status = 'won' and contact_id is not null group by location_id, contact_id)
      select to_char(date_trunc('month', c.date_added), 'YYYY-MM') as month, count(*)::int leads, count(w.contact_id)::int converted, coalesce(sum(w.v), 0)::float8 revenue
      from cached_contacts c join loc on loc.location_id = c.location_id
      left join won w on w.location_id = c.location_id and w.contact_id = c.contact_id
      where c.installation_id = ${installationId} and c.date_added >= date_trunc('month', now()) - interval '5 months'
      group by 1 order by 1`,
    // have the contacts of these accounts been read at all? (a zero is only a zero when the check could run)
    db`
      with loc as (${visible(installationId, allowed)})
      select count(*)::int accounts, count(*) filter (where l.contacts_synced_at is not null)::int synced
      from locations l join loc on loc.location_id = l.location_id where l.installation_id = ${installationId}`,
  ]);

  const tagCountsAll = tags.map((t) => ({ tag: t.tag as string, count: t.n as number }));
  // Cold lists (N45): the tags the owner marked, or the ones whose names say so. Contacts carrying one are kept apart from the working leads.
  const cold = effectiveColdTags(tagCountsAll.map((t) => t.tag), chosenColdTags);
  const coldArr = pgArray(cold.map((c) => c.tag));
  const [[split], coldRows] = await Promise.all([
    db`
      with loc as (${visible(installationId, allowed)}),
      sig as (
        -- What a contact has done that SubSync can see: the customer wrote last in a conversation, an appointment, a deal in play. The newest
        -- conversations only (waiting.ts), so "none seen" is not "never replied".
        select location_id, contact_id, max(t) last_signal from (
          select location_id, contact_id, last_message_at t from cached_conversations
            where installation_id = ${installationId} and contact_id is not null and last_message_direction = 'inbound'
          union all
          select location_id, contact_id, start_at from cached_appointments
            where installation_id = ${installationId} and contact_id is not null and status <> 'invalid'
          union all
          select o.location_id, o.contact_id, coalesce(greatest(o.last_stage_change_at, o.last_action_at, o.updated_remote_at), o.created_remote_at)
            from cached_opportunities o ${dealScopeJoins()} where o.installation_id = ${installationId} and o.contact_id is not null and not (o.status = 'open' and ${outOfScope()})
        ) s group by location_id, contact_id),
      x as (
        select (c.tags && ${coldArr}::text[]) is_cold, sig.last_signal
        from cached_contacts c join loc on loc.location_id = c.location_id
        left join sig on sig.location_id = c.location_id and sig.contact_id = c.contact_id
        where c.installation_id = ${installationId})
      select count(*) filter (where not is_cold)::int working,
        count(*) filter (where is_cold)::int cold,
        count(*) filter (where not is_cold and last_signal is null)::int working_none,
        count(*) filter (where not is_cold and last_signal >= now() - make_interval(days => ${QUIET_AFTER_DAYS}::int))::int working_recent,
        count(*) filter (where not is_cold and last_signal < now() - make_interval(days => ${QUIET_AFTER_DAYS}::int))::int working_quiet
      from x`,
    cold.length === 0 ? Promise.resolve([] as Array<Record<string, unknown>>) : db`
      with loc as (${visible(installationId, allowed)}),
      sig as (
        select location_id, contact_id, max(t) last_signal from (
          select location_id, contact_id, last_message_at t from cached_conversations
            where installation_id = ${installationId} and contact_id is not null and last_message_direction = 'inbound'
          union all
          select location_id, contact_id, start_at from cached_appointments where installation_id = ${installationId} and contact_id is not null and status <> 'invalid'
        ) s group by location_id, contact_id)
      select t.tag, count(*)::int contacts, count(sig.last_signal)::int engaged
      from cached_contacts c join loc on loc.location_id = c.location_id cross join lateral unnest(c.tags) t(tag)
      left join sig on sig.location_id = c.location_id and sig.contact_id = c.contact_id
      where c.installation_id = ${installationId} and t.tag = any(${coldArr}::text[])
      group by t.tag order by contacts desc limit 20`,
  ]);

  const cohortRows = cohorts.map((c) => ({
    month: c.month as string, leads: c.leads as number, converted: c.converted as number, revenue: c.revenue as number,
    conversionPct: c.leads > 0 ? Math.round((c.converted / c.leads) * 1000) / 10 : null,
  }));
  const tagCounts = tagCountsAll;
  return {
    cohorts: cohortRows,
    lifecycle: { total: life.total, leads: life.leads, opportunities: life.opportunities, opportunitiesCounted: life.opportunities_counted, customers: life.customers, lost: life.lost },
    // N45: working leads apart from cold lists, and for the working leads: seen recently, seen then quiet, nothing seen.
    engagement: {
      working: split.working as number, cold: split.cold as number, noneSeen: split.working_none as number, recent: split.working_recent as number, quietAfter: split.working_quiet as number, quietDays: QUIET_AFTER_DAYS,
      coldLists: coldRows.map((r) => ({ tag: r.tag as string, contacts: r.contacts as number, engaged: r.engaged as number, source: cold.find((c) => c.tag === r.tag)?.source ?? "name" })),
      coldChosen: chosenColdTags !== null,
    },
    leadAging: { over30: aging.over30, over60: aging.over60, over90: aging.over90 },
    inactive: { total: quiet.total, never: quiet.never, silent: quiet.silent, d30: quiet.d30, d60: quiet.d60, d90: quiet.d90, d180: quiet.d180 },
    growth: {
      weekly: growth.map((g) => ({ week: (iso(g.week) ?? String(g.week)).slice(0, 10), count: g.n as number })),
      /** Contacts added over those 12 weeks, added up here and not on the screen. */
      total12w: growth.reduce((s, g) => s + (g.n as number), 0),
      accounts: accountGrowth.map((a) => ({
        locationId: a.location_id as string, name: a.name as string | null, last30: a.last30 as number, prev30: a.prev30 as number,
        // A percentage only when the earlier month was big enough to measure one against (metrics.ts, N6).
        changePct: percentChange(a.last30, a.prev30),
      })),
    },
    tags: {
      top: tagCounts.slice(0, 15),
      rare: tagCounts.filter((t) => t.count <= 2).slice(-12),
      variants: tagVariants(tagCounts).slice(0, 10),
    },
    quality: qualityFigures({ total: quality.total, withEmail: quality.with_email, withPhone: quality.with_phone, badEmail: quality.bad_email, disposable: quality.disposable, badPhone: quality.bad_phone }, (syncState?.synced ?? 0) > 0),
    imports: imports.map((i) => ({ account: i.name as string, day: (iso(i.day) ?? String(i.day)).slice(0, 10), count: i.n as number, noEmailPct: i.no_email as number, noPhonePct: i.no_phone as number })),
  };
}

export type TopLead = {
  contactId: string; locationId: string; locationName: string | null; name: string; email: string | null; phone: string | null;
  score: number; reasons: string[]; lastActivityAt: string | null;
};

export async function topLeads(installationId: string, allowed: string[] | null, limit = 25): Promise<TopLead[]> {
  const db = sql();
  const rows = await db`
    with loc as (${visible(installationId, allowed)}),
    deals as (
      select o.location_id, o.contact_id, bool_or(o.status = 'open' and not ${outOfScope()}) open, bool_or(o.status = 'won') won, bool_or(o.status = 'lost') lost,
        coalesce(sum(o.monetary_value) filter (where o.status = 'open' and ${countedInScope()}), 0)::float8 open_value
      from cached_opportunities o ${dealScopeJoins()} where o.installation_id = ${installationId} and o.contact_id is not null group by o.location_id, o.contact_id)
    select c.contact_id, c.location_id, loc.name location_name, coalesce(nullif(c.full_name, ''), nullif(c.email, ''), 'Unnamed contact') name,
      c.email, c.phone, c.tags, c.date_added, c.last_activity_at,
      coalesce(d.open, false) has_open, coalesce(d.won, false) has_won, coalesce(d.lost, false) has_lost, coalesce(d.open_value, 0) open_value
    from cached_contacts c join loc on loc.location_id = c.location_id
    left join deals d on d.location_id = c.location_id and d.contact_id = c.contact_id
    where c.installation_id = ${installationId} and not coalesce(d.won, false)
      and (c.last_activity_at > now() - interval '90 days' or coalesce(d.open, false))
    order by c.last_activity_at desc nulls last limit 2000`;
  const now = Date.now();
  return rows
    .map((r) => {
      const facts: LeadFacts = {
        email: r.email, phone: r.phone, tags: (r.tags as string[] | null) ?? [], dateAdded: ms(r.date_added), lastActivityAt: ms(r.last_activity_at),
        hasOpenDeal: r.has_open, openDealValue: r.open_value, hasWonDeal: r.has_won, hasLostDeal: r.has_lost,
      };
      const s = leadScore(facts, now);
      return {
        contactId: r.contact_id as string, locationId: r.location_id as string, locationName: r.location_name as string | null, name: r.name as string,
        email: r.email as string | null, phone: r.phone as string | null, score: s.score, reasons: s.reasons, lastActivityAt: iso(r.last_activity_at),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export type Vip = {
  contactId: string; locationId: string; locationName: string | null; name: string; wonValue: number; openValue: number; wonCount: number;
  lastActivityAt: string | null; idleDays: number | null; needsContact: boolean;
};

export async function vips(installationId: string, allowed: string[] | null, idleAlertDays = 30, limit = 25): Promise<Vip[]> {
  const db = sql();
  const rows = await db`
    with loc as (${visible(installationId, allowed)}),
    value as (
      select o.location_id, o.contact_id,
        coalesce(sum(o.monetary_value) filter (where o.status = 'won'), 0)::float8 won_value,
        coalesce(sum(o.monetary_value) filter (where o.status = 'open' and ${countedInScope()}), 0)::float8 open_value,
        count(*) filter (where o.status = 'won')::int won_count
      from cached_opportunities o ${dealScopeJoins()} where o.installation_id = ${installationId} and o.contact_id is not null group by o.location_id, o.contact_id
      having count(*) filter (where o.status = 'won') > 0 or coalesce(sum(o.monetary_value) filter (where o.status = 'open' and ${countedInScope()}), 0) > 0)
    select c.contact_id, c.location_id, loc.name location_name, coalesce(nullif(c.full_name, ''), nullif(c.email, ''), 'Unnamed contact') name,
      v.won_value, v.open_value, v.won_count, c.last_activity_at
    from value v join cached_contacts c on c.installation_id = ${installationId} and c.location_id = v.location_id and c.contact_id = v.contact_id
    join loc on loc.location_id = c.location_id
    order by (v.won_value + v.open_value * 0.5 + v.won_count * 100) desc limit ${limit}`;
  const now = Date.now();
  return rows
    .map((r) => {
      const idle = daysIdle(ms(r.last_activity_at), now);
      return {
        contactId: r.contact_id as string, locationId: r.location_id as string, locationName: r.location_name as string | null, name: r.name as string,
        wonValue: r.won_value as number, openValue: r.open_value as number, wonCount: r.won_count as number,
        lastActivityAt: iso(r.last_activity_at), idleDays: idle, needsContact: idle === null || idle > idleAlertDays,
      };
    })
    .sort((a, b) => vipScore({ wonValue: b.wonValue, openValue: b.openValue, wonCount: b.wonCount, lastActivityAt: null }) - vipScore({ wonValue: a.wonValue, openValue: a.openValue, wonCount: a.wonCount, lastActivityAt: null }));
}

// A few example contacts with bad data, so the numbers can be acted on.
export async function badDataSamples(installationId: string, allowed: string[] | null, limit = 15) {
  const rows = await sql()`
    with loc as (${visible(installationId, allowed)})
    select c.contact_id, c.location_id, loc.name location_name, coalesce(nullif(c.full_name, ''), 'Unnamed contact') name, c.email, c.phone, c.phone_digits
    from cached_contacts c join loc on loc.location_id = c.location_id
    where c.installation_id = ${installationId}
      and (${emailInvalid()} or (nullif(btrim(c.email), '') is not null and lower(split_part(btrim(c.email), '@', 2)) = any(${DISPOSABLE_LIST}::text[]))
        or ${phoneInvalid()})
    order by c.date_added desc nulls last limit ${limit}`;
  return rows.map((r) => ({
    contactId: r.contact_id as string, locationId: r.location_id as string, locationName: r.location_name as string | null, name: r.name as string,
    email: r.email as string | null, phone: r.phone as string | null, emailProblem: emailProblem(r.email),
  }));
}
