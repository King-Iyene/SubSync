import { atOf } from "../analytics/window-time";
import { writeEnabledFor } from "../analytics/cleanup-config";
import { cleanId, type Scope } from "../analytics/appointments3-queries";
import { parseApptWindow } from "../analytics/appointments3-intel";
import { readTargets } from "../analytics/cu-queries";
import {
  AGE_BANDS, FORMULA, PAGE, RECOVER_CAP, RECOVER_TAG, STEPS, biggestLeak, headlineOf, hotspot, isDim, isStepKey, leakDollars, leakFinder, recoverPhrase, spanText, stepIndex, stepRows, type Dim, type StepKey,
} from "../analytics/bf-core";
import { bfCache, breakdown, cells, cohorts, countLeads, forecast, formOptions, listLeads, medians, totals, type BfFilters } from "../analytics/bf-queries";
import { modeWords, runMode, typedMatches } from "../cleanup/cu-core";
import { bulkViaGateway } from "../ghl/crm-gateway";
import { isLive } from "../live-flags";
import type { Feature } from "../entitlements";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import { ownedLocation } from "./tenant-guard";

// Appointments > Booking funnel: GET /api/app/appointments/funnel?part=summary|breakdown|leaks|cohorts|forecast|rows|options (read only) and POST /api/app/appointments/funnel-recover
// (tags the leads that dropped out so the account's own follow-up can pick them up; preview first, capped, typed words, a dry run unless the server switch AND the account's opt-in are on).
// Who is asking and which accounts they may read come from the verified session (`allowed`), never from the request. An account id in the address only NARROWS inside them, and one
// that is not theirs is the same answer as nothing there (never echoed). A client's staff never get a split by person or by account. SubSync sends a message only when a person presses Send.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type BfHelpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>>; locationToken: (locationId: string) => Promise<string>; actor: (ctx: Ctx) => string | null };
const PARTS = ["summary", "breakdown", "leaks", "cohorts", "forecast", "rows", "options"] as const;
const on = (ctx: Ctx, f: string) => ctx.entitlements.features[f as Feature] === true && !ctx.entitlements.locked.includes(f as Feature);
const adminSide = (ctx: Ctx) => ctx.kind !== "client" || ctx.session.role === "admin";
const missing = (e: unknown) => { const c = (e as { code?: string } | null)?.code; return c === "42P01" || c === "42703"; };
const text = (v: string | null, max: number) => ((v ?? "").trim().slice(0, max).replace(/[\u0000-\u001f]/g, "") || null);
const idParam = (v: string | null) => (v === "none" ? "none" : cleanId(v));
const intIn = (v: string | null, lo: number, hi: number): number | null => { if (v === null || v === "") return null; const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };

/** The filters, from an address' query. People and the account split are for agency staff and business admins only. */
function filtersOf(sp: URLSearchParams, seePeople: boolean, location: string | null): { f: BfFilters; problem: string | null } {
  const w = parseApptWindow(sp.get("from"), sp.get("to"), Date.now(), atOf(sp));
  const age = sp.get("age");
  return {
    problem: w.problem,
    f: {
      from: w.from, to: w.to, location, calendar: cleanId(sp.get("calendar")), setter: seePeople ? idParam(sp.get("setter")) : null, closer: seePeople ? idParam(sp.get("closer")) : null, owner: seePeople ? idParam(sp.get("owner")) : null,
      source: text(sp.get("source"), 80), form: idParam(sp.get("form")), hour: intIn(sp.get("hour"), 0, 23), dow: intIn(sp.get("dow"), 0, 6), age: AGE_BANDS.some((b) => b.key === age) ? age : null,
    },
  };
}

async function oneAccount(ctx: Ctx, allowed: string[] | null, v: string | null): Promise<{ ok: true; id: string | null } | { ok: false }> {
  if (!v) return { ok: true, id: null };
  const id = await ownedLocation(ctx.installationId, allowed, v);
  return id ? { ok: true, id } : { ok: false };
}

export async function handleBfFunnel(ctx: Ctx, h: BfHelpers): Promise<Response> {
  const sp = ctx.url.searchParams, part = sp.get("part") as (typeof PARTS)[number] | null;
  if (!part || !PARTS.includes(part)) return json({ error: "Not found" }, 404);
  if (!on(ctx, "bf_funnel") || (sp.get("mini") === "1" && !on(ctx, "bf_today"))) return json({ error: "The booking funnel is not switched on yet." }, 404);
  const allowed = await h.allowed();
  const seePeople = ctx.kind !== "client", canSeeAccounts = ctx.limitTo === null;
  const acct = await oneAccount(ctx, allowed, sp.get("location"));
  const wrap = (body: object) => json({ ...body, generatedAt: new Date().toISOString(), canSeeAccounts, canSeePeople: seePeople });
  if (!acct.ok) return wrap({ empty: true });
  const s: Scope = { inst: ctx.installationId, allowed };
  const { f, problem } = filtersOf(sp, seePeople, acct.id);
  const key = JSON.stringify([ctx.installationId, allowed, part, sp.toString(), ctx.kind]);
  const hit = bfCache.get(key);
  if (hit && part !== "rows") return wrap({ ...(hit as object), cached: true });
  const done = (body: object) => { bfCache.set(key, body); return wrap(body); };
  try {
    switch (part) {
      case "summary": {
        const t = await totals(s, f), rows = stepRows(t.tot), leak = biggestLeak(t.tot);
        const [cs, md] = await Promise.all([leak ? cells(s, f, leak.stepIdx) : Promise.resolve([]), medians(s, f)]);
        const hot = leak ? hotspot(cs) : null, avg = t.tot.won > 0 ? t.tot.wonValue / t.tot.won : null;
        return done({
          period: { from: f.from.toISOString().slice(0, 10), to: new Date(f.to.getTime() - 86_400_000).toISOString().slice(0, 10) }, steps: rows, headline: headlineOf(t.tot, hot), hot: hot?.text ?? null,
          leak: leak ? { ...leak, dollars: leakDollars(t.tot, leak.stepIdx), formula: FORMULA.leak } : null, avgDeal: avg !== null && t.tot.won >= 5 ? Math.round(avg) : null, won: t.tot.won, wonValue: Math.round(t.tot.wonValue), lost: t.tot.lost,
          times: [
            { key: "touch", label: "Lead to first reply", secs: md.touch, text: spanText(md.touch) }, { key: "book", label: "Lead to booked", secs: md.book, text: spanText(md.book) },
            { key: "show", label: "Lead to showed up", secs: md.show, text: spanText(md.show) }, { key: "win", label: "Lead to won", secs: md.win, text: spanText(md.win) },
          ], timesNote: md.sample > 0 ? `Median of the latest ${md.sample.toLocaleString("en-US")} leads.` : null, live: t.live, historyStarts: t.historyStarts, problem,
        });
      }
      case "breakdown": {
        const by = sp.get("by");
        if (!isDim(by)) return json({ error: "Choose how to split it" }, 400);
        if (!seePeople && (by === "setter" || by === "closer" || by === "owner")) return done({ by, rows: [] });
        if (!canSeeAccounts && by === "account") return done({ by, rows: [] });
        const b = await breakdown(s, f, by);
        return done({ by, rows: b.rows.map((r) => ({ id: r.id, name: r.name, steps: stepRows(r.tot), leak: biggestLeak(r.tot) })), live: b.live, problem });
      }
      case "leaks": {
        const dims: Dim[] = canSeeAccounts ? ["account"] : [];
        if (seePeople) dims.push("setter", "closer");
        const out: Record<string, unknown> = {};
        for (const d of dims) {
          const b = await breakdown(s, f, d);
          out[d === "account" ? "accounts" : d === "setter" ? "setters" : "closers"] = leakFinder(b.rows.filter((r) => d === "account" || r.id !== "")).slice(0, 12);
        }
        return done({ accounts: [], setters: [], closers: [], ...out, problem });
      }
      case "cohorts": {
        const c = await cohorts(s, f);
        return done({ rows: c.rows, live: c.live, historyStarts: c.historyStarts, problem });
      }
      case "forecast": return done({ ...(await forecast(s, { ...f, hour: null, dow: null, age: null })), problem });
      case "options": return done({ forms: await formOptions(s, f) });
      case "rows": {
        const step = sp.get("step"), mode = sp.get("mode") === "reached" ? "reached" : "dropped";
        if (!isStepKey(step) || (mode === "dropped" && step === "lead")) return json({ error: "Choose a step" }, 400);
        const size = [25, 50, 100].includes(Number(sp.get("size"))) ? Number(sp.get("size")) : PAGE, after = sp.get("after");
        const links = await h.links();
        const spec = { step: step as StepKey, mode } as const;
        const [page, count] = await Promise.all([listLeads(s, f, spec, after, size), after ? Promise.resolve(null) : countLeads(s, f, spec)]);
        return wrap({ rows: page.rows.map((r) => ({ ...r, url: links.contact(r.locationId, r.contactId) })), next: page.next, total: count, label: `${mode === "dropped" ? "Lost before" : "Reached"}: ${STEPS[stepIndex(step as StepKey)].label}`, problem });
      }
    }
  } catch (e) {
    if (missing(e)) return json({ error: "The booking funnel record is not set up yet. It starts after the next update." }, 503);
    throw e;
  }
  return json({ error: "Not found" }, 404);
}

/** POST /api/app/appointments/funnel-recover { query, account, step, stage: "preview"|"do", typed? }. One account at a time. */
export async function handleBfRecover(ctx: Ctx, h: BfHelpers): Promise<Response> {
  if (!on(ctx, "bf_funnel") || !on(ctx, "bf_recover")) return json({ error: "This is not switched on for your account" }, 404);
  if (!adminSide(ctx)) return json({ error: "Ask your administrator to tag several leads at once." }, 403);
  const body = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Send what to recover" }, 400);
  const stepKey = body.step, stage = body.stage;
  if (!isStepKey(stepKey) || stepKey === "lead") return json({ error: "Choose a step" }, 400);
  if (stage !== "preview" && stage !== "do") return json({ error: "Choose preview or do" }, 400);
  const allowed = await h.allowed();
  const location = await ownedLocation(ctx.installationId, allowed, body.account);
  if (!location) return json({ error: "That client account is not available" }, 404);
  const sp = new URLSearchParams(typeof body.query === "string" ? body.query.slice(0, 600) : "");
  const { f } = filtersOf(sp, ctx.kind !== "client", location);
  const s: Scope = { inst: ctx.installationId, allowed };
  const spec = { step: stepKey, mode: "dropped" } as const;
  const rows: Awaited<ReturnType<typeof listLeads>>["rows"] = [];
  let after: string | null = null;
  while (rows.length < RECOVER_CAP) {
    const page = await listLeads(s, f, spec, after, 100);
    rows.push(...page.rows);
    after = page.next;
    if (!after) break;
  }
  const picked = rows.slice(0, RECOVER_CAP);
  const live = await readTargets(ctx.installationId, allowed, picked.map((r) => ({ locationId: r.locationId, contactId: r.contactId })));
  const safeIds = new Set(live.filter((l) => l.protect === null && l.locationId === location).map((l) => l.contactId));
  const safe = picked.filter((r) => !r.dnd && safeIds.has(r.contactId));
  const held = picked.length - safe.length, optedIn = await writeEnabledFor(ctx.installationId, location), switchOn = isLive("WRITE_GHL_LIVE"), mode = runMode({ switchOn, optedIn });
  const phrase = recoverPhrase(safe.length, safe.length === 1 ? safe[0].name : null);
  if (stage === "preview") {
    return json({
      requested: safe.length, cap: RECOVER_CAP, capped: rows.length >= RECOVER_CAP, protectedSkipped: held, sample: safe.slice(0, 8).map((r) => r.name), phrase, mode, modeWords: modeWords(mode, { switchOn, optedIn }),
      warning: `Adds the tag "${RECOVER_TAG}" so your own follow-up can pick these leads up. SubSync sends no message. People who asked not to be contacted, and anyone with an open deal or a coming appointment, are left out.`,
    });
  }
  if (safe.length === 0) return json({ error: "There is nothing to tag. Everyone left is protected or has asked not to be contacted." }, 400);
  if (!typedMatches(body.typed, phrase)) return json({ error: "The words do not match, so nothing was changed. Run the preview again and type the words exactly.", phrase }, 400);
  const res = await bulkViaGateway({ installationId: ctx.installationId, locationId: location, actor: h.actor(ctx), optedIn, action: "tag", tag: RECOVER_TAG, contactIds: safe.map((r) => r.contactId), token: () => h.locationToken(location) });
  bfCache.clear(JSON.stringify([ctx.installationId]).slice(0, -1));
  return json({
    mode: res.mode, requested: safe.length, done: res.done, failed: res.failed, protectedSkipped: held, needsPermission: res.needsPermission,
    message: res.mode === "dry_run" ? "Nothing was changed. " + modeWords("dry_run", { switchOn, optedIn }) : res.needsPermission ? "Needs permission: reconnect, then run it again." : `Done: ${res.done} tagged${res.failed ? `, ${res.failed} failed` : ""}.`,
  });
}
