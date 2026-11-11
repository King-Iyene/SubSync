import { sql } from "../db";
import { ownedLocation } from "./tenant-guard";
import {
  BULK_CAP, bulkPreviewLine, parseBulk, parseOwner, muteLine, muteUntil, parseMute, parseTargetMinutes, receiptCsv, receiptOf, receiptText, setupItems, MUTE_DAYS, MUTE_KINDS, MUTE_WORDS, type Receipt,
} from "../analytics/clients-actions";
import { ownersOf, setOwner, activeMutes, addMute, currentTarget, lastTargetChange, logTarget, receiptFacts, releaseMute, setupFacts } from "../analytics/clients-actions-queries";
import { setAccountTarget } from "../analytics/speed-v2-queries";
import { newClientsView, retentionView, workflowsView } from "./clients-retention-routes";
import type { Feature } from "../entitlements";
import { json, type AuthContext } from "./auth";

// The Clients ACTIONS and REPORTS endpoints (slice CB), under /api/app/clients/act/<part>. Agency only (the route policy refuses a business owner and a client's staff before this runs).
//   GET  act/receipt[?location=]   the last 7 days per client: new leads, answered in time, appointments, deals; with the words to paste to the client       cl_reports
//   GET  act/csv[?location=]       the same as a CSV file (tenant guarded exactly like the JSON)                                                            cl_reports
//   GET  act/setup                 connection, permissions and freshness per client, with the exact "Needs permission: reconnect" words                    cl_reports
//   GET  act/mutes                 the quiet marks that are on now                                                                                         cl_actions
//   POST act/mute | act/unmute     quiet one kind of attention for one client for 7 to 90 days, and put it back                                            cl_actions
//   POST act/target | target-undo  one client's reply target (minutes), and put the last change back                                                          cl_actions
// Who is asking and which accounts they may read come from the verified session (`h.allowed`), never from the request. A location id in the query or body only REQUESTS an account: it
// is used only after the shared ownedLocation guard says it is inside those accounts, and it is never echoed back. Nothing here writes to the CRM or messages anyone.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type ClientActionHelpers = {
  allowed: () => Promise<string[] | null>; brand: () => Promise<string | null>; defaultTarget: () => Promise<number>;
  /** The permissions this installation granted (null when not known), and the Onboarding tab's own answer (re-narrowed to the accounts this session may read). */
  granted: () => Promise<string[] | null>; onboarding: () => Promise<Response>;
};

const on = (ctx: Ctx, f: Feature) => ctx.entitlements.features[f] === true && !ctx.entitlements.locked.includes(f);
const off = () => json({ error: "This is not switched on for your account" }, 404);
const actorOf = (ctx: Ctx) => ctx.session.userName ?? null;
const NOT_FOUND = () => json({ error: "Client not found" }, 404);
const CAP = 200;

async function readBody(ctx: Ctx): Promise<Record<string, unknown> | null> {
  const b = await ctx.request.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}

/** The accounts this request is about: one (checked) or all the caller may read, capped. A requested id that fails the guard is "not found", never a silent widening. */
async function idsOf(ctx: Ctx, h: ClientActionHelpers, requested: string | null): Promise<string[] | null> {
  const allowed = await h.allowed();
  if (requested !== null) {
    const one = await ownedLocation(ctx.installationId, allowed, requested);
    return one ? [one] : null;
  }
  const db = sql();
  const rows = await db`select location_id from locations where installation_id = ${ctx.installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} order by name limit ${CAP}`;
  return rows.map((r) => r.location_id as string);
}

async function receipts(ctx: Ctx, h: ClientActionHelpers, ids: string[], now: number): Promise<Receipt[]> {
  if (ctx.demo) return [];
  const facts = await receiptFacts(ctx.installationId, ids, await h.defaultTarget(), now);
  return facts.map((f) => receiptOf(f, now)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function handleClientActions(ctx: Ctx, h: ClientActionHelpers): Promise<Response> {
  const part = ctx.segments[2];
  const m = ctx.request.method;
  const reports = on(ctx, "cl_reports"), actions = on(ctx, "cl_actions");
  const now = Date.now();

  if (m === "GET" && (part === "receipt" || part === "csv" || part === "setup")) {
    if (!reports) return off();
    const req = ctx.url.searchParams.get("location");
    const ids = await idsOf(ctx, h, req);
    if (ids === null) return NOT_FOUND();
    if (part === "setup") {
      const rows = ctx.demo ? [] : await setupFacts(ctx.installationId, ids);
      const items = rows.map((r) => ({ locationId: r.locationId, name: r.name, items: setupItems(r, now) }));
      return json({ now, clients: items, needsReconnect: items.filter((i) => i.items.some((x) => x.fix === "reconnect")).length, capped: req === null && ids.length >= CAP });
    }
    const list = await receipts(ctx, h, ids, now);
    if (part === "csv") {
      return new Response(receiptCsv(list), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="subsync-weekly-report.csv"`, "Cache-Control": "no-store" } });
    }
    const brand = await h.brand();
    return json({ now, receipts: list.map((r) => ({ ...r, text: receiptText(r, brand) })), capped: req === null && ids.length >= CAP });
  }

  if (m === "GET" && (part === "risk" || part === "health")) {
    if (!on(ctx, "cl_retention")) return off();
    const ids = await idsOf(ctx, h, null);
    if (ids === null) return NOT_FOUND();
    return await retentionView(ctx, h, ids, part === "health", now);
  }
  if (m === "GET" && part === "workflows") {
    if (!on(ctx, "cl_workflows")) return off();
    const ids = await idsOf(ctx, h, ctx.url.searchParams.get("location"));
    if (ids === null) return NOT_FOUND();
    return await workflowsView(ctx, h, ids, now);
  }
  if (m === "GET" && part === "new-clients") {
    if (!on(ctx, "cl_onboarding")) return off();
    const ids = await idsOf(ctx, h, null);
    if (ids === null) return NOT_FOUND();
    return await newClientsView(ctx, h, ids);
  }

  if (m === "GET" && part === "owners") {
    if (!actions) return off();
    const ids = await idsOf(ctx, h, null);
    if (ids === null) return NOT_FOUND();
    return json(ctx.demo ? { ready: true, owners: {} } : await ownersOf(ctx.installationId, ids));
  }

  if (m === "GET" && part === "mutes") {
    if (!actions) return off();
    const ids = await idsOf(ctx, h, null);
    if (ids === null) return NOT_FOUND();
    const r = ctx.demo ? { ready: true, rows: [] } : await activeMutes(ctx.installationId, ids, now);
    return json({ ready: r.ready, mutes: r.rows, kinds: MUTE_KINDS.map((k) => ({ kind: k, label: MUTE_WORDS[k] })), days: MUTE_DAYS });
  }

  if (m === "POST" && (part === "mute" || part === "unmute" || part === "owner" || part === "bulk" || part === "target" || part === "target-undo")) {
    if (!actions) return off();
    if (ctx.demo) return json({ error: "The sample data cannot be changed." }, 403);
    const body = await readBody(ctx);
    if (!body) return json({ error: "Send a JSON body." }, 400);

    if (part === "unmute") {
      const ids = await idsOf(ctx, h, null);
      const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/.test(body.id) ? body.id : null;
      if (!ids || !id || !(await releaseMute(ctx.installationId, ids, id, actorOf(ctx)))) return NOT_FOUND();
      return json({ ok: true, message: "Back to normal. Nothing was changed in your CRM." });
    }

    if (part === "bulk") return bulk(ctx, h, body, now);

    const [loc] = (await idsOf(ctx, h, typeof body.location === "string" ? body.location : "")) ?? [];
    if (!loc) return NOT_FOUND();

    if (part === "mute") {
      const p = parseMute(body);
      if (!p.ok) return json({ error: p.error }, 400);
      const until = muteUntil(now, p.value.days);
      const r = await addMute(ctx.installationId, loc, p.value.kind, until, actorOf(ctx));
      if (!r.ok) return json({ error: "Quieting a client needs the latest database update, which has not run yet." }, 503);
      return json({ ok: true, id: r.id, until: until.getTime(), message: muteLine(p.value.kind, until.getTime(), now), undo: { part: "unmute", id: r.id } });
    }

    if (part === "owner") {
      const p = parseOwner(body.owner);
      if (!p.ok) return json({ error: p.error }, 400);
      if (!(await setOwner(ctx.installationId, loc, p.name, actorOf(ctx)))) return json({ error: "Saving who looks after a client needs the latest database update, which has not run yet." }, 503);
      return json({ ok: true, owner: p.name, message: p.name ? `${p.name} now looks after this client.` : "Cleared." });
    }

    if (part === "target") {
      const p = parseTargetMinutes(body.minutes);
      if (!p.ok) return json({ error: p.error }, 400);
      const before = await currentTarget(ctx.installationId, loc);
      const r = await setAccountTarget(ctx.installationId, await h.allowed(), loc, p.minutes);
      if (!r.ok) return json({ error: r.error }, r.status);
      await logTarget(ctx.installationId, loc, before, r.minutes, actorOf(ctx));
      return json({ ok: true, minutes: r.minutes, message: r.minutes === null ? "This client now uses your default reply target." : `Reply target for this client is now ${r.minutes} minutes.`, canUndo: true });
    }

    // target-undo: put the last change back (the value it had before).
    const last = await lastTargetChange(ctx.installationId, loc);
    if (!last) return json({ error: "There is no change to put back." }, 404);
    const now0 = await currentTarget(ctx.installationId, loc);
    const r = await setAccountTarget(ctx.installationId, await h.allowed(), loc, last.before);
    if (!r.ok) return json({ error: r.error }, r.status);
    await logTarget(ctx.installationId, loc, now0, r.minutes, actorOf(ctx));
    return json({ ok: true, minutes: r.minutes, message: "Put back." });
  }

  return json({ error: "Unknown action" }, 404);
}

/** Several clients at once: step "preview" says what would change and for how many; step "do" changes them. Every id goes through the same guard; ids that fail it are counted, never named. */
async function bulk(ctx: Ctx, h: ClientActionHelpers, body: Record<string, unknown>, now: number): Promise<Response> {
  const p = parseBulk(body);
  if (!p.ok) return json({ error: p.error }, 400);
  const allowed = await h.allowed();
  const ok: string[] = [];
  for (const id of p.ids) { const one = await ownedLocation(ctx.installationId, allowed, id); if (one) ok.push(one); }
  const skipped = p.ids.length - ok.length;
  if (ok.length === 0) return NOT_FOUND();
  const line = bulkPreviewLine(p.change, ok.length);
  if (p.step === "preview") return json({ step: "preview", count: ok.length, skipped, cap: BULK_CAP, line, undo: p.change.kind === "target" ? "Each client's last change can be put back one by one." : "Reversible." });
  let done = 0, failed = 0;
  for (const id of ok) {
    try {
      if (p.change.kind === "mute") { const until = muteUntil(now, p.change.mute.days); if ((await addMute(ctx.installationId, id, p.change.mute.kind, until, actorOf(ctx))).ok) done++; else failed++; }
      else if (p.change.kind === "owner") { if (await setOwner(ctx.installationId, id, p.change.name, actorOf(ctx))) done++; else failed++; }
      else {
        const before = await currentTarget(ctx.installationId, id);
        const r = await setAccountTarget(ctx.installationId, allowed, id, p.change.minutes);
        if (r.ok) { await logTarget(ctx.installationId, id, before, r.minutes, actorOf(ctx)); done++; } else failed++;
      }
    } catch { failed++; }
  }
  return json({ step: "do", done, failed, skipped, message: `${line} Done for ${done}${failed ? `; ${failed} could not be changed` : ""}.` });
}
