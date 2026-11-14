import { sql } from "../db";
import { callerLabel } from "../dial/dial";
import { type Bucket, type FollowState, type ReplyChannel, type View } from "./missed-board-rules";

// Speed to lead > Missed: two separate lists, both read from SubSync's own touch history (metadata only), both aggregated and paged in SQL (a million events cost the same as ten).
//   calls:   one row per caller (account + contact): their latest missed call (a recorded inbound call nobody answered) in the range.
//   replies: one row per person: their latest inbound text, email, WhatsApp or chat message in the range.
// Each row is judged by what came AFTER it (rules in missed-board-rules.ts, same as this SQL): a PERSON's outbound call or message (not automatic, not failed) or a call result logged in
// Call mode = "person"; only an automatic message = "auto"; nothing = "none". An automatic text-back is NOT a person. Written once here; the counts and the page share the same CTE.

export type Mode = "calls" | "replies";
export type BoardScope = {
  installationId: string; allowed: string[] | null; fromMs: number; toMs: number; now: number; mode: Mode;
  view: View; bucket: Bucket | null; channel: ReplyChannel | null; owner: string | null; /** A client's staff: only the people assigned to this person ("" = nobody). */ ownerId?: string | null;
  limit: number; offset: number;
};
export type BoardRow = {
  key: string; locationId: string; contactId: string; locationName: string; name: string; phone: string | null; hasRecord: boolean; dnd: boolean; ownerId: string | null; ownerName: string | null;
  at: number; waitMs: number; channel: string; line: string | null; state: FollowState; personAt: number | null; personChannel: string | null; autoAt: number | null; bucket: Bucket;
};
export type BoardCounts = { total: number; waiting: number; none: number; auto: number; person: number; buckets: Record<Bucket, number>; channels: Record<string, number> };
export type Board = { counts: BoardCounts; rows: BoardRow[]; shown: number; lineKnown: boolean };

type Db = ReturnType<typeof sql>;

function base(db: Db, s: BoardScope, withLine: boolean) {
  const place = s.allowed ? db`and e.location_id = any(${s.allowed}::text[])` : db``;
  const range = db`e.installation_id = ${s.installationId} and e.at >= ${new Date(s.fromMs)} and e.at < ${new Date(s.toMs)} ${place}`;
  const line = withLine ? db`e.line` : db`null::text`;
  const latest = s.mode === "calls"
    ? db`select distinct on (e.location_id, e.contact_id) e.location_id, e.contact_id, e.at, e.channel, ${line} line from touch_events e
         where ${range} and e.kind = 'missed_call' order by e.location_id, e.contact_id, e.at desc`
    : db`select distinct on (e.location_id, e.contact_id) e.location_id, e.contact_id, e.at, e.channel, ${line} line from touch_events e
         where ${range} and e.direction = 'inbound' and e.kind = 'message' and e.channel in ('sms', 'email', 'whatsapp', 'chat') order by e.location_id, e.contact_id, e.at desc`;
  const ownerSql = s.ownerId ? db`and nullif(c.assigned_to, '') = ${s.ownerId}` : s.owner === "none" ? db`and nullif(c.assigned_to, '') is null` : s.owner ? db`and nullif(c.assigned_to, '') = ${s.owner}` : db``;
  const channelSql = s.channel ? db`and m.channel = ${s.channel}` : db``;
  return db`
    m as (${latest}),
    x as (
      select m.location_id, m.contact_id, m.at, m.channel, m.line, l.name location_name, l.timezone,
        p.at person_at, p.channel person_channel, a.at auto_at,
        case when least(p.at, co.at) is not null then 'person' when a.at is not null then 'auto' else 'none' end state,
        nullif(coalesce(nullif(c.full_name, ''), nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '')), '') name, c.email, c.phone, coalesce(c.dnd, false) dnd,
        nullif(c.assigned_to, '') owner, (c.contact_id is not null) has_record,
        floor(extract(epoch from (${new Date(s.now)}::timestamptz - m.at)) * 1000)::float8 wait_ms
      from m
      join locations l on l.installation_id = ${s.installationId} and l.location_id = m.location_id and not l.ignored
      ${s.ownerId ? db`join` : db`left join`} cached_contacts c on c.installation_id = ${s.installationId} and c.location_id = m.location_id and c.contact_id = m.contact_id
      left join lateral (select o.at, o.channel from touch_events o where o.installation_id = ${s.installationId} and o.location_id = m.location_id and o.contact_id = m.contact_id
        and o.direction = 'outbound' and not o.automated and o.kind <> 'failed' and o.at > m.at order by o.at limit 1) p on true
      left join lateral (select min(o.at) at from touch_events o where o.installation_id = ${s.installationId} and o.location_id = m.location_id and o.contact_id = m.contact_id
        and o.direction = 'outbound' and o.automated and o.kind <> 'failed' and o.at > m.at) a on true
      left join lateral (select min(k.created_at) at from call_outcomes k where k.installation_id = ${s.installationId} and k.location_id = m.location_id and k.contact_id = m.contact_id and k.created_at > m.at) co on true
      where true ${ownerSql} ${channelSql})`;
}

const bucketSql = (db: Db) => db`case when x.wait_ms < 3600000 then 'lt1h' when x.wait_ms < 14400000 then 'h1to4' when x.wait_ms < 86400000 then 'h4to24' else 'gt24h' end`;

async function run(s: BoardScope, withLine: boolean): Promise<Board> {
  const db = sql();
  const b = base(db, s, withLine);
  const viewSql = s.view === "all" ? db`true` : s.view === "waiting" ? db`x.state <> 'person'` : db`x.state = ${s.view}`;
  const bucketCond = s.bucket ? db`and ${bucketSql(db)} = ${s.bucket}` : db``;
  const [page, [c], ch] = await Promise.all([
    db`with ${b}
      select x.*, ${bucketSql(db)} bucket from x where ${viewSql} ${bucketCond}
      order by case when x.state = 'person' then 1 else 0 end, x.at asc, x.location_id, x.contact_id limit ${s.limit} offset ${s.offset}`,
    db`with ${b} select count(*)::int total, count(*) filter (where x.state <> 'person')::int waiting, count(*) filter (where x.state = 'none')::int n_none, count(*) filter (where x.state = 'auto')::int n_auto, count(*) filter (where x.state = 'person')::int n_person,
      count(*) filter (where x.state <> 'person' and x.wait_ms < 3600000)::int b1, count(*) filter (where x.state <> 'person' and x.wait_ms >= 3600000 and x.wait_ms < 14400000)::int b2,
      count(*) filter (where x.state <> 'person' and x.wait_ms >= 14400000 and x.wait_ms < 86400000)::int b3, count(*) filter (where x.state <> 'person' and x.wait_ms >= 86400000)::int b4 from x`,
    db`with ${b} select x.channel, count(*)::int n from x where x.state <> 'person' group by x.channel`,
  ]);
  const ownerIds = [...new Set(page.map((r) => r.owner as string | null).filter((v): v is string => !!v))];
  const names = ownerIds.length ? await db`select user_id, name from team_names where installation_id = ${s.installationId} and user_id = any(${ownerIds}::text[])` : [];
  const nameOf = new Map(names.map((n) => [n.user_id as string, n.name as string]));
  const rows: BoardRow[] = page.map((r) => ({
    key: `${r.location_id}:${r.contact_id}`, locationId: r.location_id as string, contactId: r.contact_id as string, locationName: (r.location_name as string | null) ?? "Unnamed account",
    name: callerLabel({ name: (r.name as string | null) ?? null, email: (r.email as string | null) ?? null, phone: (r.phone as string | null) ?? null }), phone: (r.phone as string | null) ?? null,
    hasRecord: r.has_record !== false, dnd: r.dnd === true, ownerId: (r.owner as string | null) ?? null, ownerName: r.owner ? nameOf.get(r.owner as string) ?? null : null,
    at: new Date(r.at as string).getTime(), waitMs: Number(r.wait_ms), channel: r.channel as string, line: (r.line as string | null) ?? null, state: r.state as FollowState,
    personAt: r.person_at ? new Date(r.person_at as string).getTime() : null, personChannel: (r.person_channel as string | null) ?? null, autoAt: r.auto_at ? new Date(r.auto_at as string).getTime() : null, bucket: r.bucket as Bucket,
  }));
  const counts: BoardCounts = {
    total: Number(c?.total ?? 0), waiting: Number(c?.waiting ?? 0), none: Number(c?.n_none ?? 0), auto: Number(c?.n_auto ?? 0), person: Number(c?.n_person ?? 0),
    buckets: { lt1h: Number(c?.b1 ?? 0), h1to4: Number(c?.b2 ?? 0), h4to24: Number(c?.b3 ?? 0), gt24h: Number(c?.b4 ?? 0) }, channels: Object.fromEntries(ch.map((r) => [r.channel as string, Number(r.n)])),
  };
  return { counts, rows, shown: rows.length, lineKnown: withLine };
}

/** The board for one list. If the line column is not applied yet (the migration waits for approval), it reads without it and says the line is unknown. */
export async function missedBoard(s: BoardScope): Promise<Board> {
  if (s.ownerId === "") return { counts: { total: 0, waiting: 0, none: 0, auto: 0, person: 0, buckets: { lt1h: 0, h1to4: 0, h4to24: 0, gt24h: 0 }, channels: {} }, rows: [], shown: 0, lineKnown: true };
  try { return await run(s, true); } catch (e) {
    if (/column .*line/i.test(e instanceof Error ? e.message : "")) return run(s, false);
    throw e;
  }
}
