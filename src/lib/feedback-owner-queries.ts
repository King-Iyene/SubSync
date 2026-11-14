// The database side of the owner's Feedback inbox and owner alerts. Everything here is for the platform owner only: the routes that call it (src/lib/api/owner-feedback.ts)
// answer 404 to anyone else before any of this runs. It reads across companies on purpose (companies appear as short ids and, when known, a short name), and it never
// reads a contact. What people typed is returned as plain text; the screen shows it as text and never as markup.
import { sql } from "./db";
import { referenceOf, voteDigest } from "./feedback.ts";
import { INSTANT_LEVELS, isTriageStatus, type DigestRow, type InstantLevel, type AlertState, type TriageStatus } from "./feedback-alert.ts";
import type { OwnerSettings } from "./notifications/feedback-alert-send.ts";

export async function ownerSettings(): Promise<OwnerSettings> {
  const [r] = await sql()`select digest_on, instant_level from feedback_owner_settings where id = 'owner'`;
  const level = r?.instant_level as string | undefined;
  return { digestOn: typeof r?.digest_on === "boolean" ? (r.digest_on as boolean) : null, instantLevel: (INSTANT_LEVELS as readonly string[]).includes(level ?? "") ? (level as InstantLevel) : "stuck" };
}

export async function saveOwnerSettings(input: { digestOn?: boolean; instantLevel?: InstantLevel }, by: string | null): Promise<OwnerSettings> {
  const cur = await ownerSettings();
  const digest = input.digestOn ?? cur.digestOn;
  const level = input.instantLevel ?? cur.instantLevel;
  await sql()`insert into feedback_owner_settings (id, digest_on, instant_level, changed_by, changed_at) values ('owner', ${digest}, ${level}, ${by}, now())
    on conflict (id) do update set digest_on = excluded.digest_on, instant_level = excluded.instant_level, changed_by = excluded.changed_by, changed_at = now()`;
  return ownerSettings();
}

export async function alertState(key: string): Promise<AlertState> {
  const [r] = await sql()`select last_alert_at, suppressed, last_ref from feedback_alert_state where key = ${key}`;
  return { lastAlertAt: (r?.last_alert_at as Date | null) ?? null, suppressed: (r?.suppressed as number | undefined) ?? 0, lastRef: (r?.last_ref as string | null) ?? null };
}

export async function saveAlertState(key: string, s: { lastAlertAt: Date | null; suppressed: number; lastRef: string | null; detail: Record<string, unknown> | null }): Promise<void> {
  const db = sql();
  await db`insert into feedback_alert_state (key, last_alert_at, suppressed, last_ref, detail, updated_at) values (${key}, ${s.lastAlertAt}, ${s.suppressed}, ${s.lastRef}, ${s.detail ? db.json(s.detail as never) : null}, now())
    on conflict (key) do update set last_alert_at = excluded.last_alert_at, suppressed = excluded.suppressed, last_ref = excluded.last_ref,
      detail = coalesce(excluded.detail, feedback_alert_state.detail), updated_at = now()`;
}

export async function lastAlertRecords(): Promise<Array<{ key: string; at: string | null; held: number; detail: unknown }>> {
  const rows = await sql()`select key, last_alert_at, suppressed, detail from feedback_alert_state order by key`;
  return rows.map((r) => ({ key: r.key as string, at: r.last_alert_at ? (r.last_alert_at as Date).toISOString() : null, held: r.suppressed as number, detail: r.detail ?? null }));
}

/** Items created since a moment, for the daily summary. */
export async function digestRows(since: Date): Promise<DigestRow[]> {
  const rows = await sql()`
    select id, 'feedback' item_kind, kind, coalesce(severity, 'blocking') severity, message title, created_at from feedback_items where created_at > ${since}
    union all select id, 'suggestion', 'suggestion', 'idea', title, created_at from roadmap_suggestions where created_at > ${since}
    order by created_at desc limit 500`;
  return rows.map((r) => ({ ref: referenceOf(r.id as string), kind: r.kind as string, severity: r.severity as string, title: r.title as string, at: (r.created_at as Date).toISOString() }));
}

export type InboxFilters = { kind: string | null; severity: string | null; status: string | null; q: string | null; page: number };
export const INBOX_PAGE = 25;
const KINDS = ["feedback", "problem", "suggestion"];
const SEVERITY = ["idea", "annoying", "blocking"];

export function parseInboxFilters(url: URL): InboxFilters {
  const p = url.searchParams;
  const pick = (k: string, ok: readonly string[]) => { const v = p.get(k); return v && ok.includes(v) ? v : null; };
  const q = (p.get("q") ?? "").trim().slice(0, 80);
  const page = Math.max(0, Math.min(10_000, Number.parseInt(p.get("page") ?? "0", 10) || 0));
  return { kind: pick("kind", KINDS), severity: pick("severity", SEVERITY), status: pick("status", ["new", "seen", "planned", "done", "wontfix"]), q: q || null, page };
}

const likeOf = (q: string | null): string | null => (q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null);

export type InboxItem = { itemKind: "feedback" | "suggestion"; id: string; ref: string; kind: string; severity: string; company: string; companyName: string | null; page: string | null; status: TriageStatus; message: string; errorId: string | null; at: string };

const ITEMS = () => sql()`
  select 'feedback'::text item_kind, f.id, f.installation_id, f.kind, coalesce(f.severity, 'blocking')::text severity, f.page, f.message::text body, f.created_at, f.status::text base_status, f.error_id::text error_id from feedback_items f
  union all
  select 'suggestion'::text, s.id, s.installation_id, 'suggestion'::text, 'idea'::text, s.page, (s.title || coalesce(E'\n' || s.details, ''))::text, s.created_at,
    (case s.status when 'building' then 'planned' when 'shipped' then 'done' when 'declined' then 'wontfix' else s.status end)::text, null::text from roadmap_suggestions s`;

export async function inbox(f: InboxFilters): Promise<{ items: InboxItem[]; total: number; newCount: number; hasMore: boolean }> {
  const db = sql();
  const like = likeOf(f.q);
  const where = db`(${f.kind}::text is null or i.kind = ${f.kind}::text) and (${f.severity}::text is null or i.severity = ${f.severity}::text)
    and (${f.status}::text is null or coalesce(t.status, i.base_status) = ${f.status}::text) and (${like}::text is null or i.body ilike ${like}::text escape '\\' or i.page ilike ${like}::text escape '\\')`;
  const rows = await db`
    with items as (${ITEMS()})
    select i.item_kind, i.id, i.installation_id, i.kind, i.severity, i.page, i.body, i.created_at, i.error_id, coalesce(t.status, i.base_status) status, inst.company_name
    from items i left join feedback_triage t on t.item_kind = i.item_kind and t.item_id = i.id left join installations inst on inst.id = i.installation_id
    where ${where} order by i.created_at desc limit ${INBOX_PAGE + 1} offset ${f.page * INBOX_PAGE}`;
  const [c] = await db`
    with items as (${ITEMS()})
    select count(*) filter (where ${where})::int total, count(*) filter (where coalesce(t.status, i.base_status) = 'new')::int new_count
    from items i left join feedback_triage t on t.item_kind = i.item_kind and t.item_id = i.id`;
  const items = rows.slice(0, INBOX_PAGE).map((r) => ({
    itemKind: r.item_kind as "feedback" | "suggestion", id: r.id as string, ref: referenceOf(r.id as string), kind: r.kind as string, severity: r.severity as string,
    company: (r.installation_id as string).slice(0, 8), companyName: typeof r.company_name === "string" ? r.company_name.slice(0, 40) : null, page: r.page as string | null,
    status: (isTriageStatus(r.status) ? r.status : "new") as TriageStatus, message: r.body as string, errorId: r.error_id as string | null, at: (r.created_at as Date).toISOString(),
  }));
  return { items, total: (c?.total as number) ?? 0, newCount: (c?.new_count as number) ?? 0, hasMore: rows.length > INBOX_PAGE };
}

/** The number on the menu item. */
export async function newCount(): Promise<number> {
  const [c] = await sql()`
    with items as (${ITEMS()})
    select count(*) filter (where coalesce(t.status, i.base_status) = 'new')::int n from items i left join feedback_triage t on t.item_kind = i.item_kind and t.item_id = i.id`;
  return (c?.n as number) ?? 0;
}

export async function voteCounts(): Promise<Array<{ itemKey: string; votes: number; companies: number }>> {
  const votes = await sql()`select item_key, installation_id, voter from roadmap_votes`;
  return voteDigest(votes.map((v) => ({ itemKey: v.item_key as string, installationId: v.installation_id as string, kind: String(v.voter).split(":")[0] }))).slice(0, 20).map((v) => ({ itemKey: v.itemKey, votes: v.votes, companies: v.companies }));
}

/** Change one item's status and write the audit line (against the company that sent the item). Returns false when the item does not exist. */
export async function setStatus(itemKind: "feedback" | "suggestion", id: string, status: TriageStatus, by: string | null): Promise<boolean> {
  const db = sql();
  const [row] = itemKind === "feedback"
    ? await db`select installation_id, status from feedback_items where id = ${id}`
    : await db`select installation_id, status from roadmap_suggestions where id = ${id}`;
  if (!row) return false;
  const [cur] = await db`select status from feedback_triage where item_kind = ${itemKind} and item_id = ${id}`;
  const from = (cur?.status as string | undefined) ?? (row.status as string);
  await db`insert into feedback_triage (item_kind, item_id, status, changed_by, changed_at) values (${itemKind}, ${id}, ${status}, ${by}, now())
    on conflict (item_kind, item_id) do update set status = excluded.status, changed_by = excluded.changed_by, changed_at = now()`;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${row.installation_id as string}, ${by}, 'feedback.status_changed', ${db.json({ ref: referenceOf(id), kind: itemKind, from, to: status } as never)})`;
  return true;
}
