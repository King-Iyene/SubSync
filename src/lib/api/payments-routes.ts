import { addNote, createDispute, diffDispute, getDispute, planResend, readDispute, removeDispute, resendInvoice, updateDispute } from "../analytics/payments-actions";
import { disputes, exportCsv, forgetPayments, history, item, options, paymentsCache, queue, setup, today, upcoming, type Filters, type Links, type Scope } from "../analytics/payments-queries";
import { PM_FLAGS, PM_PARTS, type PmPart } from "../analytics/payments-types";
import type { Feature } from "../entitlements";
import { resolveEntitlements } from "../flags";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import { ownedLocation } from "./tenant-guard";

// Payments. GET /api/app/payments?part=today|queue|item|disputes|upcoming|history|options|setup|export (read only) and POST /api/app/payments/act/<note|dispute|dispute-edit|dispute-remove|resend>.
// Who is asking and which client accounts they may read come from the verified session (`ctx`, `h.allowed`), never from the request. Every account id in the address or body goes through
// ownedLocation and only NARROWS inside `allowed`; a foreign id is answered like nothing there and never echoed. Agency staff and an account administrator see Payments; an account's own
// team members (setters) and a client's read-only staff see nothing. Nothing here messages anyone, except `resend`, which is off (flag pm_resend) and goes through the live switch with a preview.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type PaymentsHelpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>>; brand: () => Promise<string | null>; locationToken: (locationId: string) => Promise<string> };

const PART_FLAG: Record<PmPart, string> = { today: "pm_module", queue: "pm_recovery", item: "pm_recovery", disputes: "pm_disputes", upcoming: "pm_upcoming", history: "pm_recovery", options: "pm_module", setup: "pm_module", export: "pm_recovery" };
const int = (v: string | null, d: number) => { const x = Number(v); return v !== null && Number.isFinite(x) ? Math.floor(x) : d; };
const numOrNull = (v: string | null) => { if (v === null || v.trim() === "") return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const text = (v: string | null, max: number) => (v ?? "").trim().slice(0, max) || null;
const actorOf = (ctx: Ctx) => ({ userId: ctx.session.userId ?? null, name: ctx.session.userName ?? null });
const canSeeOf = (ctx: Ctx) => ctx.kind === "agency" || (ctx.kind === "business" && ctx.session.personRole === "account_admin");
const KIND = new Set(["transaction", "invoice", "subscription", "plan"]);

const emptyWrap = (flags: Record<string, boolean>, canSee: boolean, problem: string | null, extra: object = {}) => json({ rows: [], total: 0, next: null, totals: [], tiles: [], accounts: [], currencies: [], sources: [], ...extra, generatedAt: new Date().toISOString(), flags, canSee, problem });

export async function handlePayments(ctx: Ctx, h: PaymentsHelpers): Promise<Response> {
  const ent = await resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo);
  const flags = Object.fromEntries(PM_FLAGS.map((f) => [f, ent.features[f as Feature] === true && !ent.locked.includes(f as Feature)]));
  if (!flags.pm_module) return json({ error: "Payments is not switched on yet." }, 404);
  if (ctx.segments[1] === "act") return handleAct(ctx, h, flags);
  const sp = ctx.url.searchParams, part = sp.get("part") as PmPart | null;
  if (!part || !(PM_PARTS as readonly string[]).includes(part)) return json({ error: "Not found" }, 404);
  if (!flags[PART_FLAG[part]]) return json({ error: "This part of Payments is not switched on yet." }, 404);
  const canSee = canSeeOf(ctx);
  if (!canSee) return emptyWrap(flags, false, null);
  const allowed = await h.allowed(), dl = await h.links();
  const asked = sp.get("location");
  const one = asked ? await ownedLocation(ctx.installationId, allowed, asked) : null;
  if (asked && !one) return emptyWrap(flags, true, null);
  const scope: Scope = { inst: ctx.installationId, allowed };
  const links: Links = { account: (l) => dl.account(l), contact: (l, c) => dl.contact(l, c) };
  const f: Filters = { location: one, problem: text(sp.get("problem"), 24), currency: text(sp.get("currency"), 3), age: text(sp.get("age"), 6), min: numOrNull(sp.get("min")), max: numOrNull(sp.get("max")), status: text(sp.get("status"), 12), showTest: sp.get("test") === "1", q: text(sp.get("q"), 60), from: text(sp.get("from"), 10), to: text(sp.get("to"), 10), wfrom: text(sp.get("wfrom"), 10), wto: text(sp.get("wto"), 10) };
  const size = Math.max(5, Math.min(100, int(sp.get("size"), 25)));
  const key = JSON.stringify([ctx.installationId, allowed, part, sp.toString()]);
  const hit = part === "export" ? undefined : paymentsCache.get(key);
  const wrap = (body: object, cached = false) => json({ ...body, generatedAt: new Date().toISOString(), cached, flags, canSee: true, problem: null });
  if (hit) return wrap(hit, true);
  const done = (body: object) => { paymentsCache.set(key, body); return wrap(body); };
  switch (part) {
    case "today": return done(await today(scope, f));
    case "queue": return done(await queue(scope, f, text(sp.get("cursor"), 400), size, links));
    case "item": {
      const loc = await ownedLocation(ctx.installationId, allowed, sp.get("loc"));
      const kind = sp.get("kind") ?? "", id = sp.get("id") ?? "";
      if (!loc || !KIND.has(kind)) return json({ error: "That is not available" }, 404);
      const r = await item(scope, loc, kind, id, links, await h.brand(), flags.pm_resend === true);
      return r ? wrap(r) : json({ error: "That is not available" }, 404);
    }
    case "disputes": return done(await disputes(scope, { location: one, status: text(sp.get("status"), 14), wfrom: f.wfrom, wto: f.wto }));
    case "upcoming": return done(await upcoming(scope, f));
    case "history": return done(await history(scope, f));
    case "options": return done(await options(scope, flags));
    case "setup": return done(await setup(scope));
    case "export": {
      const csv = await exportCsv(scope, f, links);
      return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="payments.csv"', "cache-control": "no-store" } });
    }
  }
  return json({ error: "Not found" }, 404);
}

async function readBody(ctx: Ctx): Promise<Record<string, unknown> | null> {
  const b = await ctx.request.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}
const gone = () => json({ error: "That is not available" }, 404);
const bad = (error: string) => json({ error }, 400);

async function handleAct(ctx: Ctx, h: PaymentsHelpers, flags: Record<string, boolean>): Promise<Response> {
  if (ctx.request.method !== "POST") return json({ error: "Unknown action" }, 404);
  if (!canSeeOf(ctx)) return json({ error: "Ask your administrator to do this." }, 403);
  const part = ctx.segments[2], body = await readBody(ctx);
  if (!body) return bad("Send the details as JSON.");
  const allowed = await h.allowed(), inst = ctx.installationId, actor = actorOf(ctx);
  const done = (res: object) => { forgetPayments(inst); return json(res); };

  if (part === "note") {
    if (!flags.pm_recovery) return json({ error: "This is not switched on for your account" }, 404);
    const loc = await ownedLocation(inst, allowed, body.location);
    const kind = typeof body.kind === "string" ? body.kind : "", id = typeof body.id === "string" ? body.id : "", action = body.action;
    if (!loc || !KIND.has(kind) || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return gone();
    if (action !== "contacted" && action !== "snooze" && action !== "dismiss" && action !== "note") return bad("Choose what to do.");
    const r = await addNote(inst, loc, kind, id, { action, reason: typeof body.reason === "string" ? body.reason : null, note: typeof body.note === "string" ? body.note : null, days: typeof body.days === "number" ? body.days : undefined }, actor);
    return r.ok ? done({ ok: true }) : bad(r.error ?? "Could not save.");
  }

  if (part === "dispute" || part === "dispute-edit" || part === "dispute-remove") {
    if (!flags.pm_disputes) return json({ error: "This is not switched on for your account" }, 404);
    const step = body.step === "do" ? "do" : "preview";
    if (part === "dispute") {
      const loc = await ownedLocation(inst, allowed, body.location);
      if (!loc) return gone();
      const v = readDispute(body);
      if ("error" in v) return bad(v.error);
      if (step === "preview") return json({ step: "preview", lines: [{ field: "Customer", after: v.value.customer }, { field: "Evidence due", after: v.value.evidenceDueOn ?? "not set" }, { field: "Status", after: v.value.status }], note: "Saved only in SubSync. Nothing is sent to your payment processor." });
      return done({ ok: true, id: await createDispute(inst, loc, v.value, actor) });
    }
    const cur = await getDispute(inst, allowed, typeof body.id === "string" ? body.id : "");
    if (!cur) return gone();
    if (part === "dispute-edit") {
      const v = readDispute({ ...cur, ...body });
      if ("error" in v) return bad(v.error);
      const lines = diffDispute(cur, v.value);
      if (step === "preview") return json({ step: "preview", lines, note: lines.length ? "Nothing is saved until you confirm." : "Nothing changed." });
      if (!lines.length) return done({ ok: true });
      await updateDispute(inst, cur.id, v.value, actor);
      return done({ ok: true });
    }
    // remove: the customer's name must be typed back exactly
    if (step === "preview") return json({ step: "preview", lines: [{ field: "Customer", after: cur.customer }], confirmWith: cur.customer, note: "This removes the dispute from your log. It cannot be undone." });
    if (typeof body.confirm !== "string" || body.confirm.trim() !== cur.customer) return bad(`Type ${cur.customer} exactly to confirm.`);
    await removeDispute(inst, cur.id, actor);
    return done({ ok: true });
  }

  if (part === "resend") {
    // Messages a customer. Off until King approves it (a message to a customer needs a person to press Send).
    if (!flags.pm_resend) return json({ error: "This is not switched on for your account" }, 404);
    const loc = await ownedLocation(inst, allowed, body.location);
    const id = typeof body.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(body.id) ? body.id : null;
    if (!loc || !id) return gone();
    const plan = await planResend(inst, loc, id);
    if (!plan.ok) return bad(plan.error);
    if (body.step !== "do") return json({ step: "preview", lines: [{ field: "Sends to", after: plan.recipient }, { field: "By", after: "email" }, { field: "Invoice", after: id }], confirmWith: "SEND", note: "This messages your client's customer." });
    if (body.confirm !== "SEND") return bad("Type SEND to confirm.");
    const r = await resendInvoice(inst, loc, id, await h.locationToken(loc), actor);
    return r.ok ? done({ ok: true, dryRun: r.dryRun === true }) : bad(r.error ?? "Could not send.");
  }
  return json({ error: "Unknown action" }, 404);
}
