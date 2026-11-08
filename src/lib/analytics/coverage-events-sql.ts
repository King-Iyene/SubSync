import { sql } from "../db";
import { MIN_BUCKET, MIN_CHANNEL, type ChannelRow, type HourBest } from "./speed-v4";
import type { Channel } from "./touch-events";
import type { MissedScope } from "./missed-calls";

// The Coverage tab's event-based cards (best hour to reach people, channel mix, who could cover after hours) as SQL aggregates over the date range of the bar, so an account with
// millions of events is never read into the server and nothing is cut at a row cap. Same rules as the pure versions in speed-v4.ts (bestTimes, channelMix, afterHoursCover), which stay
// as the written definition and are unit tested: a "try" is a person's outbound touch that did not fail; "answered" is anything inbound from the same person within 24 hours.
// Reads need the indexes of 20261118090000_missed_calls_scale.sql (touch_events by account, time and contact).

type Db = ReturnType<typeof sql>;
const ANSWER_SECONDS = 86_400;
const base = (db: Db, s: MissedScope) => db`e.installation_id = ${s.installationId} and e.at >= ${new Date(s.fromMs)} and e.at < ${new Date(s.toMs)} ${s.allowed ? db`and e.location_id = any(${s.allowed}::text[])` : db``}`;
const answered = (db: Db) => db`exists (select 1 from touch_events i where i.installation_id = e.installation_id and i.location_id = e.location_id and i.contact_id = e.contact_id and i.direction = 'inbound' and i.at > e.at and i.at <= e.at + make_interval(secs => ${ANSWER_SECONDS}))`;

export async function bestTimesSql(s: MissedScope) {
  const db = sql();
  const rows = await db`
    select extract(hour from (e.at at time zone coalesce(l.timezone, 'UTC')))::int hr, count(*)::int sent, count(*) filter (where ${answered(db)})::int replied
    from touch_events e join locations l on l.installation_id = e.installation_id and l.location_id = e.location_id
    where ${base(db, s)} and e.direction = 'outbound' and not e.automated and e.kind <> 'failed' group by 1`;
  const hours: HourBest[] = rows.map((r) => ({ hour: Number(r.hr), sent: Number(r.sent), replied: Number(r.replied), rate: Number(r.sent) >= MIN_BUCKET * 2 ? Number(r.replied) / Number(r.sent) : null })).sort((a, b) => a.hour - b.hour);
  const best = hours.filter((h) => h.rate !== null && h.replied >= MIN_BUCKET).sort((a, b) => (b.rate as number) - (a.rate as number) || b.sent - a.sent).slice(0, 3);
  return { hours, best, enough: best.length > 0, tries: hours.reduce((n, h) => n + h.sent, 0) };
}

export async function channelMixSql(s: MissedScope): Promise<ChannelRow[]> {
  const db = sql();
  const rows = await db`
    select e.channel, count(*) filter (where e.kind <> 'failed')::int sent, count(*) filter (where e.kind <> 'failed' and ${answered(db)})::int replied, count(*) filter (where e.kind = 'failed')::int failed
    from touch_events e where ${base(db, s)} and e.direction = 'outbound' and not e.automated group by 1`;
  const out: ChannelRow[] = rows.map((r) => { const sent = Number(r.sent), failed = Number(r.failed); return { channel: r.channel as Channel, sent, replied: Number(r.replied), rate: sent >= MIN_CHANNEL ? Number(r.replied) / sent : null, failed, failedRate: sent + failed >= MIN_CHANNEL ? failed / (sent + failed) : null, winner: false }; });
  const eligible = out.filter((r) => r.rate !== null);
  if (eligible.length >= 2) { const top = eligible.reduce((a, b) => ((b.rate as number) > (a.rate as number) ? b : a)); top.winner = true; }
  return out.sort((a, b) => b.sent - a.sent);
}

/** People who have replied after hours at least 3 times in the range (weekends, before 8, from 18), top 3. */
export async function afterHoursCoverSql(s: MissedScope) {
  const db = sql();
  const rows = await db`
    select e.user_id, count(*)::int n from touch_events e join locations l on l.installation_id = e.installation_id and l.location_id = e.location_id
    where ${base(db, s)} and e.direction = 'outbound' and not e.automated and e.user_id is not null and e.user_id <> ''
      and (extract(dow from (e.at at time zone coalesce(l.timezone, 'UTC'))) in (0, 6) or extract(hour from (e.at at time zone coalesce(l.timezone, 'UTC'))) < 8 or extract(hour from (e.at at time zone coalesce(l.timezone, 'UTC'))) >= 18)
    group by 1 having count(*) >= 3 order by 2 desc limit 3`;
  return rows.map((r) => ({ userId: r.user_id as string, touches: Number(r.n) }));
}

/** How many events the range holds, counted up to 10,000 (the warm-up message only needs "none" versus "some"). */
export async function eventsInRange(s: MissedScope): Promise<number> {
  const db = sql();
  const [r] = await db`select count(*)::int n from (select 1 from touch_events e where ${base(db, s)} limit 10000) x`.catch(() => [{ n: 0 }]);
  return Number(r?.n ?? 0);
}
