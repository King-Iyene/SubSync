import { CAPS, CONTACT_KINDS, COUNT_CAP, DEAL_KINDS, FORMULA, GROUP_LABEL, HOURLY_DOLLARS, KINDS, KIND_INFO, NOT_KNOWN_LINE, PAGE, PROTECT_WORDS, REVIEW_TAG, RULES_DATE, RULES_VERSION, confirmPhrase, decodeCursor, healthOf, isDealKind, isKind, modeWords, removeNote, runMode, typedMatches, weeklyList, whyLine,
  type BulkAction, type Counts, type Kind } from "../cleanup/cu-core";
import { cappedCounts, latestPerAccount, listKind, logAction, portfolioCounts, readTargets, recentActions, selectionFor, sweep, trend, type CountCell, type ListRow, type Scope } from "../analytics/cu-queries";
import { writeEnabledFor } from "../analytics/cleanup-config";
import { bulkViaGateway } from "../ghl/crm-gateway";
import { isLive } from "../live-flags";
import { sql } from "../db";
import type { Feature } from "../entitlements";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import { ownedLocation } from "./tenant-guard";

// Clean-up fix lists, health and bulk runs (docs/features/CLEANUP_BRIEF.md, DATA_HEALTH_BRIEF.md), under /api/app/cu/... (the one catch-all route, already guarded).
// Who is asking and which client accounts they may see come from the verified session only (`allowed`). An account id from the request goes through ownedLocation before any query and is never
// echoed; a cursor is a strict shape; a kind is one of a fixed list. Reads are open to everyone who can see the account; any change (tag, remove) is for an administrator, needs the account's own
// opt-in AND the server switch to be live (otherwise it is a dry run that changes nothing), leaves out protected contacts, is capped, and needs the person to type words naming the count.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type CuHelpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>>; locationToken: (locationId: string) => Promise<string>; actor: (ctx: Ctx) => string | null };

const on = (ctx: Ctx, f: Feature) => ctx.entitlements.features[f] === true && !ctx.entitlements.locked.includes(f);
const off = () => json({ error: "This is not switched on for your account" }, 404);
const adminSide = (ctx: Ctx) => ctx.kind !== "client" || ctx.session.role === "admin";
const missing = (e: unknown) => { const c = (e as { code?: string } | null)?.code; return c === "42P01" || c === "42703"; };
const notFoundAccount = () => json({ error: "That client account is not available" }, 404);

async function accountParam(ctx: Ctx, allowed: string[] | null): Promise<{ ok: true; id: string | null } | { ok: false; res: Response }> {
  const v = ctx.url.searchParams.get("account");
  if (!v) return { ok: true, id: null };
  const id = await ownedLocation(ctx.installationId, allowed, v);
  return id === null ? { ok: false, res: notFoundAccount() } : { ok: true, id };
}

const cellsToCounts = (cells: Record<Kind, CountCell>): Record<Kind, CountCell> => cells;

export async function handleCu(ctx: Ctx, h: CuHelpers): Promise<Response | null> {
  const [, b] = ctx.segments;
  const m = ctx.request.method;
  if (!b) return null;
  const known = (m === "GET" && ["options", "home", "accounts", "list", "csv", "actions"].includes(b)) || (m === "POST" && ["bulk", "scan"].includes(b));
  if (!known) return null;

  const fix = on(ctx, "cu_fix"), health = on(ctx, "cu_health"), bulk = on(ctx, "cu_bulk");
  const allowed = await h.allowed();
  const switchOn = isLive("WRITE_GHL_LIVE");

  if (m === "GET" && b === "options") {
    if (!fix && !health) return off();
    const db = sql();
    const rows = await db`select location_id, name from locations where installation_id = ${ctx.installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} order by name limit 2000`;
    return json({
      flags: { fix, health, bulk, confirm: on(ctx, "cu_confirm") }, canChange: adminSide(ctx), switchOn, accounts: rows.map((r) => ({ id: r.location_id as string, name: (r.name as string | null) ?? "Unnamed account" })),
      kinds: KINDS.map((k) => ({ id: k, label: KIND_INFO[k].label, plain: KIND_INFO[k].plain, todo: KIND_INFO[k].todo, group: GROUP_LABEL[KIND_INFO[k].group], deal: isDealKind(k) })),
      caps: CAPS, hourly: HOURLY_DOLLARS, formula: FORMULA, notKnown: NOT_KNOWN_LINE, rules: { version: RULES_VERSION, date: RULES_DATE },
    });
  }

  if (m === "GET" && b === "home") {
    if (!fix && !health) return off();
    const acc = await accountParam(ctx, allowed);
    if (!acc.ok) return acc.res;
    const scope: Scope = { inst: ctx.installationId, allowed, location: acc.id };
    let daily: Awaited<ReturnType<typeof portfolioCounts>> = null;
    let history = [] as Awaited<ReturnType<typeof trend>>;
    try { daily = await portfolioCounts(scope); if (daily) history = await trend(scope, 90); } catch (e) { if (!missing(e)) throw e; }
    // Exact numbers come from the daily record. Until the first scan has run, live counts stop at the cap and say so.
    const live = daily ? null : await cappedCounts(scope);
    const cells = (k: Kind): CountCell => (daily ? { n: daily.counts[k], capped: false } : live![k]);
    const counts = Object.fromEntries(KINDS.map((k) => [k, cells(k)])) as Record<Kind, CountCell>;
    const hc: Counts | null = daily ? daily.counts : null;
    const hh = hc ? healthOf(hc) : null;
    const weekly = hc ? weeklyList(hc) : [];
    return json({
      source: daily ? "daily" : "live", day: daily?.day ?? null, accounts: daily?.accounts ?? null, counts: cellsToCounts(counts), cap: COUNT_CAP,
      health: hh ? { score: hh.score, word: hh.word, why: whyLine(hh), evidence: hh.evidence.slice(0, 6), note: hh.note, version: hh.version } : null,
      contacts: daily?.counts.contacts ?? null, dealsOpen: daily?.counts.dealsOpen ?? null, dupExtra: daily?.counts.dupExtra ?? null, protectedContacts: daily?.protectedContacts ?? null,
      trend: history, weekly, weeklyHours: Math.round(weekly.reduce((s, w) => s + w.hours, 0) * 10) / 10, weeklyDollars: weekly.reduce((s, w) => s + w.dollars, 0), formula: FORMULA,
      rules: { version: RULES_VERSION, date: RULES_DATE },
    });
  }

  if (m === "GET" && b === "accounts") {
    if (!health) return off();
    const sp = ctx.url.searchParams;
    const q = (sp.get("q") ?? "").trim().slice(0, 60) || null;
    const page = Math.max(0, Math.min(1000, Math.floor(Number(sp.get("page")) || 0)));
    const size = 10;
    let res = { rows: [] as Awaited<ReturnType<typeof latestPerAccount>>["rows"], total: 0 };
    try { res = await latestPerAccount({ inst: ctx.installationId, allowed, location: null }, q, size, page * size); } catch (e) { if (!missing(e)) throw e; }
    return json({
      total: res.total, page, pages: Math.max(1, Math.ceil(res.total / size)),
      rows: res.rows.map((r) => {
        const hc = healthOf(r.counts);
        const top = hc.evidence[0] ?? null;
        return { locationId: r.locationId, name: r.name, day: r.day, contacts: r.counts.contacts, score: r.score, word: r.score === null ? null : hc.word, why: whyLine(hc), top: top ? { label: top.label, count: top.count } : null, protectedContacts: r.protectedContacts };
      }),
    });
  }

  if (m === "GET" && (b === "list" || b === "csv")) {
    if (!fix) return off();
    const sp = ctx.url.searchParams;
    const kind = sp.get("kind");
    if (!isKind(kind)) return json({ error: "Choose one of the lists" }, 400);
    const acc = await accountParam(ctx, allowed);
    if (!acc.ok) return acc.res;
    const scope: Scope = { inst: ctx.installationId, allowed, location: acc.id };
    const links = await h.links();
    const withUrl = (r: ListRow) => ({ ...r, url: r.contactId ? links.contact(r.locationId, r.contactId) : null, protectWords: r.protect ? PROTECT_WORDS[r.protect] : null });
    if (b === "csv") {
      const lines = [["Account", "Name", "Email", "Phone", "Owner", "Source", "Protected"].join(",")];
      const esc = (v: string | null) => { const s = (v ?? "").replace(/\r?\n/g, " "); const safe = /^[=+\-@\t]/.test(s) ? `'${s}` : s; return /[",]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
      let after = null as ReturnType<typeof decodeCursor>;
      for (let n = 0; n < 100; n++) {
        const p = await listKind(scope, kind, after, 200);
        for (const r of p.rows) lines.push([esc(r.locationName), esc(r.name), esc(r.email), esc(r.phone), esc(r.owner), esc(r.source), esc(r.protect ? PROTECT_WORDS[r.protect] : null)].join(","));
        after = p.next ? decodeCursor(p.next) : null;
        if (!after) break;
      }
      return new Response(lines.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="cleanup-${kind}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    const rawAfter = sp.get("after");
    const after = rawAfter ? decodeCursor(rawAfter) : null;
    if (rawAfter && !after) return json({ error: "That page address is not valid. Start again." }, 400);
    const page = await listKind(scope, kind, after, PAGE);
    // The total shown above the list: exact from the daily record when there is one, else a capped live count that says so.
    let total: CountCell | null = null;
    if (!after) {
      try { const d = await portfolioCounts(scope); if (d) total = { n: d.counts[kind], capped: false }; } catch (e) { if (!missing(e)) throw e; }
      if (!total) total = (await cappedCounts(scope))[kind];
    }
    return json({ kind, label: KIND_INFO[kind].label, plain: KIND_INFO[kind].plain, todo: KIND_INFO[kind].todo, total, rows: page.rows.map(withUrl), next: page.next, deal: isDealKind(kind) });
  }

  if (m === "GET" && b === "actions") {
    if (!bulk && !fix) return off();
    let rows = [] as Awaited<ReturnType<typeof recentActions>>;
    try { rows = await recentActions(ctx.installationId, allowed, 20); } catch (e) { if (!missing(e)) throw e; }
    return json({ rows });
  }

  if (m === "POST" && b === "scan") {
    if (!health) return off();
    if (!adminSide(ctx)) return json({ error: "Ask your administrator to run a scan." }, 403);
    try {
      const r = await sweep(ctx.installationId, 20_000, allowed);
      return json({ ...r });
    } catch (e) {
      if (missing(e)) return json({ error: "The clean-up record is not set up yet. It starts after the next update." }, 503);
      throw e;
    }
  }

  // ---- bulk: step "preview" changes nothing; step "do" needs the typed words ----
  if (!bulk) return off();
  if (!adminSide(ctx)) return json({ error: "Ask your administrator to change several contacts at once." }, 403);
  const body = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = body?.kind;
  const action = body?.action;
  const step = body?.step;
  if (!isKind(kind) || isDealKind(kind) || !CONTACT_KINDS.includes(kind)) return json({ error: "Choose a list of contacts" }, 400);
  if (action !== "tag" && action !== "remove") return json({ error: "Choose tag or remove" }, 400);
  if (action === "remove" && kind !== "junk") return json({ error: "Only junk and test contacts can be removed in bulk." }, 400);
  if (step !== "preview" && step !== "do") return json({ error: "Choose preview or do" }, 400);
  const location = await ownedLocation(ctx.installationId, allowed, body?.account);
  if (location === null) return notFoundAccount();
  const act: BulkAction = action;
  const optedIn = await writeEnabledFor(ctx.installationId, location);
  const mode = runMode({ switchOn, optedIn });

  const sel = await selectionFor({ inst: ctx.installationId, allowed, location }, kind, CAPS[act]);
  const safe = sel.filter((s) => s.protect === null && (act !== "remove" || s.junk)).slice(0, CAPS[act]);
  const held = sel.filter((s) => s.protect !== null);
  const byReason: Record<string, number> = {};
  for (const s of held) byReason[s.protect!] = (byReason[s.protect!] ?? 0) + 1;
  const phrase = confirmPhrase(act, safe.length, safe.length === 1 ? safe[0].name : null);

  if (step === "preview") {
    return json({
      kind, action: act, requested: safe.length, cap: CAPS[act], capped: sel.length > safe.length + held.length || safe.length === CAPS[act], protectedSkipped: held.length,
      protectedByReason: Object.entries(byReason).map(([reason, n]) => ({ reason, n, words: PROTECT_WORDS[reason as keyof typeof PROTECT_WORDS] })),
      sample: safe.slice(0, 8).map((s) => s.name), phrase, mode, modeWords: modeWords(mode, { switchOn, optedIn }), irreversible: act === "remove", warning: act === "remove" ? removeNote() : `Adds the tag "${REVIEW_TAG}" so you can find them in your CRM. Nothing is removed.`,
      notKnown: NOT_KNOWN_LINE,
    });
  }

  if (safe.length === 0) return json({ error: "There is nothing to change. Everything left is protected or already handled." }, 400);
  if (!typedMatches(body?.typed, phrase)) return json({ error: "The words do not match, so nothing was changed. Run the preview again and type the words exactly.", phrase }, 400);
  // The last look: re-read each contact at this moment and drop anyone who has become protected (or, for a removal, is no longer junk).
  const fresh = await readTargets(ctx.installationId, allowed, safe.map((s) => ({ locationId: s.locationId, contactId: s.contactId })));
  const ok = fresh.filter((f) => f.protect === null && f.locationId === location && (act !== "remove" || f.junk));
  const actor = h.actor(ctx);
  const res = await bulkViaGateway({ installationId: ctx.installationId, locationId: location, actor, optedIn, action: act, tag: REVIEW_TAG, contactIds: ok.map((o) => o.contactId), token: () => h.locationToken(location) });
  const skipped = held.length + (safe.length - ok.length);
  await logAction({ inst: ctx.installationId, location, kind, action: act, mode: res.mode, requested: ok.length, protectedSkipped: skipped, done: res.done, failed: res.failed, typedOk: true, actor }).catch(() => undefined);
  return json({
    mode: res.mode, requested: ok.length, done: res.done, failed: res.failed, protectedSkipped: skipped, needsPermission: res.needsPermission,
    message: res.mode === "dry_run" ? "Nothing was changed. " + modeWords("dry_run", { switchOn, optedIn }) : res.needsPermission ? "Needs permission: reconnect, then run it again." : `Done: ${res.done} changed${res.failed ? `, ${res.failed} failed` : ""}.`,
  });
}

export { DEAL_KINDS };
