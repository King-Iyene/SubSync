import { boards, decisions, execCache, exportCsv, pace, rows, setTarget, slots, summary, type ExecFilters } from "../analytics/appointments-exec-queries";
import { cleanId, type Scope } from "../analytics/appointments3-queries";
import { parseApptWindow } from "../analytics/appointments3-intel";
import type { Feature } from "../entitlements";
import { resolveEntitlements } from "../flags";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import { ownedLocation } from "./tenant-guard";

// GET /api/app/appointments/exec?part=summary|pace|boards|slots|decisions|rows|export, and PUT /api/app/appointments/exec-target (Appointments, Leadership tab).
// Who is asking comes from the verified session; the accounts that caller may read come from `allowed` (decided by the router from the session, never from the request).
// An account id in the address only NARROWS inside them, and one that is not theirs is the same answer as nothing there (never echoed). A client's staff get no ranking of people or accounts.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type ExecHelpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>> };
const PARTS = ["summary", "pace", "boards", "slots", "decisions", "rows", "export"] as const;
const BUCKETS = new Set(["booked", "completed", "showed", "noshow", "cancelled", "unmarked", "won", "lost", "confirmed", "rescheduled"]);
const BANDS = new Set(["same_day", "d1_2", "d3_7", "d8_plus"]);
const int = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };
const text = (v: string | null, max: number) => (v ?? "").trim().slice(0, max) || null;
const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);
/** "Booked on": both days or neither. The end day is inclusive. */
function bookedRange(a: string | null, b: string | null) {
  const f = day(a), t = day(b);
  return f !== null && t !== null && t >= f && t - f <= 400 * 86_400_000 ? { bookedFrom: new Date(f), bookedTo: new Date(t + 86_400_000) } : {};
}
const personParam = (v: string | null) => (v === "none" ? null : cleanId(v));

export async function handleApptExec(ctx: Ctx, h: ExecHelpers): Promise<Response> {
  const sp = ctx.url.searchParams, part = sp.get("part") as (typeof PARTS)[number] | null;
  if (!part || !PARTS.includes(part)) return json({ error: "Not found" }, 404);
  const [allowedAll, links, ent] = await Promise.all([h.allowed(), h.links(), resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo)]);
  if (ent.features["ap_exec" as Feature] !== true) return json({ error: "This part of Appointments is not switched on yet." }, 404);
  const seePeople = ctx.kind !== "client", canSeeAccounts = ctx.limitTo === null;
  const asked = cleanId(sp.get("location"));
  const one = asked ? await ownedLocation(ctx.installationId, allowedAll, asked) : null;
  if (asked && !one) return json({ generatedAt: new Date().toISOString(), canSeeAccounts, canSeePeople: seePeople, empty: true });
  const scope: Scope = { inst: ctx.installationId, allowed: allowedAll };
  const w = parseApptWindow(sp.get("from"), sp.get("to"), Date.now());
  const f: ExecFilters = {
    from: w.from, to: w.to, basis: sp.get("basis") === "booked" ? "booked" : "appt", location: one, calendar: cleanId(sp.get("calendar")), user: seePeople ? cleanId(sp.get("user")) : null,
    setter: seePeople ? personParam(sp.get("setter")) : null, closer: seePeople ? personParam(sp.get("closer")) : null, source: text(sp.get("source"), 120),
    status: /^[a-z_]{1,20}$/.test(sp.get("status") ?? "") ? sp.get("status") : null, stage: text(sp.get("stage"), 120),
    ...bookedRange(sp.get("bfrom"), sp.get("bto")),
  };
  const key = JSON.stringify([ctx.installationId, allowedAll, part, sp.toString(), ctx.kind]);
  const wrap = (body: object, cached = false) => json({ ...body, generatedAt: new Date().toISOString(), cached, canSeeAccounts, canSeePeople: seePeople, problem: w.problem });
  const hit = execCache.get(key);
  if (hit && part !== "rows" && part !== "export") return wrap(hit as object, true);
  const done = (body: object) => { execCache.set(key, body); return wrap(body); };
  switch (part) {
    case "summary": return done(await summary(scope, f));
    case "pace": return done(await pace(scope, f));
    case "boards": {
      const b = await boards(scope, f);
      return done(seePeople ? (canSeeAccounts ? b : { ...b, accounts: [] }) : { ...b, setters: [], closers: [], accounts: [], movers: { setters: { up: [], down: [] }, closers: { up: [], down: [] } } });
    }
    case "slots": { const s = await slots(scope, f); return done(seePeople ? s : { ...s, capacity: { ...s.capacity, people: [] } }); }
    case "decisions": { const d = await decisions(scope, f); return done(seePeople ? d : { ...d, decisions: d.decisions.filter((x) => x.key !== "coach") }); }
    case "export": return new Response(await exportCsv(scope, f), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="appointments-leadership.csv"', "cache-control": "no-store" } });
    case "rows": {
      const bucket = sp.get("bucket"), band = sp.get("band");
      const size = [20, 50, 100].includes(int(sp.get("size"), 20)) ? int(sp.get("size"), 20) : 20;
      const link = (loc: string, contact: string) => links.contact(loc, contact);
      const dow = sp.has("dow") ? int(sp.get("dow"), -1) : null, hour = sp.has("hour") ? int(sp.get("hour"), -1) : null;
      const page = await rows(scope, f, { bucket: bucket && BUCKETS.has(bucket) ? bucket : "booked", dow, hour, band: band && BANDS.has(band) ? band : null, month: sp.get("month") === "1", page: Math.max(0, int(sp.get("page"), 0)), size, sort: sp.get("sort"), after: sp.get("after") }, link);
      return wrap({ ...page, rows: seePeople ? page.rows : page.rows.map((r) => ({ ...r, ownerId: null, ownerName: null, bookerId: null, bookerName: null })) });
    }
  }
  return json({ error: "Not found" }, 404);
}

/** PUT /api/app/appointments/exec-target { location?: string|null, target: number|null|"undo" }. Changes only SubSync's own number; the change is audited. */
export async function handleApptExecTarget(ctx: Ctx, h: ExecHelpers): Promise<Response> {
  if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
  const ent = await resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo);
  if (ent.features["ap_exec_targets" as Feature] !== true) return json({ error: "Targets are not switched on yet." }, 404);
  if (ctx.demo) return json({ error: "Targets cannot be changed in the demo" }, 400);
  const body = (await ctx.request.json().catch(() => null)) as { location?: unknown; target?: unknown } | null;
  if (!body) return json({ error: "Send a target" }, 400);
  const allowed = await h.allowed();
  let loc: string | null = null;
  if (body.location !== null && body.location !== undefined && body.location !== "") {
    loc = await ownedLocation(ctx.installationId, allowed, body.location);
    if (!loc) return json({ error: "Account not found" }, 404);
  } else if (allowed !== null) return json({ error: "Choose one of your accounts" }, 400);
  const t = body.target;
  const value = t === "undo" ? "undo" : t === null ? null : typeof t === "number" && Number.isInteger(t) && t >= 1 && t <= 100000 ? t : undefined;
  if (value === undefined) return json({ error: "Choose a whole number of bookings a month, between 1 and 100000" }, 400);
  const r = await setTarget({ inst: ctx.installationId, allowed }, loc, value, ctx.session.userId ?? ctx.kind);
  execCache.clear(JSON.stringify([ctx.installationId]).slice(0, -1));
  return json({ ok: true, target: r.target });
}
