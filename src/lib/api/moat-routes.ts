import { sql } from "../db";
import type { deepLinks } from "../links";
import type { Feature } from "../entitlements";
import { channelMix, receiptPeople, RECEIPT_KINDS, rescuedReceipt, scorecards, speedCurve, waitClockList } from "../analytics/moat-queries";
import { getBenchmarkOptIn, peerBenchmark, setBenchmarkOptIn } from "../analytics/benchmarks-audited";
import { createProofPage, listProofPages, PROOF_ID, revokeProofPage } from "../analytics/reply-proof";
import { recordAlertFeedback, recordTargetChange } from "../analytics/moat-record";
import { isVertical, monthWindow, VERTICALS, VERTICAL_LABEL } from "../analytics/moat-core";
import { setAccountTarget } from "../analytics/speed-v2-queries";
import { isRealDay, windowAtMs } from "../design/zone";
import { json, type AuthContext } from "./auth";

// The moat and proof endpoints (round 3, slice D and E): GET /api/app/moat?part=receipt|curve|scorecards|benchmark|channels|clock|setup|proofs and the small writes
// PUT moat/vertical, PUT moat/benchmark, PUT moat/target, POST moat/proof, POST moat/proof-revoke, POST moat/alert-feedback.
// Who is asking comes from the verified session (`ctx`); the accounts that caller may read come from `allowed` (derived by the router, never from the request); an account id in
// the request only NARROWS inside them. Every part is behind its own flag. A client's staff see only their own scorecard and nothing else. Nothing here writes to the CRM.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };

export type MoatHelpers = {
  allowed: () => Promise<string[] | null>;
  links: () => Promise<ReturnType<typeof deepLinks>>;
  settings: () => Promise<{
    speedTargetMinutes: number; countAutomatedTouches: boolean; speedBusinessHours: boolean; speedOpenHour: number; speedCloseHour: number;
    brandName: string | null; brandColor: string | null; brandLogoOverride?: string | null;
  }>;
};

const ID = /^[A-Za-z0-9_-]{3,64}$/;
const int = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };

const on = (ctx: Ctx, f: Feature) => ctx.entitlements.features[f] === true && !ctx.entitlements.locked.includes(f);
const off = () => json({ error: "This is not switched on for your account" }, 404);

/** The date bar's window (from, to and optional hours, Lagos time) when the screen sent one; null means the card's own fixed length. */
const barWindow = (sp: URLSearchParams) => { const f = sp.get("from"), t = sp.get("to"); return isRealDay(f) && isRealDay(t) ? windowAtMs(f, t, sp.get("fromTime"), sp.get("toTime")) : null; };

function narrowed(allowed: string[] | null, id: string | null): string[] | null | "none" {
  if (!id) return allowed;
  if (!ID.test(id)) return "none";
  if (allowed && !allowed.includes(id)) return "none";
  return [id];
}

export async function handleMoat(ctx: Ctx, h: MoatHelpers): Promise<Response> {
  const method = ctx.request.method;
  const sub = ctx.segments[1] ?? "";
  const staff = ctx.kind === "client" && ctx.session.role !== "admin";
  const allowedAll = await h.allowed();

  if (method === "GET") {
    const sp = ctx.url.searchParams;
    const part = sp.get("part");
    const allowed = narrowed(allowedAll, sp.get("account"));
    const empty = allowed === "none";
    const scope = empty ? [] : allowed;
    const st = await h.settings();

    if (part === "scorecards") {
      if (!on(ctx, "moat_scorecards")) return off();
      const meId = ctx.session.userId ?? null;
      if (staff && !meId) return json({ rows: [], total: 0, page: 0, pages: 1, scope: "self" });
      const out = await scorecards({
        installationId: ctx.installationId, allowed: scope, onlyUserId: staff ? meId : null, countAutomated: st.countAutomatedTouches,
        openHour: st.speedOpenHour, closeHour: st.speedCloseHour, days: int(sp.get("days"), 30), win: barWindow(sp), page: int(sp.get("page"), 0), size: int(sp.get("size"), 20),
      });
      return json({ ...out, scope: staff ? "self" : ctx.kind === "client" || ctx.kind === "business" ? "team" : "all" });
    }
    if (staff) return json({ error: "Not available in this view" }, 403);

    if (part === "receipt") {
      if (!on(ctx, "moat_receipt")) return off();
      const win = monthWindow(sp.get("month"));
      if (!win) return json({ error: "Choose a month like 2026-10" }, 400);
      return json(await rescuedReceipt({ installationId: ctx.installationId, allowed: scope, ...win }));
    }
    if (part === "receipt-people") {
      if (!on(ctx, "moat_receipt")) return off();
      const win = monthWindow(sp.get("month"));
      const kind = RECEIPT_KINDS.find((k) => k === sp.get("kind"));
      if (!win || !kind) return json({ error: "Choose a month and a number to open" }, 400);
      const links = await h.links();
      const out = await receiptPeople({ installationId: ctx.installationId, allowed: scope, ...win, kind, page: int(sp.get("page"), 0), size: int(sp.get("size"), 20) });
      return json({ ...out, rows: out.rows.map((r) => ({ ...r, url: r.conversationId ? links.conversation(r.locationId, r.conversationId) : null, contactUrl: r.contactId ? links.contact(r.locationId, r.contactId) : null })) });
    }
    if (part === "curve") {
      if (!on(ctx, "moat_curve")) return off();
      return json(await speedCurve({ installationId: ctx.installationId, allowed: scope, days: int(sp.get("days"), 90), countAutomated: st.countAutomatedTouches }));
    }
    if (part === "channels") {
      if (!on(ctx, "inbox_channel_mix")) return off();
      return json(await channelMix({ installationId: ctx.installationId, allowed: scope, days: int(sp.get("days"), 30), win: barWindow(sp) }));
    }
    if (part === "clock") {
      if (!on(ctx, "inbox_wait_clock")) return off();
      const links = await h.links();
      const out = await waitClockList({
        installationId: ctx.installationId, allowed: scope, now: Date.now(), page: int(sp.get("page"), 0), size: int(sp.get("size"), 20),
        clock: { businessHours: st.speedBusinessHours, openHour: st.speedOpenHour, closeHour: st.speedCloseHour },
      });
      return json({ ...out, rows: out.rows.map((r) => ({ ...r, url: links.conversation(r.locationId, r.conversationId) })), hours: { open: st.speedOpenHour, close: st.speedCloseHour } });
    }
    if (part === "benchmark") {
      if (!on(ctx, "moat_benchmark")) return off();
      if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
      return json(await peerBenchmark({ installationId: ctx.installationId, actor: ctx.session.userId ?? ctx.kind, allowedLocations: scope }, sp.get("vertical")));
    }
    if (part === "setup") {
      // The accounts with their kind of business and reply target, the benchmark switch and the list of kinds. Names are the caller's own accounts only.
      const rows = await sql()`
        select l.location_id, coalesce(l.name, 'Unnamed account') name, p.vertical, l.speed_target_minutes
        from locations l left join account_profiles p on p.installation_id = l.installation_id and p.location_id = l.location_id
        where l.installation_id = ${ctx.installationId} and not l.ignored and (${scope === null} or l.location_id = any(${scope ?? []}::text[]))
        order by l.name limit 500`;
      return json({
        verticals: VERTICALS.map((k) => ({ key: k, label: VERTICAL_LABEL[k] })), defaultTarget: st.speedTargetMinutes,
        benchmarkOptIn: await getBenchmarkOptIn(ctx.installationId),
        accounts: rows.map((r) => ({ locationId: r.location_id as string, name: r.name as string, vertical: (r.vertical as string | null) ?? null, targetMinutes: (r.speed_target_minutes as number | null) ?? null })),
      });
    }
    if (part === "proofs") {
      if (!on(ctx, "moat_proof_page")) return off();
      return json({ links: await listProofPages(ctx.installationId, scope) });
    }
    return json({ error: "Unknown part of this screen" }, 400);
  }

  // ---- writes: never for a client's staff, never in the demo
  if (staff || ctx.demo) return json({ error: "Not available in this view" }, 403);
  const body = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Invalid request" }, 400);
  const inScope = (id: unknown): id is string => typeof id === "string" && ID.test(id) && (allowedAll === null || allowedAll.includes(id));
  const actor = ctx.session.userId ?? null;

  if (method === "PUT" && sub === "vertical") {
    if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
    if (!inScope(body.locationId)) return json({ error: "Client account not found" }, 404);
    if (body.vertical !== null && !isVertical(body.vertical)) return json({ error: "Choose one of the listed kinds of business" }, 400);
    await sql()`insert into account_profiles (installation_id, location_id, vertical) values (${ctx.installationId}, ${body.locationId}, ${body.vertical as string | null})
      on conflict (installation_id, location_id) do update set vertical = excluded.vertical, updated_at = now()`;
    return json({ ok: true, vertical: body.vertical });
  }
  if (method === "PUT" && sub === "benchmark") {
    if (!on(ctx, "moat_benchmark")) return off();
    if (ctx.kind === "client" || ctx.kind === "business") return json({ error: "Only the owner of the account can change this" }, 403);
    await setBenchmarkOptIn(ctx.installationId, body.optIn === true);
    await sql()`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${actor ?? ctx.kind}, 'benchmark.opt_in', ${sql().json({ optIn: body.optIn === true } as never)})`;
    return json({ ok: true, optIn: body.optIn === true });
  }
  if (method === "PUT" && sub === "target") {
    if (!on(ctx, "inbox_reply_target")) return off();
    if (!inScope(body.locationId)) return json({ error: "Client account not found" }, 404);
    const r = await setAccountTarget(ctx.installationId, allowedAll, body.locationId, body.minutes === undefined ? NaN : body.minutes);
    if (!r.ok) return json({ error: r.error }, r.status);
    if (on(ctx, "moat_record")) await recordTargetChange({ installationId: ctx.installationId, locationId: body.locationId, minutes: r.minutes, by: actor }).catch(() => undefined);
    return json({ ok: true, minutes: r.minutes });
  }
  if (method === "POST" && sub === "proof") {
    if (!on(ctx, "moat_proof_page")) return off();
    if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
    if (!inScope(body.locationId)) return json({ error: "Client account not found" }, 404);
    const st = await h.settings();
    const made = await createProofPage({
      installationId: ctx.installationId, locationId: body.locationId, by: actor,
      brand: { name: st.brandName ?? "Your company", color: st.brandColor ?? null, logoUrl: st.brandLogoOverride ?? null },
      countAutomated: st.countAutomatedTouches, defaultTarget: st.speedTargetMinutes, businessHours: st.speedBusinessHours,
    });
    if (!made.ok) return json({ error: made.error }, 400);
    const origin = (process.env.NEXT_PUBLIC_APP_URL ?? ctx.url.origin).replace(/\/+$/, "");
    return json({ ok: true, url: `${origin}/reply-proof/${made.id}`, expiresInDays: 30 });
  }
  if (method === "POST" && sub === "proof-revoke") {
    if (!on(ctx, "moat_proof_page")) return off();
    if (typeof body.id !== "string" || !PROOF_ID.test(body.id)) return json({ error: "Unknown link" }, 400);
    return json({ ok: await revokeProofPage(ctx.installationId, allowedAll, body.id, actor) });
  }
  if (method === "POST" && sub === "alert-feedback") {
    if (!on(ctx, "moat_alert_feedback")) return off();
    if (typeof body.alertId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.alertId) || typeof body.useful !== "boolean" || !actor) return json({ error: "Choose an alert and yes or no" }, 400);
    // The alert must belong to this installation and to an account the caller may read.
    const [a] = await sql()`select location_id from alerts where id = ${body.alertId} and installation_id = ${ctx.installationId}`;
    if (!a || !inScope(a.location_id as string)) return json({ error: "Alert not found" }, 404);
    await recordAlertFeedback({ installationId: ctx.installationId, locationId: a.location_id as string, alertId: body.alertId, useful: body.useful, by: actor });
    return json({ ok: true });
  }
  return json({ error: "Unknown request" }, 400);
}

