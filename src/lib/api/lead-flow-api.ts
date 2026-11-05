import { sql } from "../db";
import { localMidnight } from "../analytics/growth";
import { buildFlow, isIsoDay, MAX_FLOW_DAYS, type FlowLead, type Outcome, type Reply } from "../analytics/lead-flow";
import { isMissingTable } from "../analytics/today-store";
import { json, type AuthContext } from "./auth";
import { parseReportParams } from "../analytics/report-filter";
import type { GrowthDeps } from "./growth-api";

// The Lead flow tab of Today. Read only, from data SubSync already holds: contacts (when each was added), the first-reply check (lead_touches), appointments and deals.
// Which clients a person may read is decided by the router from the signed session (`permits`); an account the caller cannot read is never in the query. The dates only
// choose WHICH leads, they never widen who may be read.

type Ctx = AuthContext & { request: Request };
const ROW_CAP = 20_000;
/** Leads sent to the browser for the lists behind each step; the counts always cover every lead (up to ROW_CAP). */
const SEND_CAP = 3_000;
/** The first-reply check covers the conversations of the last 14 days (see handleSpeed in the sync engine). */
const CHECKED_DAYS = 14;
const DAY = 86_400_000;

export async function leadFlowRead(ctx: Ctx, deps: GrowthDeps): Promise<Response> {
  const url = new URL(ctx.request.url);
  const from = url.searchParams.get("from"), to = url.searchParams.get("to");
  if (!isIsoDay(from) || !isIsoDay(to) || from > to) return json({ error: "Pick a start date and an end date that is not before it." }, 400);
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY + 1 > MAX_FLOW_DAYS) return json({ error: `Pick at most ${MAX_FLOW_DAYS} days.` }, 400);

  const permits = await deps.permits(ctx);
  const [contactUrl, accountUrl] = await Promise.all([deps.contactUrl(ctx), deps.accountUrl(ctx)]);
  const asked = parseReportParams(url, permits);
  if (!asked.ok) return json({ error: asked.error }, asked.status);
  const accounts = (await sql()`select location_id, name, timezone, speed_access from locations where installation_id = ${ctx.installationId} and not ignored order by name`)
    .filter((r) => permits(r.location_id as string) && (!asked.client || r.location_id === asked.client));
  if (asked.client && accounts.length === 0) return json({ error: "That client is not in your list." }, 404);
  if (accounts.length === 0) return json(empty(from, to, 0));

  // Each client's own midnight to midnight, so "last 7 days" means the same days the client sees.
  const [fy, fm, fd] = from.split("-").map(Number), [ty, tm, td] = to.split("-").map(Number);
  const ids = accounts.map((a) => a.location_id as string);
  const starts = accounts.map((a) => new Date(localMidnight(fy, fm, fd, (a.timezone as string | null) || "UTC")).toISOString());
  const ends = accounts.map((a) => { const e = new Date(Date.UTC(ty, tm - 1, td + 1)); return new Date(localMidnight(e.getUTCFullYear(), e.getUTCMonth() + 1, e.getUTCDate(), (a.timezone as string | null) || "UTC")).toISOString(); });
  const nameOf = new Map(accounts.map((a) => [a.location_id as string, (a.name as string | null) ?? "Client"]));
  const blocked = new Set(accounts.filter((a) => a.speed_access === "needs_permission").map((a) => a.location_id as string));

  try {
    const rows = await sql()`
      select c.location_id, c.contact_id, c.full_name, c.email, c.date_added,
        t.n as touch_rows, t.replied, t.excluded,
        a.booked, a.showed, a.noshow, o.won
      from cached_contacts c
      join unnest(${ids}::text[], ${starts}::timestamptz[], ${ends}::timestamptz[]) as r(loc, f, e) on r.loc = c.location_id
      left join lateral (
        select count(*) as n, bool_or(human_touch_at is not null) as replied, bool_or(excluded is not null) as excluded
        from lead_touches x where x.installation_id = c.installation_id and x.location_id = c.location_id and x.contact_id = c.contact_id) t on true
      left join lateral (
        select count(*) filter (where status not in ('cancelled', 'invalid')) as booked, count(*) filter (where status = 'showed') as showed, count(*) filter (where status = 'noshow') as noshow
        from cached_appointments y where y.installation_id = c.installation_id and y.location_id = c.location_id and y.contact_id = c.contact_id) a on true
      left join lateral (
        select bool_or(status = 'won') as won from cached_opportunities z where z.installation_id = c.installation_id and z.location_id = c.location_id and z.contact_id = c.contact_id) o on true
      where c.installation_id = ${ctx.installationId} and c.date_added >= r.f and c.date_added < r.e
      order by c.date_added desc limit ${ROW_CAP + 1}`;
    const partial = rows.length > ROW_CAP;
    const now = Date.now();
    const all: FlowLead[] = [];
    for (const r of rows.slice(0, ROW_CAP)) {
      if (r.excluded === true) continue; // a record the lead rules set aside (not a real lead)
      const loc = r.location_id as string;
      const at = (r.date_added as Date).getTime();
      // Checked: SubSync has read the lead's conversation, or the lead is recent enough that no conversation means nobody wrote. Older with no check: not known.
      const reply: Reply = blocked.has(loc) ? "unknown" : Number(r.touch_rows) > 0 ? (r.replied === true ? "replied" : "never") : at >= now - CHECKED_DAYS * DAY ? "never" : "unknown";
      const booked = Number(r.booked) > 0;
      const outcome: Outcome | null = !booked ? null : Number(r.showed) > 0 ? "showed" : Number(r.noshow) > 0 ? "noshow" : "waiting";
      all.push({ id: `${loc}:${r.contact_id as string}`, locationId: loc, accountName: nameOf.get(loc) ?? "Client", name: ((r.full_name as string | null) || (r.email as string | null) || "Unnamed").trim(), at, reply, booked, outcome, won: r.won === true, url: contactUrl(loc, r.contact_id as string) || accountUrl(loc) });
    }
    return json({ from, to, accounts: accounts.length, flow: buildFlow(all), leads: all.slice(0, SEND_CAP), sent: Math.min(all.length, SEND_CAP), partial, needsUpdate: false });
  } catch (e) {
    // A database that has not had its latest update (missing table or column) answers plainly, never with an error page.
    if (isMissingTable(e)) return json({ ...empty(from, to, accounts.length), needsUpdate: true });
    throw e;
  }
}

function empty(from: string, to: string, accounts: number) {
  return { from, to, accounts, flow: buildFlow([]), leads: [] as FlowLead[], sent: 0, partial: false, needsUpdate: false };
}
