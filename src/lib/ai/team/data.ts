import { appointmentView } from "../../analytics/appointment-queries";
import { zAnomaly } from "../../analytics/client-intel";
import { getSettings, staleDealsPage } from "../../analytics/queries";
import { speedView } from "../../analytics/speed-queries";
import { sql } from "../../db";
import { dayLabel, candidateText, COACH_DAYS, MIN_FIRST_REPLIES, type Anomaly, type Candidate, type Journey, type PersonNums, type TeamMiddle } from "./facts";
import { OPT_IN_JOBS, type TeamJobId } from "./jobs";

// The database side of the team and client jobs. Every statement names the company (and the client account), so one tenant's rows are never read for another. Callers pass the accounts the
// signed-in person may read (`allowed`, null = all of the company's); an account id from a request must already have been checked with ownedLocation. Nothing here writes.

const DAY = 86_400_000;
const num = (v: unknown): number | null => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---------------------------------------------------------------- 2. lead journeys

export type JourneyPage = { rows: Journey[]; total: number; page: number; size: number; targetMinutes: number; account: string };
/** One page of an account's recent leads, oldest news last, with what happened to each. Names are read only when `withNames` is true (the account opted in); they are never sent to the AI. */
export async function journeysFor(inst: string, loc: string, o: { days: number; page: number; size: number; countAutomated: boolean; defaultTarget: number; withNames: boolean }, now = Date.now()): Promise<JourneyPage | null> {
  const db = sql();
  const [l] = await db`select name, timezone, speed_target_minutes from locations where installation_id = ${inst} and location_id = ${loc} and not ignored`;
  if (!l) return null;
  const tz = typeof l.timezone === "string" && l.timezone ? l.timezone : null, target = typeof l.speed_target_minutes === "number" ? l.speed_target_minutes : o.defaultTarget;
  const since = new Date(now - o.days * DAY), until = new Date(now - 3_600_000);
  const reply = o.countAutomated ? db`coalesce(t.human_touch_at, t.touch_at)` : db`t.human_touch_at`;
  const [tot] = await db`select count(*)::int n from lead_touches t where t.installation_id = ${inst} and t.location_id = ${loc} and t.excluded is null and t.lead_at > ${since} and t.lead_at < ${until}`;
  const rows = await db`
    select t.contact_id, coalesce(t.clock_start, t.lead_at) lead_at, ${reply} reply_at, (t.human_touch_at is null and t.touch_at is not null) auto_only, c.source,
      ${o.withNames ? db`nullif(btrim(c.full_name), '')` : db`null::text`} name,
      (select count(*)::int from cached_appointments a where a.installation_id = t.installation_id and a.location_id = t.location_id and a.contact_id = t.contact_id and (a.created_remote_at is null or a.created_remote_at >= t.lead_at - interval '1 day')) bookings,
      (select a.status from cached_appointments a where a.installation_id = t.installation_id and a.location_id = t.location_id and a.contact_id = t.contact_id order by a.start_at desc nulls last limit 1) appt_status,
      (select case when bool_or(op.status = 'won') then 'won' when bool_or(op.status = 'open') then 'open' when bool_or(op.status = 'lost') then 'lost' end
         from cached_opportunities op where op.installation_id = t.installation_id and op.location_id = t.location_id and op.contact_id = t.contact_id) deal
    from lead_touches t left join cached_contacts c on c.installation_id = t.installation_id and c.location_id = t.location_id and c.contact_id = t.contact_id
    where t.installation_id = ${inst} and t.location_id = ${loc} and t.excluded is null and t.lead_at > ${since} and t.lead_at < ${until}
    order by t.lead_at desc, t.contact_id limit ${o.size} offset ${o.page * o.size}`;
  return {
    total: Number(tot?.n ?? 0), page: o.page, size: o.size, targetMinutes: target, account: (l.name as string | null) ?? "Client account",
    rows: rows.map((r) => {
      const at = new Date(r.lead_at as string).getTime(), rep = r.reply_at ? new Date(r.reply_at as string).getTime() : null;
      const minutes = rep === null ? null : Math.max(0, Math.round((rep - at) / 60_000));
      return {
        contactId: r.contact_id as string, name: (r.name as string | null) ?? null, arrivedAt: at, arrivedOn: dayLabel(at, tz), source: (r.source as string | null)?.trim().slice(0, 40) || null,
        firstReplyMinutes: minutes, replyBy: minutes === null ? null : r.auto_only === true ? "automatic" : "person", inTarget: minutes === null ? null : minutes <= target,
        bookings: Number(r.bookings ?? 0), apptStatus: (r.appt_status as string | null) ?? null, deal: (r.deal as Journey["deal"]) ?? null,
      } satisfies Journey;
    }),
  };
}

// ---------------------------------------------------------------- 3. people

export type PersonRow = PersonNums & { userId: string; name: string };
/** Each person's own figures for the last 30 days over the accounts given, plus the middle figure of the people with enough data. `ids` null = every account of the company. */
export async function peopleWindow(inst: string, ids: string[] | null, now = Date.now()): Promise<{ people: Map<string, PersonRow>; team: TeamMiddle }> {
  const db = sql();
  const from = new Date(now - COACH_DAYS * DAY).toISOString().slice(0, 10);
  const rows = await db`
    select user_id, sum(first_replies)::int fr, sum(in_time)::int it, sum(touches_sms + touches_email + touches_call + touches_other)::int touches, sum(appts_set)::int aps, sum(held)::int held, sum(no_show)::int nos,
      (sum(median_seconds::float8 * first_replies) filter (where median_seconds is not null) / nullif(sum(first_replies) filter (where median_seconds is not null), 0))::float8 wmed
    from user_daily where installation_id = ${inst} and day >= ${from}::date ${ids ? db`and location_id = any(${ids}::text[])` : db``} group by user_id`;
  const names = new Map((await db`select user_id, name from team_names where installation_id = ${inst}`.catch(() => [])).map((n) => [n.user_id as string, (n.name as string | null) ?? ""]));
  const people = new Map<string, PersonRow>();
  for (const r of rows) {
    const fr = Number(r.fr), held = Number(r.held), nos = Number(r.nos), wmed = num(r.wmed);
    people.set(r.user_id as string, {
      userId: r.user_id as string, name: names.get(r.user_id as string) || "Team member", firstReplies: fr, replyMinutes: wmed === null ? null : Math.round(wmed / 60), inTimePct: fr >= MIN_FIRST_REPLIES ? Math.round((Number(r.it) / fr) * 100) : null,
      showPct: held + nos >= 5 ? Math.round((held / (held + nos)) * 100) : null, apptsSet: Number(r.aps), outcomesMarked: held + nos, touches: Number(r.touches), days: COACH_DAYS,
    });
  }
  const enough = [...people.values()].filter((p) => p.firstReplies >= MIN_FIRST_REPLIES);
  const mid = (f: (p: PersonRow) => number | null) => { const m = median(enough.map(f).filter((x): x is number => x !== null)); return m === null ? null : Math.round(m); };
  return { people, team: { people: enough.length, replyMinutes: mid((p) => p.replyMinutes), inTimePct: mid((p) => p.inTimePct), showPct: mid((p) => p.showPct), apptsSet: mid((p) => p.apptsSet), touches: mid((p) => p.touches) } };
}

/** The client accounts where a job is switched on: the account's own choice, else the company default, else the job's default. */
export async function accountsWithJob(inst: string, allowed: string[] | null, job: TeamJobId): Promise<string[]> {
  const db = sql();
  const [c] = await db`select jobs from ai_team_prefs where installation_id = ${inst} and location_id = ''`;
  const cv = (c?.jobs as Record<string, unknown> | undefined)?.[job];
  const dflt = typeof cv === "boolean" ? cv : !OPT_IN_JOBS.includes(job);
  const rows = await db`select l.location_id from locations l left join ai_team_prefs p on p.installation_id = l.installation_id and p.location_id = l.location_id
    where l.installation_id = ${inst} and not l.ignored ${allowed ? db`and l.location_id = any(${allowed}::text[])` : db``}
      and coalesce((p.jobs ->> ${job}::text)::boolean, ${dflt})`;
  return rows.map((r) => r.location_id as string);
}

// ---------------------------------------------------------------- 4. anomalies

export type FoundAnomaly = { locationId: string; name: string; anomaly: Anomaly };
const weeklyZ = (series: Array<number | null>, minLevel: number) => {
  if (series.length !== 5 || series.some((v) => v === null)) return null;
  const xs = series as number[];
  if (xs.slice(0, 4).reduce((s, x) => s + x, 0) / 4 < minLevel) return null;
  return zAnomaly(xs, { minPoints: 3, z: 2, minRelative: 0.3 });
};

/** Numbers that moved outside their own normal range: this week against the four weeks before it, per account. The detection is plain code (a z-score), never the model. */
export async function scanAnomalies(inst: string, allowed: string[] | null, now = Date.now(), limit = 40): Promise<FoundAnomaly[]> {
  const db = sql();
  const today = new Date(now).toISOString().slice(0, 10);
  const [speed, appts] = await Promise.all([
    db`select s.location_id, l.name, ((${today}::date - s.day) / 7)::int w, sum(s.leads)::int leads, sum(s.within_target)::int within,
        (sum(s.median_seconds::float8 * s.answered) filter (where s.median_seconds is not null) / nullif(sum(s.answered) filter (where s.median_seconds is not null), 0))::float8 wmed, sum(s.answered)::int answered
       from speed_daily s join locations l on l.installation_id = s.installation_id and l.location_id = s.location_id and not l.ignored
       where s.installation_id = ${inst} and s.day > ${today}::date - 35 and s.day <= ${today}::date ${allowed ? db`and s.location_id = any(${allowed}::text[])` : db``} group by 1, 2, 3`,
    db`select c.location_id, ((${today}::date - c.day) / 7)::int w, sum(c.showed)::int showed, sum(c.noshow)::int noshow from client_daily c
       where c.installation_id = ${inst} and c.day > ${today}::date - 35 and c.day <= ${today}::date ${allowed ? db`and c.location_id = any(${allowed}::text[])` : db``} group by 1, 2`,
  ]).catch(() => [[], []] as never[][]);
  type W = { leads?: number; within?: number; wmed?: number | null; answered?: number; showed?: number; noshow?: number };
  const by = new Map<string, { name: string; w: W[] }>();
  const slot = (loc: string, name?: string) => { let e = by.get(loc); if (!e) { e = { name: name ?? "Client account", w: [{}, {}, {}, {}, {}] }; by.set(loc, e); } else if (name) e.name = name; return e; };
  for (const r of speed) { const i = Number(r.w); if (i < 0 || i > 4) continue; Object.assign(slot(r.location_id as string, (r.name as string | null) ?? undefined).w[i], { leads: Number(r.leads), within: Number(r.within), wmed: num(r.wmed), answered: Number(r.answered) }); }
  for (const r of appts) { const i = Number(r.w); if (i < 0 || i > 4) continue; Object.assign(slot(r.location_id as string).w[i], { showed: Number(r.showed), noshow: Number(r.noshow) }); }
  const out: FoundAnomaly[] = [];
  const push = (locationId: string, name: string, key: Anomaly["key"], label: string, unit: Anomaly["unit"], z: ReturnType<typeof zAnomaly>) => {
    if (!z || !Number.isFinite(z.mean)) return;
    out.push({ locationId, name, anomaly: { key, label, direction: z.direction, current: Math.round(z.latest), usual: Math.round(z.mean), unit, relativePct: z.mean === 0 ? 100 : Math.round((Math.abs(z.latest - z.mean) / Math.abs(z.mean)) * 100) } });
  };
  for (const [loc, e] of by) {
    const order = [4, 3, 2, 1, 0].map((i) => e.w[i]); // oldest first, this week last
    push(loc, e.name, "leads", "New leads per week", "count", weeklyZ(order.map((w) => w.leads ?? null), 8));
    push(loc, e.name, "in_time", "Share of new leads answered in time", "pct", weeklyZ(order.map((w) => (w.leads && w.leads >= 10 ? ((w.within ?? 0) / w.leads) * 100 : null)), 1));
    push(loc, e.name, "reply", "Typical first reply time", "minutes", weeklyZ(order.map((w) => (w.answered && w.answered >= 8 && w.wmed != null ? w.wmed / 60 : null)), 1));
    push(loc, e.name, "show", "Share of booked appointments attended", "pct", weeklyZ(order.map((w) => ((w.showed ?? 0) + (w.noshow ?? 0) >= 5 ? ((w.showed ?? 0) / ((w.showed ?? 0) + (w.noshow ?? 0))) * 100 : null)), 1));
  }
  return out.sort((a, b) => b.anomaly.relativePct - a.anomaly.relativePct).slice(0, limit);
}

/** Plain context counts for one account's anomaly (this week against the usual week). Each line is written here, with its figures, so the model never counts. */
export async function anomalyContext(inst: string, loc: string, now = Date.now()): Promise<string[]> {
  const db = sql();
  const today = new Date(now).toISOString().slice(0, 10);
  const out: string[] = [];
  try {
    const rows = await db`select ((${today}::date - day) / 7)::int w, sum(leads)::int leads, sum(missed_calls)::int missed, sum(missed_followed)::int followed, jsonb_object_agg(day::text, by_source) src
      from speed_daily where installation_id = ${inst} and location_id = ${loc} and day > ${today}::date - 35 and day <= ${today}::date group by 1`;
    const now0 = rows.find((r) => Number(r.w) === 0), past = rows.filter((r) => Number(r.w) >= 1 && Number(r.w) <= 4), n = past.length;
    if (now0 && n) {
      const avg = (f: (r: Record<string, unknown>) => number) => Math.round(past.reduce((s, r) => s + f(r), 0) / n);
      out.push(`New leads in the last seven days: ${Number(now0.leads)} (usual week: ${avg((r) => Number(r.leads))})`);
      if (Number(now0.missed) > 0 || avg((r) => Number(r.missed)) > 0) out.push(`Missed calls in the last seven days: ${Number(now0.missed)} (usual week: ${avg((r) => Number(r.missed))})`);
      const sumSrc = (rs: Array<Record<string, unknown>>) => { const t = new Map<string, number>(); for (const r of rs) for (const d of Object.values((r.src as Record<string, Record<string, number> | null>) ?? {})) for (const [k, v] of Object.entries(d ?? {})) t.set(k, (t.get(k) ?? 0) + Number(v)); return t; };
      const a = sumSrc([now0]), b = sumSrc(past);
      let best: { k: string; now: number; usual: number } | null = null;
      for (const k of new Set([...a.keys(), ...b.keys()])) { const nowV = a.get(k) ?? 0, usual = Math.round((b.get(k) ?? 0) / n); if (!best || Math.abs(nowV - usual) > Math.abs(best.now - best.usual)) best = { k, now: nowV, usual }; }
      if (best && best.now !== best.usual) out.push(`Biggest change by lead source: ${best.k.slice(0, 40)} sent ${best.now} (usual week: ${best.usual})`);
    }
    const [people] = await db`select count(distinct user_id) filter (where day > ${today}::date - 7)::int nowp, count(distinct user_id) filter (where day <= ${today}::date - 7)::int pastp from user_daily
      where installation_id = ${inst} and location_id = ${loc} and first_replies > 0 and day > ${today}::date - 35 and day <= ${today}::date`;
    if (people && (Number(people.nowp) > 0 || Number(people.pastp) > 0)) out.push(`People who sent a first reply in the last seven days: ${Number(people.nowp)} (in the four weeks before: ${Number(people.pastp)})`);
    const [ns] = await db`select coalesce(sum(noshow) filter (where day > ${today}::date - 7), 0)::int nowv, coalesce(sum(noshow) filter (where day <= ${today}::date - 7), 0)::int pastv from client_daily
      where installation_id = ${inst} and location_id = ${loc} and day > ${today}::date - 35 and day <= ${today}::date`;
    if (ns && (Number(ns.nowv) > 0 || Number(ns.pastv) > 0)) out.push(`No-shows in the last seven days: ${Number(ns.nowv)} (in the four weeks before: ${Number(ns.pastv)})`);
  } catch { /* an older database: the explanation uses what it has */ }
  return out;
}

// ---------------------------------------------------------------- 6. one thing to fix

/** The items worth fixing for ONE account, from our own queries. Counts and the recorded dollar value only. Empty when nothing can be read. */
export async function oneThingCandidates(inst: string, loc: string): Promise<Candidate[]> {
  try {
    const target = (await getSettings(inst).catch(() => null))?.speedTargetMinutes ?? 15;
    const [sp, ap, stale] = await Promise.all([speedView(inst, [loc], target), appointmentView(inst, [loc]).catch(() => null), staleDealsPage(inst, { locationId: loc, limit: 1 }).catch(() => null)]);
    const out: Candidate[] = [];
    if (sp.neverAnswered > 0) out.push({ key: "never_answered", count: sp.neverAnswered, dollars: null, text: candidateText("never_answered", sp.neverAnswered) });
    if (ap && ap.recoverTotal > 0) out.push({ key: "no_shows", count: ap.recoverTotal, dollars: null, text: candidateText("no_shows", ap.recoverTotal) });
    if (stale && stale.total > 0) out.push({ key: "stale_deals", count: stale.total, dollars: stale.totalValue > 0 ? Math.round(stale.totalValue) : null, text: candidateText("stale_deals", stale.total) });
    if (ap && ap.unmarkedTotal > 0) out.push({ key: "unmarked", count: ap.unmarkedTotal, dollars: null, text: candidateText("unmarked", ap.unmarkedTotal) });
    return out;
  } catch { return []; }
}

/** The few accounts with the weakest answered-in-time share over the last 14 days (at least 10 leads), for the weekly digest. */
export async function weakestAccounts(inst: string, limit = 3, now = Date.now()): Promise<Array<{ locationId: string; name: string }>> {
  const today = new Date(now).toISOString().slice(0, 10);
  const rows = await sql()`select s.location_id, coalesce(l.name, 'Client account') name from speed_daily s join locations l on l.installation_id = s.installation_id and l.location_id = s.location_id and not l.ignored
    where s.installation_id = ${inst} and s.day > ${today}::date - 14 group by s.location_id, l.name having sum(s.leads) >= 10
    order by sum(s.within_target)::float8 / nullif(sum(s.leads), 0) asc, s.location_id limit ${limit}`.catch(() => []);
  return rows.map((r) => ({ locationId: r.location_id as string, name: r.name as string }));
}

// ---------------------------------------------------------------- 5. meetings

export type MeetingRow = { id: string; title: string | null; summary: string | null; actionItems: string[]; locationId: string };
/** One recorded call of THIS person (meetings are private to the person whose tool recorded them). Null when it is not theirs. */
export async function meetingOf(inst: string, userId: string, id: string): Promise<MeetingRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [m] = await sql()`select id::text id, title, summary, action_items, matched_location_id from meetings where id = ${id}::uuid and installation_id = ${inst} and owner_ghl_user_id = ${userId}`;
  if (!m) return null;
  const items = Array.isArray(m.action_items) ? (m.action_items as unknown[]).map((x) => (typeof x === "string" ? x : x && typeof x === "object" && typeof (x as { text?: unknown }).text === "string" ? (x as { text: string }).text : "")).filter(Boolean) : [];
  return { id: m.id as string, title: (m.title as string | null) ?? null, summary: (m.summary as string | null) ?? null, actionItems: items, locationId: (m.matched_location_id as string | null) ?? "" };
}
