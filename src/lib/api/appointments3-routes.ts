import { apptCache, appointmentList, bookingShare, calendars, cleanId, detail, flowTree, health, needsOutcome, comparePeople, noshowRecovery, options, overview, receipt, sources, type Filters, type Scope } from "../analytics/appointments3-queries";
import { clampSize, DAY, parseApptWindow } from "../analytics/appointments3-intel";
import { APPT3_FLAGS, APPT3_PARTS, type Appt3Bucket, type Appt3Part } from "../analytics/appointments3-types";
import type { Feature } from "../entitlements";
import { resolveEntitlements } from "../flags";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import { ownedLocation } from "./tenant-guard";

// GET /api/app/appointments?part=overview|needs-outcome|noshow-recovery|booking-share|flow-tree|health|sources|calendars|reminders|receipt|list|detail (the one catch-all
// route, already guarded). Read only. Who is asking comes from the verified session; the accounts that caller may read come from `allowed` (decided by the router from
// the session, never from the request): an account id in the address only NARROWS inside them. A client's staff get no ranking of people or accounts.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type Appt3Helpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>> };

const PART_FLAG: Record<Appt3Part, string> = {
  overview: "appt_overview", "needs-outcome": "appt_needs_outcome", "noshow-recovery": "appt_noshow_recovery", "booking-share": "appt_booking_share", "flow-tree": "appt_flow_tree",
  health: "appt_health", sources: "appt_sources", calendars: "appt_calendars", options: "appt_overview", compare: "appt_flow_tree", receipt: "appt_proof", list: "appt_overview", detail: "appt_history",
};
const BUCKETS = new Set(["booked", "unmarked", "showed", "noshow", "cancelled", "invalid", "completed", "won", "lost", "open", "no_deal", "upcoming", "recovered"]);
const int = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };
const text = (v: string | null, max: number) => (v ?? "").trim().slice(0, max) || null;
const personParam = (v: string | null) => (v === "none" ? "none" : cleanId(v));

export async function handleAppointments3(ctx: Ctx, h: Appt3Helpers): Promise<Response> {
  const sp = ctx.url.searchParams, part = sp.get("part") as Appt3Part | null;
  if (!part || !(APPT3_PARTS as readonly string[]).includes(part)) return json({ error: "Not found" }, 404);
  const [allowedAll, links, ent] = await Promise.all([h.allowed(), h.links(), resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo)]);
  const flags = Object.fromEntries(APPT3_FLAGS.map((f) => [f, ent.features[f as Feature] === true]));
  if (!flags[PART_FLAG[part]]) return json({ error: "This part of Appointments is not switched on yet." }, 404);

  const seePeople = ctx.kind !== "client";
  const asked = cleanId(sp.get("location"));
  // An account id only narrows inside what the caller may read: it must belong to the caller's own installation AND be inside `allowed`. One that does not is the same answer as nothing there (never echoed).
  const one = asked ? await ownedLocation(ctx.installationId, allowedAll, asked) : null;
  if (asked && !one) return part === "detail" ? json({ error: "Appointment not found" }, 404) : json(emptyFor(part, flags, ctx.limitTo === null));
  const scope: Scope = { inst: ctx.installationId, allowed: allowedAll };
  const w = parseApptWindow(sp.get("from"), sp.get("to"), Date.now());
  const bucketP = sp.get("bucket");
  const f: Filters = {
    from: w.from, to: w.to, location: one, calendar: cleanId(sp.get("calendar")), user: seePeople ? cleanId(sp.get("user")) : null, source: text(sp.get("source"), 120), q: text(sp.get("q"), 60),
    bucket: bucketP && BUCKETS.has(bucketP) ? (bucketP as Appt3Bucket) : null,
    setter: seePeople && sp.has("setter") ? personParam(sp.get("setter")) : undefined, closer: seePeople && sp.has("closer") ? personParam(sp.get("closer")) : undefined,
  };
  const p = Math.max(0, int(sp.get("page"), 0)), size = clampSize(int(sp.get("size"), 20));
  const link = (loc: string, contact: string) => links.contact(loc, contact);
  const key = JSON.stringify([ctx.installationId, allowedAll, part, sp.toString(), ctx.kind]);
  const wrap = (body: object, cached = false) => json({ ...body, generatedAt: new Date().toISOString(), cached, canSeeAccounts: ctx.limitTo === null, flags, problem: w.problem });
  const hit = apptCache.get(key);
  if (hit && part !== "detail") return wrap(hit as object, true);
  const done = (body: object) => { apptCache.set(key, body); return wrap(body); };

  switch (part) {
    case "overview": return done(await overview(scope, f, w.days));
    case "needs-outcome": return done(await needsOutcome(scope, { f, page: p, size, sort: sp.get("sort") }, link));
    case "noshow-recovery": return done(await noshowRecovery(scope, { f, page: p, size, sort: sp.get("sort") }, link));
    case "list": return done(await appointmentList(scope, { f, page: p, size, sort: sp.get("sort") }, link));
    case "booking-share":
      return seePeople ? done(await bookingShare(scope, f, p, size, sp.get("sort"))) : wrap({ rows: [], total: 0, page: 0, size, pages: 1, truncated: false, unassigned: 0, ownerless: 0, fairness: { enough: false, maxSharePct: null, evenSharePct: null, closers: 0 } });
    case "flow-tree": {
      if (!seePeople) return wrap({ nodes: [], period: { from: w.from.toISOString(), to: w.to.toISOString() }, totalBooked: 0, topN: 0, hiddenPeople: 0, leak: null });
      const c = (sp.get("compare") ?? "").split(",").map(cleanId);
      return done(await flowTree(scope, f, int(sp.get("top"), 12), c.length === 2 && c[0] && c[1] ? [c[0], c[1]] : null, Math.max(0, int(sp.get("skip"), 0))));
    }
    case "health":
      return seePeople && ctx.limitTo === null ? done(await health(scope, f, p, size)) : wrap({ rows: [], total: 0, page: 0, size, pages: 1, truncated: false, verticals: [] });
    case "sources": return done(await sources(scope, f));
    case "calendars": return done(await calendars(scope, f, p, size, link));
    case "compare": { if (!seePeople) return wrap({ sides: [] }); const ids = (sp.get("ids") ?? "").split(",").map(cleanId).filter((x): x is string => !!x); return done(await comparePeople(scope, f, ids, sp.get("by") === "owner" ? "owner" : "booker")); }
    case "options": { const o = await options(scope, f); return done(seePeople ? o : { ...o, people: [] }); }
    case "receipt": {
      const wk = sp.get("week") ?? "";
      const t = Date.now() - 7 * DAY;
      const monday = Math.floor(t / DAY) * DAY - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
      return done(await receipt(scope, one, /^\d{4}-\d{2}-\d{2}$/.test(wk) && Number.isFinite(Date.parse(wk)) ? new Date(Date.parse(wk)) : new Date(monday)));
    }
    case "detail": {
      const d = await detail(scope, one ?? "", sp.get("id") ?? "", link);
      if (!d) return json({ error: "Appointment not found" }, 404);
      return wrap(d);
    }
  }
  return json({ error: "Not found" }, 404);
}

function emptyFor(part: Appt3Part, flags: Record<string, boolean>, canSee: boolean) {
  const base = { generatedAt: new Date().toISOString(), cached: false, canSeeAccounts: canSee, flags };
  return part === "overview" ? { ...base, headline: "No appointments in this period yet.", button: null, booked: 0, unmarked: 0, journey: [], cards: [], trend: [] } : { ...base, rows: [], total: 0, page: 0, size: 20, pages: 1, truncated: false };
}
