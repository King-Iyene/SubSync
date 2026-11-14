import { BUILTIN, loadConfigs, writeEnabledFor } from "../analytics/cleanup-config";
import { pickFields } from "../analytics/cleanup-rules";
import { chooseSurvivor, groupKey, type Person } from "../analytics/dedupe";
import { loadDetailFacts, loadPeople, othersSharing, recordDecision } from "../analytics/dedupe-queries";
import { BULK_NOTE, planBulk, undoRecord } from "../dq/bulk-merge";
import { pickMaster } from "../dq/master-rank";
import { anyClearlyDiffer, guardrails } from "../analytics/dedupe-review";
import {
  certainSafe, countLeads, formDays, formsRollup, funnelsList, intakeAlertList, intakeAsOf, isLeadFlag, listEvents, listGroups, listLeads, listMutes, logEvent, pollStatus, portfolioQuality, scoreDetail, scoreTrend, scoresLatest,
  setMute, sourceByAccount, sourceDays, sourcesRollup, tierCounts, dqSweep, FLAG_LABEL, LEAD_FLAGS, type Scope,
} from "../analytics/dq-queries";
import { formHealth, funnelHealth, healthSettings, healthStatus, linkHealth, setHealthSettings } from "../analytics/dq-health-queries";
import { DEFAULT_DROP_PCT, DEFAULT_MIN_BASELINE, MAX_DROP_PCT, MIN_DROP_PCT, NO_VIEWS } from "../dq/health-core";
import { PROTECT_WORDS, NOT_KNOWN_LINE, typedMatches } from "../cleanup/cu-core";
import {
  BULK_MERGE_CAP, DELETE_CAP, DQ_DATE, DQ_VERSION, FORMULA_HOURS, MIN_LEADS, PAGE, TIERS, TIER_HINT, TIER_LABEL, bestWorst, bestWorstLine, bulkMergePhrase, decodeCur, deletePhrase, dialerHours, headlineOf, parseRange, qualityWhy,
  RANGES, zeroFill, isTier, EDGE_WHY, type SourceRow,
} from "../dq/dq-core";
import { bulkViaGateway, mergeViaWorkflow, planWorkflowMerge } from "../ghl/crm-gateway";
import { readTargets } from "../analytics/cu-queries";
import { isLive } from "../live-flags";
import { sql } from "../db";
import type { Feature } from "../entitlements";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import { ownedLocation } from "./tenant-guard";

// Clean-up v2 (stage DQ), under /api/app/dq/... (the one catch-all route, already guarded; the first segment "dq" is in the route policy).
// Who is asking and which client accounts they may see come from the verified session only (`allowed`). An account id from the request goes through ownedLocation before any query and is never
// echoed; a cursor is a strict shape; a source key, a tier and a range are parsed against fixed lists. Every list is a keyset page. Reads are open to everyone who can see the account; a merge,
// a delete or a bulk run is for an administrator, leaves out protected contacts, is capped, needs words that name the contact or the count, and is a dry run unless the server switch AND the
// account's own opt-in are on. SubSync sends a message only when a person presses Send, never on its own.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type DqHelpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>>; locationToken: (locationId: string) => Promise<string>; actor: (ctx: Ctx) => string | null };

const on = (ctx: Ctx, f: Feature) => ctx.entitlements.features[f] === true && !ctx.entitlements.locked.includes(f);
const off = () => json({ error: "This is not switched on for your account" }, 404);
const adminSide = (ctx: Ctx) => ctx.kind !== "client" || ctx.session.role === "admin";
const missing = (e: unknown) => { const c = (e as { code?: string } | null)?.code; return c === "42P01" || c === "42703"; };
const ID = /^[A-Za-z0-9_-]{3,128}$/;
const BULK_EVAL_CAP = 100;
/** One line in the audit log (who, what, the details). Never fails the request. */
const logAudit = async (inst: string, actor: string | null, action: string, detail: Record<string, unknown>) => { const db = sql(); await db`insert into audit_log (installation_id, actor, action, detail) values (${inst}, ${actor}, ${action}, ${db.json(detail as never)})`.catch(() => undefined); };
const SRC = /^[\x20-\x7e]{1,80}$/;

const GET = ["options", "overview", "dupes", "dupe", "intake", "intake-source", "leads", "accounts", "events", "form"];
const POST = ["decide", "delete", "bulk-merge", "mute", "scan", "health-settings"];

async function account(ctx: Ctx, allowed: string[] | null): Promise<{ ok: true; id: string | null } | { ok: false; res: Response }> {
  const v = ctx.url.searchParams.get("account");
  if (!v) return { ok: true, id: null };
  const id = await ownedLocation(ctx.installationId, allowed, v);
  return id === null ? { ok: false, res: json({ error: "That client account is not available" }, 404) } : { ok: true, id };
}
const srcParam = (ctx: Ctx): string | null | "bad" => {
  const v = ctx.url.searchParams.get("src");
  if (v === null || v === "") return null;
  return SRC.test(v) ? v.toLowerCase() : "bad";
};

export async function handleDq(ctx: Ctx, h: DqHelpers): Promise<Response | null> {
  const [, b] = ctx.segments;
  const m = ctx.request.method;
  if (!b) return null;
  if (!((m === "GET" && GET.includes(b)) || (m === "POST" && POST.includes(b)))) return null;
  const mod = on(ctx, "dq_module"), dupes = on(ctx, "dq_dupes"), intake = on(ctx, "dq_intake"), gate = on(ctx, "dq_gate"), score = on(ctx, "dq_score"), alerts = on(ctx, "dq_alerts");
  if (!mod && !dupes && !intake) return off();
  const allowed = await h.allowed();
  const sp = ctx.url.searchParams;
  const range = parseRange(sp.get("range")), days = RANGES[range];

  try {
    if (m === "GET" && b === "options") {
      const db = sql();
      const rows = await db`select location_id, name from locations where installation_id = ${ctx.installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} order by name limit 2000`;
      return json({
        flags: { module: mod, dupes, intake, gate, score, alerts }, canChange: adminSide(ctx), switchOn: isLive("WRITE_GHL_LIVE"), accounts: rows.map((r) => ({ id: r.location_id as string, name: (r.name as string | null) ?? "Unnamed account" })),
        tiers: TIERS.map((t) => ({ id: t, label: TIER_LABEL[t], hint: TIER_HINT[t] })), why: EDGE_WHY, caps: { delete: DELETE_CAP, bulkMerge: BULK_MERGE_CAP }, minLeads: MIN_LEADS, rules: { version: DQ_VERSION, date: DQ_DATE }, formula: FORMULA_HOURS, notKnown: NOT_KNOWN_LINE,
        flagLabels: Object.fromEntries(LEAD_FLAGS.map((f) => [f, FLAG_LABEL[f]])),
      });
    }

    // ---------------------------------------------------------------- overview
    if (m === "GET" && b === "overview") {
      const acc = await account(ctx, allowed);
      if (!acc.ok) return acc.res;
      const s: Scope = { inst: ctx.installationId, allowed, location: acc.id };
      const [pq, tiers, lanes, trend, worst, al] = await Promise.all([
        portfolioQuality(s), tierCounts(s), sourcesRollup(s, 30, 40), scoreTrend(s, 90), scoresLatest(s, null, 8, 0), intakeAlertList(s).catch(() => []),
      ]);
      const groups = tiers.certain.groups + tiers.likely.groups + tiers.possible.groups, extra = tiers.certain.extra + tiers.likely.extra + tiers.possible.extra;
      const badPhones = pq?.counts.badPhone ?? 0;
      const q = pq?.q ?? null;
      const bw = bestWorst(lanes as SourceRow[]);
      const asOf = await intakeAsOf(s);
      return json({
        asOf, accounts: pq?.accounts ?? null, headline: pq ? headlineOf({ groups, badPhones, dupExtra: extra }) : null, hours: dialerHours({ badPhones, dupExtra: extra }), formula: FORMULA_HOURS,
        numbers: { groups, extra, badPhones, junk: pq?.counts.junk ?? 0, badEmail: pq?.counts.badEmail ?? 0, contacts: pq?.counts.contacts ?? 0 },
        tiers, quality: q && score ? { score: q.score, word: q.word, why: qualityWhy(q), parts: q.parts, note: q.note, version: q.version } : null, trend: score ? trend : [],
        worst: score ? worst.rows.map((r) => ({ locationId: r.locationId, name: r.name, score: r.score, contacts: r.contacts })) : [], worstTotal: worst.total,
        gate: gate ? { lanes: lanes.map((l) => ({ key: l.key, label: l.label, leads: l.leads, dups: l.dups, junk: l.junk })), groups, days: 30 } : null,
        best: intake ? { line: bestWorstLine(bw), best: bw.best?.label ?? null, worst: bw.worst?.label ?? null, note: bw.note } : null,
        alerts: alerts ? al.filter((a) => !a.muted).slice(0, 4).map((a) => ({ kind: a.kind, title: a.title, account: a.locationName, locationId: a.locationId, key: a.key })) : [], alertCount: alerts ? al.filter((a) => !a.muted).length : 0,
      });
    }

    // ---------------------------------------------------------------- duplicates
    if (m === "GET" && b === "dupes") {
      if (!dupes) return off();
      const acc = await account(ctx, allowed);
      if (!acc.ok) return acc.res;
      const tier = sp.get("tier") ?? "certain";
      if (!isTier(tier)) return json({ error: "Choose certain, likely or possible" }, 400);
      const rawAfter = sp.get("after");
      const after = rawAfter ? decodeCur(rawAfter, 2) : null;
      if (rawAfter && !after) return json({ error: "That page address is not valid. Start again." }, 400);
      const s: Scope = { inst: ctx.installationId, allowed, location: acc.id };
      const [counts, page, links] = await Promise.all([after ? Promise.resolve(null) : tierCounts(s), listGroups(s, tier, after, PAGE), h.links()]);
      return json({
        tier, counts, next: page.next,
        rows: page.rows.map((r) => ({ ...r, why: r.kinds.map((k) => EDGE_WHY[k as keyof typeof EDGE_WHY]).filter(Boolean), people: r.people.map((p) => ({ ...p, url: links.contact(r.locationId, p.contactId), protectWords: p.protect ? PROTECT_WORDS[p.protect] : null })) })),
      });
    }

    if (m === "GET" && b === "dupe") {
      if (!dupes) return off();
      const loc = await ownedLocation(ctx.installationId, allowed, sp.get("account"));
      if (loc === null) return json({ error: "That client account is not available" }, 404);
      const ids = (sp.get("ids") ?? "").split(",").filter(Boolean);
      if (ids.length < 2 || ids.length > 10 || ids.some((i) => !ID.test(i))) return json({ error: "Send the contacts in the group" }, 400);
      const loaded = await loadPeople(ctx.installationId, allowed, loc, ids);
      if (!loaded) return json({ error: "Those contacts were not found" }, 404);
      const links = await h.links();
      const people = loaded.people;
      // The master is chosen by the SAME function the screen uses (master-rank.ts). chooseSurvivor only fills the wording of the preview when nobody is suggested (the person chooses).
      const master = pickMaster(people);
      const keepId = master.suggestedId ?? chooseSurvivor(people).contactId;
      const facts = await loadDetailFacts(ctx.installationId, allowed, loc, ids);
      const cfg = (await loadConfigs(ctx.installationId, allowed)).get(loc) ?? BUILTIN;
      const optedIn = ctx.demo || (await writeEnabledFor(ctx.installationId, loc));
      const others = people.length === 2 ? await othersSharing(ctx.installationId, loc, ids) : 0;
      const wf = planWorkflowMerge(people, keepId, { workflowId: cfg.mergeWorkflowId, others });
      const gone = people.find((p) => p.contactId === wf.enrolId);
      return json({
        locationId: loc, locationName: loaded.locationName, key: groupKey(ids), keepId, different: anyClearlyDiffer(people),
        master: { suggestedId: master.suggestedId, mustChoose: master.mustChoose, why: master.why },
        people: people.map((p) => ({ ...p, facts: facts?.[p.contactId], url: links.contact(loc, p.contactId), protectWords: p.dnd ? PROTECT_WORDS.dnd : p.openDeals > 0 ? PROTECT_WORDS.open_deal : p.nextAppointmentAt ? PROTECT_WORDS.appointment : null })),
        guard: guardrails(people, keepId).map((g) => g.text), picks: pickFields(people, keepId, cfg.survive),
        workflow: { set: !!cfg.mergeWorkflowId, optedIn, canAsk: ctx.kind !== "client", blockers: wf.blockers.map((x) => x.text), goneName: gone?.name ?? null, survivorId: wf.survivorId, switchOn: !ctx.demo && isLive("WRITE_GHL_LIVE") },
      });
    }

    if (m === "POST" && b === "decide") {
      if (!dupes) return off();
      const body = (await ctx.request.json().catch(() => null)) as { locationId?: unknown; contactIds?: unknown; decision?: unknown; keepContactId?: unknown } | null;
      const loc = await ownedLocation(ctx.installationId, allowed, body?.locationId);
      const ids = Array.isArray(body?.contactIds) ? (body.contactIds as unknown[]) : [];
      if (loc === null) return json({ error: "That client account is not available" }, 404);
      if (ids.length < 2 || ids.length > 10 || ids.some((i) => typeof i !== "string" || !ID.test(i))) return json({ error: "Send the contacts in the group" }, 400);
      const decision = body?.decision;
      if (decision !== "not_duplicate" && decision !== "keep" && decision !== "merged_in_platform") return json({ error: "Unknown choice" }, 400);
      const keep = typeof body?.keepContactId === "string" ? body.keepContactId : null;
      if (decision === "merged_in_platform" && (!keep || !ids.includes(keep))) return json({ error: "Choose the record you kept" }, 400);
      const contactIds = [...new Set(ids as string[])];
      const actor = h.actor(ctx);
      const r = await recordDecision(ctx.installationId, allowed, actor, { locationId: loc, key: groupKey(contactIds), decision, keepContactId: decision === "not_duplicate" ? null : keep, contactIds });
      if (r !== "ok") return json({ error: "Those contacts were not found" }, 404);
      await sql()`delete from dq_groups where installation_id = ${ctx.installationId} and location_id = ${loc} and group_key = ${groupKey(contactIds)}`;
      await logEvent(ctx.installationId, loc, "dup_decided", groupKey(contactIds), { decision, size: contactIds.length }, actor).catch(() => undefined);
      return json({ ok: true });
    }

    if (m === "POST" && b === "delete") {
      if (!dupes) return off();
      if (!adminSide(ctx)) return json({ error: "Ask your administrator to delete contacts." }, 403);
      const body = (await ctx.request.json().catch(() => null)) as { step?: unknown; locationId?: unknown; contactIds?: unknown; keepContactId?: unknown; typed?: unknown } | null;
      const loc = await ownedLocation(ctx.installationId, allowed, body?.locationId);
      if (loc === null) return json({ error: "That client account is not available" }, 404);
      const ids = Array.isArray(body?.contactIds) ? (body.contactIds as unknown[]) : [];
      const keep = typeof body?.keepContactId === "string" ? body.keepContactId : "";
      if (ids.length < 2 || ids.length > 10 || ids.some((i) => typeof i !== "string" || !ID.test(i)) || !ids.includes(keep)) return json({ error: "Send the group and the record to keep" }, 400);
      const step = body?.step;
      if (step !== "preview" && step !== "do") return json({ error: "Choose preview or do" }, 400);
      const wanted = (ids as string[]).filter((i) => i !== keep).slice(0, DELETE_CAP);
      // Protection is re-read from our copy at this moment: do not disturb, an open deal, a coming appointment. A record with a conversation or a won deal is kept too: deleting it loses history.
      const fresh = await readTargets(ctx.installationId, allowed, wanted.map((contactId) => ({ locationId: loc, contactId })));
      const hist = await sql()`select c.contact_id, exists (select 1 from cached_conversations v where v.installation_id = c.installation_id and v.location_id = c.location_id and v.contact_id = c.contact_id) conv,
          exists (select 1 from cached_opportunities o where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id and o.status = 'won') won
        from cached_contacts c where c.installation_id = ${ctx.installationId} and c.location_id = ${loc} and c.contact_id = any(${wanted}::text[])`;
      const history = new Set(hist.filter((r) => r.conv === true || r.won === true).map((r) => r.contact_id as string));
      const safe = fresh.filter((f) => f.protect === null && !history.has(f.contactId));
      const held = fresh.length - safe.length;
      const optedIn = await writeEnabledFor(ctx.installationId, loc);
      const switchOn = isLive("WRITE_GHL_LIVE");
      const mode = switchOn && optedIn ? "live" : "dry_run";
      const phrase = deletePhrase(safe.length, safe.length === 1 ? safe[0].name : null);
      if (step === "preview") {
        return json({ requested: safe.length, protectedSkipped: held, names: safe.slice(0, 5).map((s) => s.name), phrase, mode, irreversible: true, warning: "This cannot be undone. A deleted contact does not come back.",
          notes: held > 0 ? ["Left out: contacts on Do Not Disturb, with an open deal, a coming appointment, a conversation or a won deal. Merge those in your CRM instead."] : [], notKnown: NOT_KNOWN_LINE });
      }
      if (safe.length === 0) return json({ error: "Nothing can be deleted here. Everything left is protected or has history." }, 400);
      if (!typedMatches(body?.typed, phrase)) return json({ error: "The words do not match, so nothing was deleted.", phrase }, 400);
      const actor = h.actor(ctx);
      const res = await bulkViaGateway({ installationId: ctx.installationId, locationId: loc, actor, optedIn, action: "remove", contactIds: safe.map((s) => s.contactId), token: () => h.locationToken(loc) });
      await logEvent(ctx.installationId, loc, "dup_delete", groupKey(ids as string[]), { mode: res.mode, requested: safe.length, done: res.done, failed: res.failed, protectedSkipped: held }, actor).catch(() => undefined);
      return json({ mode: res.mode, requested: safe.length, done: res.done, failed: res.failed, needsPermission: res.needsPermission, message: res.mode === "dry_run" ? (!switchOn ? "Not switched on yet: nothing was deleted." : "Changing contacts is not switched on for this client account in Settings, so nothing was deleted.") : res.needsPermission ? "Needs permission: reconnect, then run it again." : `Done: ${res.done} deleted${res.failed ? `, ${res.failed} failed` : ""}.` });
    }

    if (m === "POST" && b === "bulk-merge") {
      if (!dupes) return off();
      if (!adminSide(ctx)) return json({ error: "Ask your administrator to merge several groups at once." }, 403);
      const body = (await ctx.request.json().catch(() => null)) as { step?: unknown; account?: unknown; typed?: unknown } | null;
      const step = body?.step;
      if (step !== "preview" && step !== "do") return json({ error: "Choose preview or do" }, 400);
      let location: string | null = null;
      if (body?.account) { location = await ownedLocation(ctx.installationId, allowed, body.account); if (location === null) return json({ error: "That client account is not available" }, 404); }
      const s: Scope = { inst: ctx.installationId, allowed, location };
      // Every certain group is judged (protected ones too, so the list can say why they were skipped). The rules and the ranking are in dq/bulk-merge.ts and dq/master-rank.ts, shared with the screen.
      const groups = await certainSafe(s, BULK_EVAL_CAP, true);
      const cfgs = await loadConfigs(ctx.installationId, allowed);
      const switchOn = isLive("WRITE_GHL_LIVE");
      type Item = { key: string; locationId: string; locationName: string | null; people: Person[]; workflowSurvivorId: string | null; blocker: string | null };
      const items: Item[] = [];
      const early: Array<{ key: string; locationId: string; account: string | null; names: string[]; why: string }> = [];
      for (const g of groups) {
        const names = g.people.map((p) => p.name);
        if (g.trimmed) { early.push({ key: g.key, locationId: g.locationId, account: g.locationName, names, why: "This group was cut short because it has too many copies. Check it yourself." }); continue; }
        const loaded = await loadPeople(ctx.installationId, allowed, g.locationId, g.people.map((p) => p.contactId));
        if (!loaded) { early.push({ key: g.key, locationId: g.locationId, account: g.locationName, names, why: "These contacts changed since the last scan. Run a scan, then try again." }); continue; }
        const cfg = cfgs.get(g.locationId) ?? BUILTIN;
        const others = loaded.people.length === 2 ? await othersSharing(ctx.installationId, g.locationId, g.people.map((p) => p.contactId)) : 0;
        const wf = planWorkflowMerge(loaded.people, loaded.people[0]?.contactId ?? "", { workflowId: cfg.mergeWorkflowId, others });
        items.push({ key: g.key, locationId: g.locationId, locationName: g.locationName, people: loaded.people, workflowSurvivorId: wf.survivorId || null, blocker: wf.blockers[0]?.text ?? null });
      }
      // The workflow's own blockers (no workflow set, another contact shares the number, ...) skip a pair before the ranking is even asked.
      const judged = planBulk(items.filter((i) => !i.blocker), BULK_MERGE_CAP, {});
      const skipped = [...early, ...items.filter((i) => i.blocker).map((i) => ({ key: i.key, locationId: i.locationId, account: i.locationName, names: i.people.map((p) => p.name), why: i.blocker! })), ...judged.skipped];
      const optedCache = new Map<string, boolean>();
      for (const w of judged.willItems) if (!optedCache.has(w.locationId)) optedCache.set(w.locationId, ctx.demo || (await writeEnabledFor(ctx.installationId, w.locationId)));
      const mode = switchOn && [...optedCache.values()].some(Boolean) ? "live" : "dry_run";
      const phrase = bulkMergePhrase(judged.will.length);
      if (step === "preview") {
        return json({ ready: judged.will.length, blocked: skipped.length, cap: BULK_MERGE_CAP, phrase, mode, will: judged.will.slice(0, 100), skipped: skipped.slice(0, 200), note: BULK_NOTE });
      }
      if (judged.will.length === 0) return json({ error: "There is nothing safe to merge." }, 400);
      if (!typedMatches(body?.typed, phrase)) return json({ error: "The words do not match, so nothing was merged.", phrase }, 400);
      const actor = h.actor(ctx);
      let requested = 0, switchedOff = 0, optedOut = 0, failed = 0, refused = 0;
      for (const w of judged.willItems) {
        const optedIn = optedCache.get(w.locationId) === true;
        // The pair is judged again right before the write, from a fresh read: something may have changed since the preview.
        const fresh = await loadPeople(ctx.installationId, allowed, w.locationId, w.people.map((p) => p.contactId));
        const again = fresh ? planBulk([{ key: w.key, locationId: w.locationId, locationName: w.locationName, people: fresh.people }], 1, {}) : null;
        if (!fresh || !again || again.will.length !== 1 || again.willItems[0].keepId !== w.keepId) { refused++; await logAudit(ctx.installationId, actor, "duplicates.bulk_merge_refused", { locationId: w.locationId, key: w.key, reason: "Changed since the preview" }); continue; }
        const r = await mergeViaWorkflow({
          installationId: ctx.installationId, locationId: w.locationId, actor, optedIn, workflowId: (cfgs.get(w.locationId) ?? BUILTIN).mergeWorkflowId, people: fresh.people, pickedKeepId: w.keepId, others: 0, confirmed: true,
          token: () => h.locationToken(w.locationId), workflowPublished: null,
        }, ctx.demo ? { env: {} } : {});
        if (r.outcome === "requested") requested++; else if (r.outcome === "switched_off") switchedOff++; else if (r.outcome === "opted_out") optedOut++; else failed++;
        // Every merge, sent or not, is written down with the reason and what is needed to undo it by hand.
        await logAudit(ctx.installationId, actor, "duplicates.bulk_merge", { locationId: w.locationId, key: w.key, outcome: r.outcome, mode, ...undoRecord({ people: fresh.people, keepId: w.keepId, goneId: w.goneId, why: w.why }) });
      }
      await logEvent(ctx.installationId, location, "bulk_merge", null, { mode, ready: judged.will.length, requested, switchedOff, optedOut, failed, refused }, actor).catch(() => undefined);
      return json({ mode, ready: judged.will.length, requested, failed, refused, message: requested > 0 ? `Sent ${requested} to your merge workflow. They leave this list after the next refresh.${refused ? ` ${refused} changed since the preview and were left alone.` : ""}` : "Not switched on yet: nothing was merged. The plan is recorded in the history as a dry run." });
    }

    // ---------------------------------------------------------------- lead intake
    if (m === "GET" && (b === "intake" || b === "intake-source" || b === "leads" || b === "form")) {
      if (!intake) return off();
      const acc = await account(ctx, allowed);
      if (!acc.ok) return acc.res;
      const s: Scope = { inst: ctx.installationId, allowed, location: acc.id };
      const src = srcParam(ctx);
      if (src === "bad") return json({ error: "That source is not valid" }, 400);

      if (b === "intake") {
        const [rows, forms, funnels, al, status, asOf, mutes] = await Promise.all([sourcesRollup(s, days), formsRollup(s, days).catch((e) => { if (missing(e)) return []; throw e; }), funnelsList(s).catch(() => []), intakeAlertList(s).catch(() => []), pollStatus(s).catch(() => ({ forms: "never" as const, at: null })), intakeAsOf(s), listMutes(s)]);
        const bw = bestWorst(rows as SourceRow[]);
        const total = rows.reduce((t, r) => t + r.leads, 0);
        // Lead intake health: low applications per form and survey, funnel pages, redirects and trigger links. Each part says why it is empty (needs permission, not read yet, no data).
        const hs = await healthSettings(ctx.installationId);
        const [hForms, hFunnels, hLinks, hStatus] = await Promise.all([
          formHealth(s, hs).catch((e) => { if (missing(e)) return []; throw e; }), funnelHealth(s).catch(() => []), linkHealth(s).catch(() => ({ rows: [], total: 0, empty: 0 })), healthStatus(s).catch(() => null),
        ]);
        const health = { settings: { ...hs, defaultDropPct: DEFAULT_DROP_PCT, defaultMinBaseline: DEFAULT_MIN_BASELINE, minDropPct: MIN_DROP_PCT, maxDropPct: MAX_DROP_PCT }, canChange: adminSide(ctx), forms: hForms, funnels: hFunnels, links: hLinks, status: hStatus, viewsNote: NO_VIEWS };
        return json({
          health,
          range, days, asOf, minLeads: MIN_LEADS, total, sources: rows, best: bw.best?.label ?? null, worst: bw.worst?.label ?? null, line: bestWorstLine(bw), note: bw.note,
          forms, funnels, formsStatus: status, alerts: alerts ? al : [], mutes, canMute: adminSide(ctx),
          funnelNote: "Views, opt-ins and conversion rates of funnels: Not available from the platform yet. SubSync shows the funnel's structure and the leads whose source carries its name.",
          matchNote: "Money is counted from won deals linked to the person: the deal must be on the same contact.",
        });
      }

      if (b === "intake-source") {
        if (src === null) return json({ error: "Choose a source" }, 400);
        const [series, perAccount, all] = await Promise.all([sourceDays(s, Math.max(days, 35), src), sourceByAccount(s, days, src), sourcesRollup(s, days)]);
        const me = all.find((r) => r.key === src);
        if (!me) return json({ error: "No leads from that source in this range" }, 404);
        const al = (await intakeAlertList(s).catch(() => [])).filter((a) => a.key === src);
        return json({ key: src, label: me.label, counts: me, trend: zeroFill(series, new Date().toISOString().slice(0, 10), Math.max(days, 35)), perAccount, alerts: alerts ? al : [], days });
      }

      if (b === "form") {
        const kind = sp.get("kind"), id = sp.get("id"), loc = sp.get("loc");
        if ((kind !== "form" && kind !== "survey") || !id || !ID.test(id)) return json({ error: "Choose a form" }, 400);
        const l = await ownedLocation(ctx.installationId, allowed, loc);
        if (l === null) return json({ error: "That client account is not available" }, 404);
        const series = await formDays(s, kind, id, l, Math.max(days, 35));
        return json({ trend: zeroFill(series, new Date().toISOString().slice(0, 10), Math.max(days, 35)) });
      }

      // leads: the people behind any number
      const flag = sp.get("flag") ?? "all";
      if (!isLeadFlag(flag)) return json({ error: "Choose one of the lists" }, 400);
      const rawAfter = sp.get("after");
      const after = rawAfter ? decodeCur(rawAfter, 3) : null;
      if (rawAfter && !after) return json({ error: "That page address is not valid. Start again." }, 400);
      const links = await h.links();
      const fp = (sp.get("form") ?? "").split(":");
      const form = fp.length === 2 && (fp[0] === "form" || fp[0] === "survey") && ID.test(fp[1]) ? { kind: fp[0] as "form" | "survey", id: fp[1] } : null;
      if (sp.get("form") && !form) return json({ error: "That form is not valid" }, 400);
      const f = { src, flag, days, form };
      const [page, total] = await Promise.all([listLeads(s, f, after, PAGE), after ? Promise.resolve(null) : countLeads(s, f)]);
      return json({ flag, label: FLAG_LABEL[flag], total, next: page.next, rows: page.rows.map((r) => ({ ...r, url: links.contact(r.locationId, r.contactId) })) });
    }

    if (m === "POST" && b === "mute") {
      if (!alerts) return off();
      if (!adminSide(ctx)) return json({ error: "Ask your administrator to mute alerts." }, 403);
      const body = (await ctx.request.json().catch(() => null)) as { account?: unknown; src?: unknown; on?: unknown; days?: unknown } | null;
      const loc = await ownedLocation(ctx.installationId, allowed, body?.account);
      if (loc === null) return json({ error: "That client account is not available" }, 404);
      const src = typeof body?.src === "string" && SRC.test(body.src) ? body.src.toLowerCase() : "*";
      const days = typeof body?.days === "number" && body.days > 0 && body.days <= 365 ? Math.floor(body.days) : null;
      return (await setMute(ctx.installationId, allowed, loc, src, body?.on !== false, days, h.actor(ctx))) ? json({ ok: true }) : json({ error: "That client account is not available" }, 404);
    }

    if (m === "POST" && b === "health-settings") {
      if (!intake) return off();
      if (!adminSide(ctx)) return json({ error: "Ask your administrator to change this." }, 403);
      const body = (await ctx.request.json().catch(() => null)) as { dropPct?: unknown; minBaseline?: unknown } | null;
      const d = Number(body?.dropPct), b2 = Number(body?.minBaseline);
      if (!Number.isFinite(d) || d < MIN_DROP_PCT || d > MAX_DROP_PCT) return json({ error: `Choose a drop between ${MIN_DROP_PCT}% and ${MAX_DROP_PCT}%.` }, 400);
      if (!Number.isFinite(b2) || b2 < 1 || b2 > 100) return json({ error: "Choose a smallest usual week between 1 and 100." }, 400);
      const saved = await setHealthSettings(ctx.installationId, d, b2, h.actor(ctx));
      await logAudit(ctx.installationId, h.actor(ctx), "dq.health_settings", { ...saved }).catch(() => undefined);
      return json({ ok: true, ...saved });
    }

    // ---------------------------------------------------------------- scores, history, scan
    if (m === "GET" && b === "accounts") {
      if (!score) return off();
      const q = (sp.get("q") ?? "").trim().slice(0, 60) || null;
      const page = Math.max(0, Math.min(1000, Math.floor(Number(sp.get("page")) || 0)));
      const size = 10;
      const res = await scoresLatest({ inst: ctx.installationId, allowed, location: null }, q, size, page * size);
      const rows = await Promise.all(res.rows.map(async (r) => { const d = await scoreDetail(ctx.installationId, r.locationId).catch(() => null); return { locationId: r.locationId, name: r.name, day: r.day, score: r.score, word: d?.word ?? null, why: d ? qualityWhy(d) : "", contacts: r.contacts }; }));
      return json({ total: res.total, page, pages: Math.max(1, Math.ceil(res.total / size)), rows });
    }
    if (m === "GET" && b === "events") {
      const rawAfter = sp.get("after");
      const after = rawAfter ? Number(rawAfter) : null;
      if (rawAfter && !(Number.isInteger(after) && (after as number) > 0)) return json({ error: "That page address is not valid. Start again." }, 400);
      const acc = await account(ctx, allowed);
      if (!acc.ok) return acc.res;
      const r = await listEvents({ inst: ctx.installationId, allowed, location: acc.id }, after, 30);
      return json({ rows: r.rows.map((e) => ({ ...e, actor: ctx.kind === "client" ? null : e.actor })), next: r.next });
    }
    if (m === "POST" && b === "scan") {
      if (!adminSide(ctx)) return json({ error: "Ask your administrator to run a scan." }, 403);
      return json({ ...(await dqSweep(ctx.installationId, 20_000, allowed, true)) });
    }
  } catch (e) {
    if (missing(e)) return json({ error: "The data quality record is not set up yet. It starts after the next update." }, 503);
    throw e;
  }
  return null;
}
