import { sql } from "../db";
import { safeError } from "../safe-log";
import { businessKey } from "../access";
import { featureOn } from "../flags";
import { markDataChanged } from "../sync/data-version";
import { getInstallation } from "./installations";
import { canonicalType, parseWebhook, type WebhookEvent } from "./webhook";
import { companyOfLocation, handleWebhook, markOutcome } from "./webhook-process";

// The worker that drains webhook_inbox (written by the webhook route in one statement). It calls the same handleWebhook() the route used to call in the request, so results are
// identical. Safe to run twice at once (rows are claimed with FOR UPDATE SKIP LOCKED), safe to be killed at any moment (a claim that is not finished expires after CLAIM_MINUTES
// and the row is taken again; every handler is idempotent), and it never loses a row (a row that keeps failing is marked failed after MAX_ATTEMPTS, never deleted unhandled).

export const MAX_ATTEMPTS = 6;
export const CLAIM_MINUTES = 2;
const KEEP_DAYS = 3;

type Row = { id: string; webhook_id: string; event_type: string | null; body: unknown; attempts: number };
export type DrainResult = { claimed: number; handled: number; setBased: number; failed: number; gaveUp: number; released: number; pending: number };

type Body = Record<string, unknown>;
const rec = (v: unknown): Body => (v && typeof v === "object" ? (v as Body) : {});
const text = (...v: unknown[]) => { for (const x of v) if (typeof x === "string" && x) return x; return null; };

/** The id a delete event names. Same fields the one-at-a-time handler reads (live/webhook-apply.ts). */
export function deleteIdOf(type: string | null, body: unknown): string | null {
  const root = rec(body), data = rec(root.data);
  if (type === "ContactDelete") return text(root.id, root.contactId, data.id, data.contactId);
  if (type === "OpportunityDelete") return text(root.id, data.id);
  return null;
}

function bodyOf(row: Row): unknown {
  if (typeof row.body === "string") { try { return JSON.parse(row.body); } catch { return null; } }
  return row.body;
}

async function finish(ids: string[], outcome: string): Promise<void> {
  if (!ids.length) return;
  // The payload (names, emails, phones) is dropped as soon as the event is handled.
  await sql()`update webhook_inbox set processed_at = now(), outcome = ${outcome.slice(0, 120)}, body = null where id = any(${ids}::bigint[])`;
}

/** Take up to `limit` rows nobody else holds. A row whose earlier claim expired (a worker died) is taken again. */
async function claim(limit: number): Promise<Row[]> {
  const rows = await sql()`
    update webhook_inbox set claimed_at = now(), attempts = attempts + 1
    where id in (
      select id from webhook_inbox
      where processed_at is null and attempts < ${MAX_ATTEMPTS} and (claimed_at is null or claimed_at < now() - make_interval(mins => ${CLAIM_MINUTES}::int))
      order by id limit ${limit} for update skip locked)
    returning id::text as id, webhook_id, event_type, body, attempts`;
  return (rows as unknown as Row[]).sort((a, b) => Number(a.id) - Number(b.id));
}

/** Rows that used up every attempt (a worker kept dying on them) are closed as failed so they stop looking pending. */
async function giveUp(): Promise<number> {
  const done = await sql()`
    update webhook_inbox set processed_at = now(), outcome = 'failed: gave up after repeated attempts'
    where processed_at is null and attempts >= ${MAX_ATTEMPTS} and claimed_at < now() - make_interval(mins => ${CLAIM_MINUTES}::int) returning webhook_id`;
  for (const r of done) await markOutcome(r.webhook_id as string, "failed: gave up after repeated attempts");
  return done.length;
}

async function noteSeen(rows: Array<{ webhook_id: string; event_type: string | null }>): Promise<void> {
  if (!rows.length) return;
  await sql()`
    insert into webhook_events (webhook_id, event_type) select * from unnest(${rows.map((r) => r.webhook_id)}::text[], ${rows.map((r) => r.event_type)}::text[])
    on conflict (webhook_id) do nothing`;
}

type Target = { id: string; companyId: string };
async function targetsOf(ev: WebhookEvent): Promise<Target[]> {
  const own = ev.locationId ? await getInstallation(businessKey(ev.locationId)) : null;
  const companyId = ev.companyId ?? (ev.locationId ? await companyOfLocation(ev.locationId) : null);
  const installation = companyId ? await getInstallation(companyId) : null;
  return [own, installation].filter((t): t is NonNullable<typeof t> => Boolean(t)).map((t) => ({ id: t.id, companyId: t.companyId }));
}

/** ContactDelete (and OpportunityDelete while deal history is off) for accounts the install owns: one DELETE per account for the whole batch instead of one statement per event. */
async function applyDeletes(rows: Row[], dealHistoryOn: boolean): Promise<{ done: Row[]; rest: Row[] }> {
  const db = sql();
  const rest: Row[] = [];
  const groups = new Map<string, { target: string; loc: string; type: string; ids: Set<string> }>();
  const members = new Map<string, Row[]>();
  const memo = new Map<string, Promise<Target[]>>();
  const ownedMemo = new Map<string, Promise<boolean>>();
  const owned = (t: string, loc: string) => {
    const k = `${t}|${loc}`;
    if (!ownedMemo.has(k)) ownedMemo.set(k, db`select 1 from locations where installation_id = ${t} and location_id = ${loc} and not ignored`.then((r) => r.length > 0));
    return ownedMemo.get(k)!;
  };
  for (const row of rows) {
    const body = bodyOf(row);
    const ev = parseWebhook(body);
    const type = canonicalType(ev.type);
    const id = deleteIdOf(type, body);
    const eligible = (type === "ContactDelete" || (type === "OpportunityDelete" && !dealHistoryOn)) && id && ev.locationId;
    if (!eligible) { rest.push(row); continue; }
    const mk = `${ev.companyId ?? ""}|${ev.locationId}`;
    if (!memo.has(mk)) memo.set(mk, targetsOf(ev));
    const targets = await memo.get(mk)!;
    // Only when every install that covers the account owns it: anything else takes the one-at-a-time path (which also queues the re-read).
    if (!targets.length || !(await Promise.all(targets.map((t) => owned(t.id, ev.locationId!)))).every(Boolean)) { rest.push(row); continue; }
    for (const t of targets) {
      const gk = `${t.id}|${ev.locationId}|${type}`;
      const g = groups.get(gk) ?? { target: t.id, loc: ev.locationId!, type: type!, ids: new Set<string>() };
      g.ids.add(id!);
      groups.set(gk, g);
    }
    members.set(row.id, [row]);
  }
  const done = rows.filter((r) => members.has(r.id));
  if (!done.length) return { done: [], rest };
  await noteSeen(done);
  for (const g of groups.values()) {
    const ids = [...g.ids];
    if (g.type === "ContactDelete") await db`delete from cached_contacts where installation_id = ${g.target} and location_id = ${g.loc} and contact_id = any(${ids}::text[])`;
    else await db`delete from cached_opportunities where installation_id = ${g.target} and location_id = ${g.loc} and opportunity_id = any(${ids}::text[])`;
    await markDataChanged(g.target, g.loc, "live").catch(() => undefined);
  }
  await db`update webhook_events set outcome = 'handled', handled_at = now() where webhook_id = any(${done.map((r) => r.webhook_id)}::text[])`.catch(() => undefined);
  return { done, rest };
}

async function handleRow(row: Row): Promise<"handled" | "failed" | "gaveup"> {
  const body = bodyOf(row);
  try {
    if (!body || typeof body !== "object") { await finish([row.id], "ignored: unreadable body"); return "handled"; }
    const event = parseWebhook(body);
    // The same de-duplication mark the old path wrote, so the support view still lists the event. It does not gate the handling: the inbox row is the de-duplication, and a worker
    // that died after writing the mark must still get to handle the event.
    await noteSeen([{ webhook_id: row.webhook_id, event_type: row.event_type }]);
    await handleWebhook(event, body);
    await finish([row.id], "handled");
    return "handled";
  } catch (error) {
    console.error("Inbox event failed", { type: row.event_type, attempt: row.attempts, message: safeError(error) });
    if (row.attempts >= MAX_ATTEMPTS) {
      await markOutcome(row.webhook_id, "failed: handling error");
      await finish([row.id], "failed: handling error").catch(() => undefined);
      return "gaveup";
    }
    return "failed"; // the claim expires and the row is taken again
  }
}

/** Handle queued events until the time is up. `batch` rows per claim, `concurrency` handled at once. */
export async function drainWebhookInbox(opts: { budgetMs?: number; batch?: number; concurrency?: number } = {}): Promise<DrainResult> {
  const budget = opts.budgetMs ?? 40_000, batch = opts.batch ?? 200, concurrency = Math.max(1, opts.concurrency ?? 4);
  const start = Date.now();
  const out: DrainResult = { claimed: 0, handled: 0, setBased: 0, failed: 0, gaveUp: 0, released: 0, pending: 0 };
  out.gaveUp += await giveUp().catch(() => 0);
  const dealHistoryOn = await featureOn("pl_record").catch(() => false);
  while (Date.now() - start < budget) {
    const rows = await claim(batch);
    if (!rows.length) break;
    out.claimed += rows.length;
    const { done, rest } = await applyDeletes(rows, dealHistoryOn).catch((e) => {
      console.error("Inbox deletes not applied in bulk", safeError(e));
      return { done: [] as Row[], rest: rows };
    });
    if (done.length) { await finish(done.map((r) => r.id), "handled"); out.handled += done.length; out.setBased += done.length; }
    const queue = [...rest];
    const unstarted: Row[] = [];
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (;;) {
        const row = queue.shift();
        if (!row) return;
        if (Date.now() - start >= budget) { unstarted.push(row); continue; }
        const r = await handleRow(row);
        if (r === "handled") out.handled++; else if (r === "gaveup") out.gaveUp++; else out.failed++;
      }
    }));
    if (unstarted.length) {
      // Out of time before these started: give the claim (and the attempt) back so another run takes them at once.
      await sql()`update webhook_inbox set claimed_at = null, attempts = greatest(attempts - 1, 0) where id = any(${unstarted.map((r) => r.id)}::bigint[]) and processed_at is null`;
      out.released += unstarted.length;
      break;
    }
  }
  await sql()`delete from webhook_inbox where processed_at < now() - make_interval(days => ${KEEP_DAYS}::int)`.catch(() => undefined);
  const [p] = await sql()`select count(*)::int n from webhook_inbox where processed_at is null`.catch(() => [{ n: 0 }]);
  out.pending = (p?.n as number) ?? 0;
  return out;
}
