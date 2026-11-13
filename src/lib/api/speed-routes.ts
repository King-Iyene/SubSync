import { addDays, localDay } from "../design/zone";
import { atOf } from "../analytics/window-time";
import { setAccountTarget, speedCompare, speedHome, speedList } from "../analytics/speed-v2-queries";
import { SORTS, STATUS_FILTERS, type LeadSort, type LeadStatusFilter } from "../analytics/speed-v2";
import { speedInsightList, speedInsights } from "../analytics/speed-v3-queries";
import { DAY_NAMES, type Sel } from "../analytics/speed-v3";
import { parseWindow, type Win } from "../analytics/speed-window";
import type { deepLinks } from "../links";
import { parseFilter } from "../analytics/speed-v4-more";
import { isStep, speedCoverage, speedJourney, speedJourneyList, speedProof, speedRace, speedStory } from "../analytics/speed-v4-queries";
import { ladderLeads, ladderPreview, saveLadder, speedBooking } from "../analytics/speed5-queries";
import { speedPulse } from "../analytics/speed6-queries";
import { zoneLabel } from "../analytics/speed6";
import { buildMessage, destination, sanitizeDigest } from "../analytics/speed-digest";
import { deliver, digestNumbers, loadDigest, saveDigest } from "../analytics/speed-digest-db";
import { ignoredPage, ignoredReport } from "../analytics/ignored-leads-sql";
import { isReason } from "../analytics/ignored-leads-core";
import { isLive } from "../live-flags";
import { featureOn } from "../flags";
import { isPrefKey, loadPrefs, savePref } from "../analytics/speed-prefs-db";
import { sql } from "../db";
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
    const to = localDay(now), from = addDays(localDay(now), -29);
    return parseWindow(from, to, now);
  }
  return parseWindow(f, t, now, atOf(url.searchParams));
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
    return json(withUrls({ ...out, measuring: { targetMinutes, countAutomated: m.countAutomated, businessHours: m.businessHours, canChange: ctx.kind !== "client" }, seePeople, ignoredOn: await featureOn("sp_ignored_leads") }, links.contact));
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
      noSource: sp.get("source") === "none", week, day: /^\d{4}-\d{2}-\d{2}$/.test(sp.get("day") ?? "") ? sp.get("day") : null, replyDay: /^\d{4}-\d{2}-\d{2}$/.test(sp.get("replyDay") ?? "") ? sp.get("replyDay") : null, q: (sp.get("q") ?? "").slice(0, 80), sort: sortP as LeadSort, page: int(sp.get("page"), 0), size: int(sp.get("size"), 25),
    });
    return json(withUrls(out, links.contact));
  }

  // Stage SPEED4: the race, coverage, the lead journey, the proof report and one lead story. The accounts come from the session; a filter only narrows inside them.
  // The bar's dates narrow every part that is about a period; the race is "right now" and ignores them. A bad pair of dates is ignored here (the home read already refuses it).
  const wp = sp.get("from") !== null && sp.get("to") !== null ? parseWindow(sp.get("from"), sp.get("to"), now, atOf(sp)) : null;
  const win = wp && wp.ok ? { winFrom: wp.win.fromMs, winTo: wp.win.toMs } : {};
  if (part === "zones") {
    const allowed = narrowed(allowedAll, sp.get("account"));
    if (allowed === "none") return json({ error: "Unknown account" }, 404);
    const rows = await sql()`select distinct coalesce(timezone, 'UTC') z from locations where installation_id = ${ctx.installationId} and not ignored ${allowed ? sql()`and location_id = any(${allowed as string[]}::text[])` : sql()``}`;
    return json({ zones: rows.map((r) => ({ zone: r.z as string, label: zoneLabel(r.z as string, now) })).sort((a, b) => a.label.localeCompare(b.label)).slice(0, 6) });
  }
  if (part === "pulse") {
    const allowed = narrowed(allowedAll, sp.get("account"));
    if (allowed === "none") return json({ error: "Unknown account" }, 404);
    return json(withUrls(await speedPulse({ installationId: ctx.installationId, allowed: allowed as string[] | null, targetMinutes, now, seePeople, filter: parseFilter(sp), ...win }), links.contact));
  }
  if (part === "booking" || part === "ladder" || part === "ladder-leads") {
    const allowed = narrowed(allowedAll, sp.get("account"));
    if (allowed === "none") return json({ error: "Unknown account" }, 404);
    const input = { installationId: ctx.installationId, allowed: allowed as string[] | null, targetMinutes, now, seePeople, filter: undefined, ...win };
    // The ladder names people, so a client's staff do not get it (they see their own leads elsewhere).
    if (part === "ladder") return seePeople ? json(withUrls(await ladderPreview(input), links.contact)) : json({ error: "Not available in this view" }, 403);
    if (part === "ladder-leads") {
      if (!seePeople) return json({ error: "Not available in this view" }, 403);
      const st = Number(sp.get("step"));
      return json(withUrls(await ladderLeads(input, { step: st === 1 || st === 2 || st === 3 ? st : 0, page: int(sp.get("page"), 0), size: int(sp.get("size"), 20), accPage: int(sp.get("accPage"), 0), accSize: int(sp.get("accSize"), 5) }), links.contact));
    }
    return json(await speedBooking(input));
  }

  if (part === "race" || part === "coverage" || part === "journey" || part === "journey-list" || part === "proof" || part === "story") {
    const allowed = narrowed(allowedAll, sp.get("account") ?? sp.get("f_account"));
    if (allowed === "none") return json({ error: "Unknown account" }, 404);
    const input = { installationId: ctx.installationId, allowed: allowed as string[] | null, targetMinutes, now, seePeople, filter: parseFilter(sp), ...(part === "race" ? {} : win) };
    if (part === "race") return json(withUrls(await speedRace(input), links.contact));
    if (part === "coverage") return json(withUrls(await speedCoverage(input), links.contact));
    if (part === "journey") return json({ ...(await speedJourney(input)), pro: await featureOn("lead_journey_pro") });
    if (part === "proof") return json(await speedProof(input));
    if (part === "story") { const l = sp.get("loc"), c = sp.get("contact"); return l && c && ID.test(l) && ID.test(c) ? json(await speedStory({ ...input, locationId: l, contactId: c })) : json({ error: "Unknown lead" }, 400); }
    const step = sp.get("step");
    if (!isStep(step)) return json({ error: "Unknown step" }, 400);
    return json(withUrls(await speedJourneyList({ ...input, step, dropped: sp.get("dropped") === "1" }), links.contact));
  }

  if (part === "insights" || part === "insight-list") {
    const input = { installationId: ctx.installationId, allowed: narrowed(allowedAll, sp.get("account")), targetMinutes, now, seePeople, filter: parseFilter(sp), ...win };
    if (input.allowed === "none") return json({ error: "Unknown account" }, 404);
    const base = { ...input, allowed: input.allowed as string[] | null };
    if (part === "insights") return json(await speedInsights(base));
    const sel = parseSel(sp, seePeople);
    if (!sel) return json({ error: "Unknown list" }, 400);
    return json(withUrls(await speedInsightList({ ...base, sel }), links.contact));
  }

  // Clients ignoring leads (flag sp_ignored_leads): the report per client account and the exact people behind any count. The accounts come from the session; an account id only narrows inside them.
  if (part === "ignored" || part === "ignored-list") {
    if (!(await featureOn("sp_ignored_leads"))) return part === "ignored" ? json({ enabled: false }) : json({ error: "Not available" }, 404);
    const w = windowOf(ctx.url, now);
    if (!w.ok) return json({ error: w.error }, 400);
    const allowed = narrowed(allowedAll, sp.get("account"));
    if (allowed === "none") return part === "ignored" ? json({ enabled: true, accounts: [], totals: null }) : json({ total: 0, page: 0, rows: [] });
    const scope = { installationId: ctx.installationId, allowed: allowed as string[] | null, fromMs: w.win.fromMs, toMs: w.win.toMs, now };
    if (part === "ignored") return json({ enabled: true, ...(await ignoredReport(scope)), measuring: await h.measuring() });
    const reasonP = sp.get("reason") ?? "all";
    if (reasonP !== "all" && !isReason(reasonP)) return json({ error: "Unknown list" }, 400);
    const size = [20, 50, 100].includes(int(sp.get("size"), 50)) ? int(sp.get("size"), 50) : 50;
    const out = await ignoredPage(scope, { reason: reasonP, account: null, page: Math.max(0, int(sp.get("page"), 0)), size });
    const rows = out.rows.map((r) => ({
      locationId: r.locationId, locationName: r.locationName, contactId: r.contactId, name: r.name, status: "waiting" as const, neverAnswered: r.reasons.includes("never") && r.reasons.length === 1, minutes: Math.max(0, Math.round((now - r.since) / 60_000)),
      source: r.source ?? "No source recorded", repliedBy: null, owner: r.owner, unassigned: !r.owner, autoSeconds: null, detailed: false, phone: r.phone, email: r.email, dnd: r.dnd, timeZone: r.timeZone, suggestion: null, dollars: r.dollars, reasons: r.reasons,
    }));
    return json(withUrls({ total: out.total, page: out.page, size, rows }, links.contact));
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

/** PUT /api/app/speed/ladder { enabled, nextAfterMin, managerAfterMin }: the company-wide escalation ladder. Not for a client's staff. Values are clamped on the server. */
export async function handleSpeedLadder(ctx: Ctx): Promise<Response> {
  if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
  const body = await ctx.request.json().catch(() => null);
  const r = await saveLadder(ctx.installationId, body);
  return r.ok ? json({ ok: true, ladder: r.ladder }) : json({ error: r.error }, 503);
}

/**
 * The Speed summary message. GET speed/digest?account=<id>, PUT speed/digest, POST speed/digest/preview, POST speed/digest/test. Not for a client's staff. An account id only NARROWS inside the caller's accounts.
 * "Send test" goes through the same outward gate as every send: with the switches off it writes a WOULD SEND audit line and sends nothing.
 */
export async function handleSpeedDigest(ctx: Ctx, h: SpeedHelpers): Promise<Response> {
  if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
  const m = ctx.request.method; const sub = ctx.segments[2] ?? "";
  const body = m === "GET" ? null : ((await ctx.request.json().catch(() => null)) as Record<string, unknown> | null);
  const asked = m === "GET" ? ctx.url.searchParams.get("account") : typeof body?.locationId === "string" ? body.locationId : null;
  const allowed = await h.allowed();
  let loc = "";
  if (asked) { if (!ID.test(asked) || (allowed && !allowed.includes(asked))) return json({ error: "Client account not found." }, 404); loc = asked; }
  const live = { email: isLive("SEND_EMAIL_LIVE"), slack: isLive("SEND_SLACK_LIVE") };
  if (m === "GET") {
    const d = await loadDigest(ctx.installationId, loc);
    return json({ ...d, live, destination: destination(d.settings, live), account: loc || null });
  }
  if (m === "PUT") {
    const r = await saveDigest(ctx.installationId, loc, body?.settings);
    return r.ok ? json({ ok: true, settings: r.settings, destination: destination(r.settings, live) }) : json({ error: r.error }, 503);
  }
  if (m === "POST" && (sub === "preview" || sub === "test")) {
    const s = sanitizeDigest(body?.settings);
    let who = "Your accounts";
    if (loc) { const [l] = await sql()`select name from locations where installation_id = ${ctx.installationId} and location_id = ${loc}`; who = (l?.name as string | null) ?? who; }
    const n = await digestNumbers(ctx.installationId, loc ? [loc] : allowed, who, await h.targetMinutes(), Date.now());
    const msg = buildMessage(s, n);
    if (sub === "preview") return json({ subject: msg.subject, text: msg.text, destination: destination(s, live) });
    if (!s.recipients.length && !s.slack) return json({ error: "Add an email address or choose Slack first." }, 400);
    const sent = await deliver(ctx.installationId, s, n, { test: true });
    return json({ ok: true, wouldSend: sent.filter((x) => !x.live).map((x) => x.channel), sent: sent.filter((x) => x.live).map((x) => x.channel), destination: destination(s, live) });
  }
  return json({ error: "Not found" }, 404);
}

/** GET speed/prefs (everything the caller may read) and PUT speed/prefs { scope, key, value }. A client's staff can read but not change the shared choices; their browser keeps their own. */
export async function handleSpeedPrefs(ctx: Ctx, h: SpeedHelpers): Promise<Response> {
  const allowed = await h.allowed();
  if (ctx.request.method === "GET") return json(await loadPrefs(ctx.installationId, allowed));
  if (ctx.kind === "client") return json({ error: "Ask your administrator to change this." }, 403);
  const b = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  const scope = typeof b?.scope === "string" ? b.scope : "";
  if (!isPrefKey(b?.key) || (scope && (!ID.test(scope) || (allowed && !allowed.includes(scope))))) return json({ error: "Unknown choice" }, 400);
  const r = await savePref(ctx.installationId, scope, b.key, b.value);
  return r.ok ? json({ ok: true }) : json({ error: r.error }, 503);
}
