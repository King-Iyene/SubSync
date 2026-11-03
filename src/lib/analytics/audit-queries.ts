import { sql } from "../db";
import { waitLabel } from "../design/ui-logic";
import { countedInScope, dealScopeJoins } from "./stage-rules-sql";
import { channelLabel, WAITING_WINDOW_DAYS } from "./waiting";

// The lists behind the numbers of the Account audit (stage F6, KF-6). A number on the audit opens the rows it was counted from, and the count on the number
// equals the count of the rows: each query below states the same condition as the account totals (`accountRows` in queries.ts: the counted deal fragment
// and the staleness expression for stale deals; the waiting conversation test for waiting ones), and reports its own total next to the rows it sends, so a
// capped list says how many there really are. The appointment lists come from `appointmentView`, which also produced the two appointment counts.
// Every query takes the ids of the accounts the audit itself covered (the caller's own accounts after the filter and the plan limit), so a list can never
// reach an account the numbers did not.

export const AUDIT_LIST_ROWS = 100;

export type AuditListRow = {
  id: string; name: string; locationId: string; locationName: string | null;
  /** The contact the row is about, so a name can open the lead panel. */
  contactId: string;
  /** One plain line about the row: what stage, what wait, which calendar. */
  detail: string;
  /** Deal value, for deal rows. */
  value: number | null;
  /** When it happened (the last change, the customer's last message, the appointment start). */
  at: string | null;
};
export type AuditList = {
  /** The number on the audit: how many rows match, whether or not all are sent. */
  total: number;
  /** The same rows' value, for deals (the dollar figure on the audit). */
  totalValue: number | null;
  rows: AuditListRow[];
};

const empty = (): AuditList => ({ total: 0, totalValue: null, rows: [] });
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : null);
const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** The stalled deals behind "stale deal value": counted open deals (a value, an owner, in play) with no movement for `staleDays`. Largest first. */
export async function staleDealList(installationId: string, locationIds: string[], staleDays: number, limit = AUDIT_LIST_ROWS): Promise<AuditList> {
  if (locationIds.length === 0) return empty();
  const rows = await sql()`
    select x.*, count(*) over ()::int total, coalesce(sum(x.monetary_value) over (), 0)::float8 total_value, l.name location_name,
      floor(extract(epoch from (now() - x.act)) / 86400)::int days_stale
    from (
      select o.opportunity_id, o.location_id, o.contact_id, o.contact_name, o.name, o.monetary_value::float8 monetary_value, sc_pl.name pipeline_name, sc_st.nm stage_name,
        coalesce(greatest(o.last_stage_change_at, o.last_action_at, o.updated_remote_at, o.last_status_change_at), o.created_remote_at, o.synced_at) act
      from cached_opportunities o ${dealScopeJoins()}
      where o.installation_id = ${installationId} and o.status = 'open' and o.location_id = any(${locationIds}::text[]) and ${countedInScope()}
    ) x
    join locations l on l.installation_id = ${installationId} and l.location_id = x.location_id and not l.ignored
    where x.act < now() - make_interval(days => ${staleDays}::int)
    order by x.monetary_value desc, x.act asc
    limit ${limit}`;
  if (rows.length === 0) return empty();
  return {
    total: rows[0].total as number, totalValue: rows[0].total_value as number,
    rows: rows.map((r) => ({
      id: r.opportunity_id as string, name: ((r.contact_name as string | null) || (r.name as string | null) || "Unnamed deal"), locationId: r.location_id as string, locationName: r.location_name as string | null,
      contactId: (r.contact_id as string | null) ?? "",
      detail: `${usd(r.monetary_value as number)}${r.stage_name ? ` in ${r.stage_name as string}` : ""}${r.pipeline_name ? ` (${r.pipeline_name as string})` : ""}, no change for ${r.days_stale as number} ${r.days_stale === 1 ? "day" : "days"}`,
      value: r.monetary_value as number, at: iso(r.act),
    })),
  };
}

/** The conversations behind "waiting past the reply target": the customer's message is last, older than `slaHours`, newer than the waiting window. Longest wait first. */
export async function waitingList(installationId: string, locationIds: string[], slaHours: number, limit = AUDIT_LIST_ROWS): Promise<AuditList> {
  if (locationIds.length === 0) return empty();
  const rows = await sql()`
    select c.conversation_id, c.location_id, l.name location_name, c.contact_id, c.contact_name, c.last_message_type, c.last_message_at,
      floor(extract(epoch from (now() - c.last_message_at)) / 60)::int waiting_minutes, count(*) over ()::int total
    from cached_conversations c
    join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
    where c.installation_id = ${installationId} and c.location_id = any(${locationIds}::text[])
      and c.last_message_direction = 'inbound'
      and c.last_message_at < now() - make_interval(hours => ${slaHours}::int)
      and c.last_message_at > now() - make_interval(days => ${WAITING_WINDOW_DAYS}::int)
    order by c.last_message_at asc
    limit ${limit}`;
  if (rows.length === 0) return empty();
  return {
    total: rows[0].total as number, totalValue: null,
    rows: rows.map((r) => ({
      id: r.conversation_id as string, name: (r.contact_name as string | null) || "Unnamed contact", locationId: r.location_id as string, locationName: r.location_name as string | null,
      contactId: (r.contact_id as string | null) ?? "",
      detail: `${channelLabel(r.last_message_type as string | null)}, waiting ${waitLabel(r.waiting_minutes as number)}`,
      value: null, at: iso(r.last_message_at),
    })),
  };
}

type Person = { contactId: string | null; name: string; locationId: string; locationName: string | null; at: number; calendar: string | null };
const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Appointment rows (from appointmentView's own lists, newest first) in the same shape. `total` is the count the audit shows, so it can exceed the rows sent. */
export function appointmentList(people: Person[], total: number, what: string): AuditList {
  return {
    total, totalValue: null,
    rows: people.map((p, i) => ({
      id: `${p.locationId}:${p.contactId}:${p.at}:${i}`, name: p.name, locationId: p.locationId, locationName: p.locationName, contactId: p.contactId ?? "",
      detail: `${what} ${day(p.at)}${p.calendar ? `, ${p.calendar}` : ""}`, value: null, at: new Date(p.at).toISOString(),
    })),
  };
}
