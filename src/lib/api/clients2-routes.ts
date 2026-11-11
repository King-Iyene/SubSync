import { sql } from "../db";
import { account, addNote, cleanFilters, exportCsv, isNoteKind, list, listViews, noteBody, noteTitle, options, parseDue, parseNoteBody, plans, removeNote, removeView, saveView, setVertical, today, updateNote, viewName } from "../analytics/clients2-queries";
import { forgetClients, type Links, type Scope } from "../analytics/clients3-queries";
import { SORTS, type Cl2Sort } from "../analytics/clients2-core";
import { CL2_FLAGS, CL2_PARTS, type Cl2Part } from "../analytics/clients2-types";
import { isVertical } from "../analytics/moat-core";
import type { Feature } from "../entitlements";
import { resolveEntitlements } from "../flags";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import { ownedLocation } from "./tenant-guard";

// GET  /api/app/clients2?part=list|options|today|plans|account|views|export    (agency staff only; read only)
// POST /api/app/clients2/<op>   op = note-add | note-update | note-delete | tag | view-save | view-delete   (SubSync-only notes, tags and views; nothing is written to the CRM and nobody is messaged)
// Who is asking and which accounts they may read come from the verified session (`allowed`, decided by the router). An account id in the address or the body only REQUESTS an account: it is used
// only after ownedLocation says it is inside those accounts, and it is never echoed back. Free text only filters inside the caller's accounts. A client's or business's staff get an empty answer.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type Clients2Helpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>> };

const PART_FLAG: Record<Cl2Part, string> = { list: "cl2_accounts", options: "cl2_accounts", today: "cl2_accounts", plans: "cl2_plans", account: "cl2_account_page", views: "cl2_accounts", notes: "cl2_notes", export: "cl2_accounts" };
const WRITE_FLAG: Record<string, string> = { "note-add": "cl2_notes", "note-update": "cl2_notes", "note-delete": "cl2_notes", tag: "cl2_bulk", "view-save": "cl2_accounts", "view-delete": "cl2_accounts" };
const STATUS = new Set(["paid", "past_due", "cancelled", "paused", "other", "none", "unknown", "attention"]);
const LEVELS = new Set(["ok", "watch", "act", "unknown"]);
const UUID = /^[0-9a-f-]{36}$/i;
const BULK_CAP = 50;
const txt = (v: string | null, max: number) => (v ?? "").trim().slice(0, max) || null;
const int = (v: string | null, d: number) => { const x = Number(v); return v !== null && Number.isFinite(x) ? Math.floor(x) : d; };

function filterOf(sp: URLSearchParams) {
  const status = sp.get("status"), level = sp.get("level");
  return { q: txt(sp.get("q"), 60), status: status && STATUS.has(status) ? status : null, plan: txt(sp.get("plan"), 80), level: level && LEVELS.has(level) ? level : null, vertical: txt(sp.get("vertical"), 20), manager: txt(sp.get("manager"), 60), quiet: sp.get("quiet") === "true" || sp.get("quiet") === "1" };
}

export async function handleClients2(ctx: Ctx, h: Clients2Helpers): Promise<Response> {
  const write = ctx.request.method !== "GET";
  const [allowedAll, dl, ent] = await Promise.all([h.allowed(), h.links(), resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo)]);
  const flags = Object.fromEntries(CL2_FLAGS.map((f) => [f, ent.features[f as Feature] === true && !ent.locked.includes(f as Feature)]));
  const canSee = ctx.kind === "agency" && ctx.limitTo === null;
  const wrap = (body: object, cached = false) => json({ ...body, generatedAt: new Date().toISOString(), cached, canSeeAccounts: canSee, flags });
  const nothing = () => wrap({ rows: [], total: 0, next: null, size: 20, all: 0, tiles: [], notes: [], views: [] });
  const links: Links = { account: (l) => dl.account(l), contact: (l, c) => dl.contact(l, c) };
  const scope: Scope = { inst: ctx.installationId, allowed: allowedAll };

  if (write) return doWrite(ctx, { allowedAll, flags, canSee, links });

  const part = ctx.url.searchParams.get("part") as Cl2Part | null;
  if (!part || !(CL2_PARTS as readonly string[]).includes(part)) return json({ error: "Not found" }, 404);
  if (!flags[PART_FLAG[part]]) return json({ error: "This part of Clients is not switched on yet." }, 404);
  if (!canSee) return nothing();
  const sp = ctx.url.searchParams;
  const sortRaw = sp.get("sort") ?? "attention";
  const sort: Cl2Sort = (SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as Cl2Sort) : "attention";
  const size = [20, 50, 100].includes(int(sp.get("size"), 20)) ? int(sp.get("size"), 20) : 20;
  const cursor = txt(sp.get("cursor"), 400);

  switch (part) {
    case "list": return wrap(await list(scope, links, filterOf(sp), { sort, cursor, size }));
    case "options": return wrap(await options(scope, links));
    case "today": return wrap(await today(scope, links));
    case "plans": return wrap(await plans(scope, links, { cursor, size }));
    case "views": return wrap({ views: ctx.demo ? [] : await listViews(ctx.installationId, ctx.session.userId ?? ctx.kind) });
    case "export": {
      const csv = await exportCsv(scope, links, filterOf(sp));
      return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="client-accounts.csv"', "cache-control": "no-store" } });
    }
    case "account": {
      const one = await ownedLocation(ctx.installationId, allowedAll, sp.get("id"));
      if (!one) return json({ error: "Client account not found" }, 404);
      const a = await account(scope, links, one, flags.cl2_notes === true);
      return a ? wrap(a) : json({ error: "Client account not found" }, 404);
    }
    case "notes": return json({ error: "Not found" }, 404);
  }
  return json({ error: "Not found" }, 404);
}

async function doWrite(ctx: Ctx, c: { allowedAll: string[] | null; flags: Record<string, boolean>; canSee: boolean; links: Links }): Promise<Response> {
  const op = ctx.segments[1];
  if (ctx.request.method !== "POST" || !op || ctx.segments.length !== 2 || !WRITE_FLAG[op]) return json({ error: "Not found" }, 404);
  if (!c.flags[WRITE_FLAG[op]]) return json({ error: "This is not switched on for your account" }, 404);
  if (!c.canSee) return json({ error: "Only an owner or admin can change this" }, 403);
  if (ctx.demo) return json({ error: "The sample data cannot be changed." }, 403);
  const body = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Send a JSON body." }, 400);
  const inst = ctx.installationId, actor = ctx.session.userName ?? null, owner = ctx.session.userId ?? ctx.kind;
  const notFound = () => json({ error: "Client account not found" }, 404);
  const audit = (action: string, detail: object) => sql()`insert into audit_log (installation_id, actor, action, detail) values (${inst}, ${actor ?? ctx.kind}, ${action}, ${sql().json(detail as never)})`.catch(() => undefined);

  if (op === "view-save") {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
    if (!name) return json({ error: "Give the view a name." }, 400);
    const v = await saveView(inst, owner, name, cleanFilters(body.filters));
    return v ? json({ ok: true, view: v }) : json({ error: "Saving the view did not work." }, 500);
  }
  if (op === "view-delete") {
    const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
    const name = id ? await viewName(inst, owner, id) : null;
    if (!id || !name) return json({ error: "View not found" }, 404);
    if (typeof body.confirm !== "string" || body.confirm.trim().toLowerCase() !== name.toLowerCase()) return json({ error: "Type the name of the view to delete it.", confirmWith: name }, 400);
    return (await removeView(inst, owner, id)) ? json({ ok: true }) : json({ error: "View not found" }, 404);
  }

  if (op === "tag") {
    const raw = Array.isArray(body.locations) ? [...new Set(body.locations.filter((x): x is string => typeof x === "string"))] : [];
    if (raw.length === 0) return json({ error: "Choose at least one client account." }, 400);
    if (raw.length > BULK_CAP) return json({ error: `Choose at most ${BULK_CAP} client accounts at a time.` }, 400);
    const vertical = body.vertical === null || body.vertical === "" ? null : body.vertical;
    if (vertical !== null && !isVertical(vertical)) return json({ error: "Choose one of the listed kinds of business." }, 400);
    const ok: string[] = [];
    for (const id of raw) { const one = await ownedLocation(inst, c.allowedAll, id); if (one) ok.push(one); }
    if (ok.length === 0) return notFound();
    const skipped = raw.length - ok.length;
    const line = vertical === null ? `Clear the kind of business on ${ok.length} client ${ok.length === 1 ? "account" : "accounts"}.` : `Set the kind of business to "${vertical.replace(/_/g, " ")}" on ${ok.length} client ${ok.length === 1 ? "account" : "accounts"}. Nothing is changed in your CRM.`;
    if (body.step !== "do") return json({ step: "preview", count: ok.length, skipped, cap: BULK_CAP, line, undo: "Reversible: set the earlier value again." });
    const done = await setVertical(inst, ok, vertical);
    forgetClients(inst);
    await audit("clients2.tag", { count: done, vertical });
    return json({ step: "do", done, skipped, message: `${line} Done.` });
  }

  // notes: every one is tied to an account that passed the guard.
  const loc = await ownedLocation(inst, c.allowedAll, body.location);
  if (!loc) return notFound();
  if (op === "note-add") {
    const text = parseNoteBody(body.body), due = parseDue(body.dueOn);
    if (!isNoteKind(body.kind) || !text) return json({ error: "Write a note of 1 to 2000 characters." }, 400);
    if (due === undefined) return json({ error: "Use a date like 2026-12-31." }, 400);
    const note = await addNote(inst, loc, { kind: body.kind, body: text, dueOn: due, pinned: body.pinned === true, author: actor });
    forgetClients(inst);
    return note ? json({ ok: true, note }) : json({ error: "Saving the note needs the latest database update, which has not run yet." }, 503);
  }
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  if (!id) return json({ error: "Note not found" }, 404);
  if (op === "note-update") {
    const text = body.body === undefined ? undefined : parseNoteBody(body.body), due = body.dueOn === undefined ? undefined : parseDue(body.dueOn);
    if (text === null || due === undefined && body.dueOn !== undefined) return json({ error: "Check the note text and date." }, 400);
    const note = await updateNote(inst, loc, id, { body: text, pinned: typeof body.pinned === "boolean" ? body.pinned : undefined, done: typeof body.done === "boolean" ? body.done : undefined, dueOn: due });
    return note ? json({ ok: true, note }) : json({ error: "Note not found" }, 404);
  }
  // note-delete: typed confirmation that names the note (its first words).
  const text = await noteBody(inst, loc, id);
  if (text === null) return json({ error: "Note not found" }, 404);
  const title = noteTitle(text);
  if (typeof body.confirm !== "string" || body.confirm.trim().replace(/\s+/g, " ").toLowerCase() !== title.toLowerCase()) return json({ error: "Type the first words of the note to delete it.", confirmWith: title }, 400);
  const gone = await removeNote(inst, loc, id);
  if (gone) await audit("clients2.note_delete", { kind: "note" });
  return gone ? json({ ok: true }) : json({ error: "Note not found" }, 404);
}
