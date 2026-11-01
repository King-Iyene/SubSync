import { clockStart, excludeReason, type Exclusion } from "../analytics/lead-rules";
import { sql } from "../db";

// Re-decides, for every lead of one account in the last 60 days, whether it counts (lead-rules.ts: not a bulk import, spam,
// test, do-not-contact or duplicate) and when its reply clock starts (business hours, in the account's time zone). It runs
// after each speed sync, so a changed setting or a contact that was merged or tagged later is reflected within a sync.
// Everything that reads lead_touches uses these two columns, so every screen agrees.
export const LEAD_RULES_WINDOW_DAYS = 60;

export async function applyLeadRules(installationId: string, locationId: string): Promise<{ checked: number; excluded: number }> {
  const db = sql();
  const [[settings], [loc]] = await Promise.all([
    db`select speed_business_hours, speed_open_hour, speed_close_hour from settings where installation_id = ${installationId}`,
    db`select timezone from locations where installation_id = ${installationId} and location_id = ${locationId}`,
  ]);
  const hours = settings?.speed_business_hours === true ? { open: Number(settings.speed_open_hour ?? 9), close: Number(settings.speed_close_hour ?? 17) } : null;
  const tz = (loc?.timezone as string | null) ?? null;
  const since = new Date(Date.now() - (LEAD_RULES_WINDOW_DAYS + 1) * 86_400_000);

  const rows = await db`
    with minutes as (
      select date_trunc('minute', date_added) mn, count(*)::int n from cached_contacts
      where installation_id = ${installationId} and location_id = ${locationId} and date_added > ${since} group by 1
    ), emails as (
      select lower(email) k, min(date_added) first_at from cached_contacts
      where installation_id = ${installationId} and location_id = ${locationId} and nullif(email, '') is not null group by 1
    ), phones as (
      select phone_digits k, min(date_added) first_at from cached_contacts
      where installation_id = ${installationId} and location_id = ${locationId} and length(phone_digits) >= 7 group by 1
    )
    select t.id, t.lead_at, t.excluded, t.clock_start, c.full_name, c.email, c.tags, c.source, c.dnd,
      coalesce(m.n, 1) created_together,
      (e.first_at is not null and e.first_at < c.date_added) or (p.first_at is not null and p.first_at < c.date_added) earlier_duplicate
    from lead_touches t
    join cached_contacts c on c.installation_id = t.installation_id and c.location_id = t.location_id and c.contact_id = t.contact_id
    left join minutes m on m.mn = date_trunc('minute', c.date_added)
    left join emails e on e.k = lower(c.email) and nullif(c.email, '') is not null
    left join phones p on p.k = c.phone_digits and length(c.phone_digits) >= 7
    where t.installation_id = ${installationId} and t.location_id = ${locationId} and t.lead_at > ${since}`;

  const ids: string[] = [], excluded: Array<string | null> = [], starts: Array<string | null> = [];
  let excludedCount = 0;
  for (const r of rows) {
    const reason: Exclusion | null = excludeReason(
      { fullName: r.full_name as string | null, email: r.email as string | null, tags: (r.tags as string[] | null) ?? [], source: r.source as string | null, dnd: r.dnd === true },
      { createdTogether: Number(r.created_together), earlierDuplicate: r.earlier_duplicate === true },
    );
    const leadAt = (r.lead_at as Date).getTime();
    const start = clockStart(leadAt, tz, hours);
    const startIso = start === leadAt ? null : new Date(start).toISOString();
    const before = r.clock_start instanceof Date ? r.clock_start.toISOString() : null;
    if ((r.excluded as string | null) === reason && before === startIso) continue; // nothing changed
    ids.push(r.id as string); excluded.push(reason); starts.push(startIso);
    if (reason) excludedCount += 1;
  }
  if (ids.length > 0) {
    await db`
      update lead_touches t set excluded = v.ex, clock_start = v.cs
      from (select unnest(${ids}::bigint[]) id, unnest(${excluded}::text[]) ex, unnest(${starts}::timestamptz[]) cs) v
      where t.id = v.id`;
  }
  return { checked: rows.length, excluded: excludedCount };
}
