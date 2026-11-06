import { setAccountTarget, speedCompare, speedHome, speedList } from "../analytics/speed-v2-queries";
import { SORTS, STATUS_FILTERS, type LeadSort, type LeadStatusFilter } from "../analytics/speed-v2";
import { speedInsightList, speedInsights } from "../analytics/speed-v3-queries";
import { DAY_NAMES, type Sel } from "../analytics/speed-v3";
import { parseWindow, type Win } from "../analytics/speed-window";
import type { deepLinks } from "../links";
import { parseFilter } from "../analytics/speed-v4-more";
import { isStep, speedCoverage, speedJourney, speedJourneyList, speedProof, speedRace, speedStory } from "../analytics/speed-v4-queries";
import { json, type AuthContext } from "./auth";

// The rebuilt Speed to lead screen's endpoints: GET /api/app/speed?part=home|list|compare and PUT /api/app/speed/target (the one catch-all route, already guarded).
// Who is asking comes from the verified session (`ctx`); the accounts that caller may read come from `allowed` (derived by the router from the session, never from the
// request); an id in the address only NARROWS inside them. A client's staff get no ranking of people and cannot change a target.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };

export type SpeedHelpers = {
  allowed: () => Promise<string[] | null>;
  links: () => Promise<ReturnType<typeof deepLinks>>;
  targetMinutes: () => Promise<number>;
  /** How the numbers are measured, shown on the page. */
  measuring: () => Promise<{ countAutomated: boolean; businessHours: boolean }>;
};

const ID = /^[A-Za-z0-9_-]{3,64}$/;
const int = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };
const DAY = 86_400_000;

/** Sets the white-label link on every lead row (anything that has an account and a contact). */
function withUrls<T>(value: T, link: (locationId: string, contactId: string) => string): T {
  if (Array.isArray(value)) return value.map((v) => withUrls(v, link)) as T;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = withUrls(v, link);
    if (typeof o.locationId === "string" && typeof o.contactId === "string") out.url = link(o.locationId, o.contactId);
    return out as T;
  }
  return value;
}

/** The mark a list was opened from. Only these shapes are accepted; a person or an owner list is for the people who may see people. */
export function parseSel(sp: URLSearchParams, seePeople: boolean): Sel | null {
  const k = sp.get("sel");
  if (k === "all" || k === "after" || k === "open" || k === "fast" || k === "slow" || k === "noOwner") return { kind: k };
  if (k === "week") { const i = int(sp.get("index"), -1); return i >= 0 && i <= 7 ? { kind: "week", index: i } : null; }
  if (k === "cell") { const dow = int(sp.get("dow"), -1), hour = int(sp.get("hour"), -1); return dow >= 0 && dow < DAY_NAMES.length && hour >= 0 && hour < 24 ? { kind: "cell", dow, hour } : null; }
  if (k === "source") { const v = sp.get("source"); return v && v.length <= 120 ? { kind: "source", source: v } : null; }
  if ((k === "person" || k === "owner") && seePeople) { const v = sp.get("user"); return v && ID.test(v) ? { kind: k, userId: v } : null; }
  return null;
}

/** The window of a request: dates are checked on the server. With none given, the last 30 days. */
function windowOf(url: URL, now: number): { ok: true; win: Win } | { ok: false; error: string } {
  const f = url.searchParams.get("from"), t = url.searchParams.get("to");
  if (f === null && t === null) {
    const to = new Date(now).toISOString().slice(0, 10), from = new Date(now - 29 * DAY).toISOString().slice(0, 10);
    return parseWindow(from, to, now);
  }
  return parseWindow(f, t, now);
}

/** Only an account id that is well formed narrows a request, and the query still binds it to the caller's own accounts. */
function narrowed(allowed: string[] | null, id: string | null): string[] | null | "none" {
  if (!id) return allowed;
  if (!ID.test(id)) return "none";
  if (allowed && !allowed.includes(id)) return "none";
  return [id];
}

export async function handleSpeedPart(ctx: Ctx, h: SpeedHelpers): Promise<Response> {
  const sp = ctx.url.searchParams;
  const part = sp.get("part");
  const now = Date.now();
  const [allowedAll, targetMinutes] = await Promise.all([h.allowed(), h.targetMinutes()]);
  const seePeople = ctx.kind !== "client";
  const links = await h.links();

  if (part === "home") {
    const w = windowOf(ctx.url, now);
    if (!w.ok) return json({ error: w.error }, 400);
    const cf = sp.get("cmpFrom"), ct = sp.get("cmpTo");
    const cmp = cf || ct ? parseWindow(cf, ct, now) : null;
    if (cmp && !cmp.ok) return json({ error: "The comparison range is not valid: " + cmp.error }, 400);
    const out = await speedHome({ installationId: ctx.installationId, allowed: allowedAll, targetMinutes, now, win: w.win, cmp: cmp && cmp.ok ? cmp.win : null, seePeople, canChangeTarget: ctx.kind !== "client" });
    const m = await h.measuring();
    return json(withUrls({ ...out, measuring: { targetMinutes, countAutomated: m.countAutomated, businessHours: m.businessHours, canChange: ctx.kind !== "client" }, seePeople }, links.contact));
  }

  if (part === "list") {
    const statusP = sp.get("status") ?? "waiting";
    if (!(STATUS_FILTERS as readonly string[]).includes(statusP)) return json({ error: "Unknown list" }, 400);
    const sortP = sp.get("sort") ?? "wait";
    if (!(SORTS as readonly string[]).includes(sortP)) return json({ error: "Unknown sort" }, 400);
    const status = statusP as LeadStatusFilter;
    let win: Win | null = null;
    if (sp.get("from") !== null || sp.get("to") !== null) {
      const w = windowOf(ctx.url, now);
      if (!w.ok) return json({ error: w.error }, 400);
      win = w.win;
    } else if (status !== "waiting" && status !== "onlyAuto" && sp.get("week") === null) {
      const w = windowOf(ctx.url, now);
      if (!w.ok) return json({ error: w.error }, 400);
      win = w.win;
    }
    const allowed = narrowed(allowedAll, sp.get("account"));
    if (allowed === "none") return json({ total: 0, page: 0, pages: 1, from: 0, to: 0, facets: { all: 0, noOwner: 0, mine: 0, never: 0 }, rows: [], truncated: false });
    const personP = sp.get("person");
    if (personP !== null && !ID.test(personP)) return json({ error: "Unknown person" }, 400);
    const weekP = sp.get("week");
    const week = weekP === null ? null : int(weekP, -1);
    if (week !== null && (week < 0 || week > 7)) return json({ error: "Unknown week" }, 400);
    const ownerP = sp.get("owner");
    const owner = ownerP === "me" || ownerP === "none" ? ownerP : null;
    const out = await speedList({
      installationId: ctx.installationId, allowed, targetMinutes, now, meId: ctx.session.userId ?? null, status, win, person: seePeople ? personP : null, account: null, owner,
      noSource: sp.get("source") === "none", week, q: (sp.get("q") ?? "").slice(0, 80), sort: sortP as LeadSort, page: int(sp.get("page"), 0), size: int(sp.get("size"), 25),
    });
    return json(withUrls(out, links.contact));
  }

  // Stage SPEED4: the race, coverage, the lead journey, the proof report and one lead story. The accounts come from the session; a filter only narrows inside them.
  if (part === "race" || part === "coverage" || part === "journey" || part === "journey-list" || part === "proof" || part === "story") {
    const allowed = narrowed(allowedAll, sp.get("account") ?? sp.get("f_account"));
    if (allowed === "none") return json({ error: "Unknown account" }, 404);
    const input = { installationId: ctx.installationId, allowed: allowed as string[] | null, targetMinutes, now, seePeople, filter: parseFilter(sp) };
    if (part === "race") return json(withUrls(await speedRace(input), links.contact));
    if (part === "coverage") return json(withUrls(await speedCoverage(input), links.contact));
    if (part === "journey") return json(await speedJourney(input));
    if (part === "proof") return json(await speedProof(input));
    if (part === "story") { const l = sp.get("location"), c = sp.get("contact"); return l && c && ID.test(l) && ID.test(c) ? json(await speedStory({ ...input, locationId: l, contactId: c })) : json({ error: "Unknown lead" }, 400); }
    const step = sp.get("step");
    if (!isStep(step)) return json({ error: "Unknown step" }, 400);
    return json(withUrls(await speedJourneyList({ ...input, step, dropped: sp.get("dropped") === "1" }), links.contact));
  }

  if (part === "insights" || part === "insight-list") {
    const input = { installationId: ctx.installationId, allowed: narrowed(allowedAll, sp.get("account")), targetMinutes, now, seePeople, filter: parseFilter(sp) };
    if (input.allowed === "none") return json({ error: "Unknown account" }, 404);
    const base = { ...input, allowed: input.allowed as string[] | null };
    if (part === "insights") return json(await speedInsights(base));
    const sel = parseSel(sp, seePeople);
    if (!sel) return json({ error: "Unknown list" }, 400);
    return json(withUrls(await speedInsightList({ ...base, sel }), links.contact));
  }

  if (part === "compare") {
    const by = sp.get("by") === "person" ? "person" : "account";
    const w = windowOf(ctx.url, now);
    if (!w.ok) return json({ error: w.error }, 400);
    const out = await speedCompare({ installationId: ctx.installationId, allowed: allowedAll, targetMinutes, now, win: w.win, by, q: (sp.get("q") ?? "").slice(0, 80), page: int(sp.get("page"), 0), size: int(sp.get("size"), 25), seePeople });
    return json(out);
  }
  return json({ error: "Unknown part of this screen" }, 400);
}

/** PUT /api/app/speed/target { locationId, minutes | null }: one client account's own reply target. A client's staff cannot (the router refuses them before this). */
export async function handleSpeedTarget(ctx: Ctx, h: SpeedHelpers): Promise<Response> {
  if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
  const body = (await ctx.request.json().catch(() => null)) as { locationId?: unknown; minutes?: unknown } | null;
  if (!body || typeof body.locationId !== "string" || !ID.test(body.locationId)) return json({ error: "Choose a client account." }, 400);
  const r = await setAccountTarget(ctx.installationId, await h.allowed(), body.locationId, body.minutes === undefined ? NaN : body.minutes);
  if (!r.ok) return json({ error: r.error }, r.status);
  return json({ ok: true, minutes: r.minutes });
}
