import { sql } from "../db";
import type { Feature } from "../entitlements";
import {
  checkSettings, getLink, getPrSettings, getReport, listRows, prepareMissing, prepareReport, regenerateLink, revokeLink, saveReportEdit, savePrSettings, shareReport,
  tablesMissing, unshareReport, type Opts,
} from "../analytics/proof-queries";
import { PR_FLAGS, SECTION_KEYS, SECTION_LABEL, periodChoices, monthLabel, reportText, validPeriod, type PrStatus } from "../analytics/proof-core";
import { json, type AuthContext } from "./auth";
import { ownedLocation } from "./tenant-guard";

// /api/app/proof: the branded client Proof page and monthly report (stage PR). Agency staff only (a business or client session never reaches this: the access list has no rule for it).
// Who is asking comes from the verified session; the accounts that caller may read come from `allowed`. An account id in a request goes through ownedLocation and only NARROWS inside `allowed`;
// one that is not yours answers "not found" and is never echoed. Nothing here writes to the CRM or sends anything to a client: the owner copies the link or the text and sends it themselves.
//   GET  ?part=options | list (period, status, q, page, size) | report (location, period)
//   PUT  settings | report        POST prepare | prepare-all | share | unshare | link (regenerate or revoke, typed confirmation)

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type ProofHelpers = {
  allowed: () => Promise<string[] | null>;
  settings: () => Promise<{ speedTargetMinutes: number; countAutomatedTouches: boolean; speedBusinessHours: boolean; brandName: string | null; brandColor: string | null; brandLogoOverride?: string | null }>;
};

const on = (ctx: Ctx, f: Feature) => ctx.entitlements.features[f] === true && !ctx.entitlements.locked.includes(f);
const off = () => json({ error: "This part of Clients is not switched on yet." }, 404);
const notFound = () => json({ error: "Client account not found" }, 404);
const STATUSES = new Set(["none", "draft", "shared", "viewed"]);
const int = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };
export const proofUrl = (ctx: Ctx, token: string) => `${(process.env.NEXT_PUBLIC_APP_URL ?? ctx.url.origin).replace(/\/+$/, "")}/proof/${token}`;

export async function handleProof(ctx: Ctx, h: ProofHelpers): Promise<Response> {
  try {
    return await run(ctx, h);
  } catch (error) {
    if (tablesMissing(error)) return off();
    throw error;
  }
}

async function run(ctx: Ctx, h: ProofHelpers): Promise<Response> {
  if (ctx.kind !== "agency") return json({ error: "Not available in this view" }, 403);
  if (!PR_FLAGS.some((f) => on(ctx, f as Feature))) return off();
  const method = ctx.request.method, sub = ctx.segments[1] ?? "", sp = ctx.url.searchParams;
  const now = new Date();
  const inst = ctx.installationId, actor = ctx.session.userId ?? null;
  const allowed = await h.allowed();
  const st = await h.settings();
  const opts: Opts = { countAutomated: st.countAutomatedTouches, defaultTarget: st.speedTargetMinutes, businessHours: st.speedBusinessHours };
  const flags = Object.fromEntries(PR_FLAGS.map((f) => [f, on(ctx, f as Feature)]));
  const link = on(ctx, "pr_page");

  if (method === "GET") {
    const part = sp.get("part");
    if (!on(ctx, "pr_report")) return off();
    if (part === "options") {
      const settings = await getPrSettings(inst);
      return json({
        flags, periods: periodChoices(now).map((m) => ({ month: m, label: monthLabel(m) })), defaultPeriod: periodChoices(now)[0], settings, sections: SECTION_KEYS.map((k) => ({ key: k, label: SECTION_LABEL[k] })),
        general: { name: st.brandName, color: st.brandColor, logoUrl: st.brandLogoOverride ?? null }, generatedAt: now.toISOString(),
      });
    }
    const month = sp.get("period");
    if (!validPeriod(month, now)) return json({ error: "Choose a month" }, 400);
    if (part === "list") {
      const status = sp.get("status");
      const q = (sp.get("q") ?? "").trim().slice(0, 60) || null;
      const r = await listRows(inst, allowed, { month, status: status && STATUSES.has(status) ? (status as PrStatus) : null, q, page: Math.max(0, int(sp.get("page"), 0)), size: Math.min(50, Math.max(5, int(sp.get("size"), 20))) });
      return json({ ...r, month, label: monthLabel(month), generatedAt: now.toISOString() });
    }
    if (part === "report") {
      const loc = await ownedLocation(inst, allowed, sp.get("location"));
      if (!loc) return notFound();
      const row = await getReport(inst, loc, month);
      const k = await getLink(inst, loc, link);
      const brandSettings = await getPrSettings(inst);
      return json({
        report: row, month, label: monthLabel(month), brand: { name: brandSettings.displayName ?? st.brandName, logoUrl: brandSettings.logoUrl ?? st.brandLogoOverride ?? null, color: brandSettings.brandColor ?? st.brandColor },
        link: { exists: k.exists, revoked: k.revoked, views: k.views, lastViewedAt: k.lastViewedAt, url: k.token ? proofUrl(ctx, k.token) : null },
        text: row ? reportText(row.payload, { name: brandSettings.displayName ?? st.brandName ?? "Monthly report", logoUrl: null, color: null }, row.intro ?? brandSettings.intro, row.sections) : null,
      });
    }
    return json({ error: "Unknown part of this screen" }, 400);
  }

  // ---- writes
  const body = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Invalid request" }, 400);
  if (sub === "settings" && method === "PUT") {
    if (!on(ctx, "pr_report")) return off();
    const cur = await getPrSettings(inst);
    const r = checkSettings(cur, body);
    if (!r.ok) return json({ error: r.error }, 400);
    await savePrSettings(inst, r.value, actor);
    return json({ ok: true, settings: r.value });
  }
  const month = body.month;
  if (!validPeriod(month, now)) return json({ error: "Choose a month" }, 400);
  const mon = month as string;

  if (sub === "prepare-all" && method === "POST") {
    if (!on(ctx, "pr_report")) return off();
    return json({ ok: true, ...(await prepareMissing(inst, allowed, mon, opts, actor)) });
  }
  const loc = await ownedLocation(inst, allowed, body.locationId);
  if (!loc) return notFound();

  if (sub === "prepare" && method === "POST") {
    if (!on(ctx, "pr_report")) return off();
    const r = await prepareReport(inst, loc, mon, opts, actor);
    return r.ok ? json({ ok: true, kept: r.kept }) : json({ error: r.error }, 404);
  }
  if (sub === "report" && method === "PUT") {
    if (!on(ctx, "pr_report")) return off();
    const r = await saveReportEdit(inst, loc, mon, { ...("intro" in body ? { intro: body.intro } : {}), ...("sections" in body ? { sections: body.sections } : {}) }, actor);
    return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status);
  }
  if (sub === "share" && method === "POST") {
    if (!link) return off();
    const r = await shareReport(inst, loc, mon, actor);
    return r.ok ? json({ ok: true, url: proofUrl(ctx, r.token) }) : json({ error: r.error }, r.status);
  }
  if (sub === "unshare" && method === "POST") {
    if (!link) return off();
    return json({ ok: await unshareReport(inst, loc, mon, actor) });
  }
  if (sub === "link" && method === "POST") {
    if (!link) return off();
    const action = body.action;
    if (action !== "regenerate" && action !== "revoke") return json({ error: "Choose regenerate or revoke" }, 400);
    const [l] = await sql()`select coalesce(name, 'Unnamed account') name from locations where installation_id = ${inst} and location_id = ${loc}`;
    const typed = typeof body.confirm === "string" ? body.confirm.trim().toLowerCase() : "";
    if (!l || typed !== String(l.name).trim().toLowerCase()) return json({ error: "Type the client account's name exactly to confirm" }, 400);
    if (action === "revoke") return json({ ok: await revokeLink(inst, loc, actor) });
    return json({ ok: true, url: proofUrl(ctx, await regenerateLink(inst, loc, actor)) });
  }
  return json({ error: "Unknown request" }, 400);
}
