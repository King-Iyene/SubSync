import { chooseSurvivor, groupKey, type Person } from "../analytics/dedupe";
import { builtQueue, decisionSets, forgetQueue, loadPeople, overview, recordDecision, snoozeGroup, unsnoozeGroup, type Built } from "../analytics/dedupe-queries";
import {
  anyClearlyDiffer, explainSurvivor, guardrails, likelihood, pageOf, parseSort, parseStatus, reasonOf, selectGroups, type ReasonKey,
} from "../analytics/dedupe-review";
import { mergeContacts } from "../ghl/crm-merge";
import { isLive } from "../live-flags";
import type { deepLinks } from "../links";
import { sql } from "../db";
import { json, type AuthContext } from "./auth";

// The guided duplicate review's endpoints, under /api/app/duplicates/... (the one catch-all route, already guarded). Each handler derives who is asking from the
// verified session (`ctx`), limits every read and every decision to the accounts that caller may see (`allowed`), and never takes an installation or a
// token from the browser. Two accounts are never compared or merged: a group is always inside ONE account, and the contacts in a request are re-read from
// that account before anything is recorded.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };

export type DuplicatesHelpers = {
  allowed: () => Promise<string[] | null>;
  links: () => Promise<ReturnType<typeof deepLinks>>;
  /** The token for one account. Only called when the merge switch is on. */
  locationToken: (locationId: string) => Promise<string>;
};

const ID = /^[A-Za-z0-9_-]{3,64}$/;
const REASONS = new Set<string>(["both", "email", "phone", "name"]);
const int = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };
const actorOf = (ctx: Ctx) => ctx.session.userName ?? ctx.session.userId ?? null;

type Item = Built["all"][number];

/** Client accounts that still let a duplicate be created (the platform tells us per account). A short list: the names, never every account. */
async function protectionFor(installationId: string, allowed: string[] | null) {
  const db = sql();
  const rows = await db`select location_id, name from locations where installation_id = ${installationId} and not ignored and allow_duplicate_contact is true ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} order by name limit 200`;
  return { allowing: rows.length, names: rows.slice(0, 8).map((r) => (r.name as string | null) ?? "Unnamed account") };
}

/** One line of a list: light, so a page of 25 is a few kilobytes. */
function rowOf(g: Item, sets: Awaited<ReturnType<typeof decisionSets>>) {
  const id = `${g.locationId}:${g.key}`;
  const names = [...new Set(g.people.map((p) => p.name))];
  const review = sets.reviews.get(id) ?? null;
  return {
    key: g.key, locationId: g.locationId, locationName: g.locationName, size: g.people.length,
    names: names.slice(0, 3), moreNames: Math.max(0, names.length - 3),
    reason: reasonOf(g), likelihood: likelihood(g.confidence), openDeals: g.people.reduce((s, p) => s + p.openDeals, 0),
    warn: guardrails(g.people, g.survivorId).length > 0, obvious: g.obvious,
    decision: review ? { kind: review.decision, at: review.decidedAt } : null, until: sets.later.get(id) ?? null,
  };
}

async function overviewRoute(ctx: Ctx, h: DuplicatesHelpers): Promise<Response> {
  const sp = ctx.url.searchParams;
  const status = parseStatus(sp.get("status"));
  const q = (sp.get("q") ?? "").slice(0, 80);
  const reasonP = sp.get("reason");
  const reason = reasonP && REASONS.has(reasonP) ? (reasonP as ReasonKey) : null;
  const locP = sp.get("location");
  const location = locP && ID.test(locP) ? locP : null;
  const sort = parseSort(sp.get("sort"));
  const allowed = await h.allowed();
  const [built, sets, links] = await Promise.all([builtQueue(ctx.installationId, allowed), decisionSets(ctx.installationId), h.links()]);
  const now = Date.now();
  const base = { decided: sets.decided, later: new Set(sets.later.keys()), now };

  // The header numbers come from the whole open list (one counting rule); the list and the stepper walk the chosen selection.
  const open = selectGroups(built.all, { ...base, status: "open" });
  const listSize = [...built.listSizes.values()].reduce((s, n) => s + n, 0);
  const ov = overview(open, listSize);
  const selection = selectGroups(built.all, { ...base, status, q, reason, location, sort });
  const list = pageOf(selection, int(sp.get("page"), 0), int(sp.get("size"), 25));
  // `focus` is a group the person picked from a list (`account:key`): the stepper opens on it, wherever it sits in the selection.
  const focus = sp.get("focus");
  const focusAt = focus && /^[A-Za-z0-9_-]{3,64}:[0-9a-f]{8}-d{1,3}$/.test(focus) ? selection.findIndex((g) => `${g.locationId}:${g.key}` === focus) : -1;

  // The clients with groups: a short list, searchable and paged for an agency with many accounts. A single-account caller never gets it.
  const an = ov.accounts.length > 1 ? ov.accounts : [];
  const aq = (sp.get("aq") ?? "").trim().toLowerCase().slice(0, 60);
  const accounts = pageOf(aq ? an.filter((a) => (a.name ?? "").toLowerCase().includes(aq)) : an, int(sp.get("ap"), 0), Math.min(10, Math.max(1, int(sp.get("an"), 5))));

  // The group on screen, in full.
  const i = selection.length === 0 ? 0 : focusAt >= 0 ? focusAt : Math.min(Math.max(0, int(sp.get("i"), 0)), selection.length - 1);
  const g = selection[i] as Item | undefined;
  let step: unknown = null;
  if (g) {
    const detail = await loadPeople(ctx.installationId, allowed, g.locationId, g.people.map((p) => p.contactId));
    const people: Person[] = detail?.people ?? g.people;
    const keepId = chooseSurvivor(people).contactId;
    const review = sets.reviews.get(`${g.locationId}:${g.key}`) ?? null;
    step = {
      key: g.key, locationId: g.locationId, locationName: detail?.locationName ?? g.locationName, reason: reasonOf(g), likelihood: likelihood(g.confidence), confidence: g.confidence,
      survivorId: keepId, why: explainSurvivor(people, keepId), obvious: g.obvious, review: review ? { kind: review.decision, at: review.decidedAt, keepContactId: review.keepContactId } : null,
      until: sets.later.get(`${g.locationId}:${g.key}`) ?? null, watchingSince: detail?.watchingSince ?? null, enriched: !!detail,
      people: people.map((p) => ({ ...p, url: links.contact(g.locationId, p.contactId) })),
    };
  }

  return json({
    health: ov.health, byReason: ov.byReason, obvious: ov.obvious, truncated: built.truncated,
    multi: ov.accounts.length > 1 || (ctx.kind === "agency" && !ctx.limitTo),
    counts: { open: open.length, later: selectGroups(built.all, { ...base, status: "later" }).length, decided: selectGroups(built.all, { ...base, status: "decided" }).length },
    protection: await protectionFor(ctx.installationId, allowed), canExport: ctx.kind !== "client",
    accounts, status, mergeSwitchedOff: ctx.demo || !isLive("WRITE_GHL_LIVE"),
    // An account id is echoed only when it is one of the caller's own accounts, so a request can never make the answer name another company's account.
    selection: { total: selection.length, i, status, q, reason, location: location && built.listSizes.has(location) ? location : null, sort },
    list: { ...list, rows: list.rows.map((r) => rowOf(r as Item, sets)) },
    // The next five groups after the one on screen: what a person sees under the stepper before they ask for the whole list.
    upNext: selection.slice(i + 1, i + 6).map((r) => rowOf(r as Item, sets)),
    step,
  });
}

/** The exact matches (same email AND same phone) as one list to look at. Nothing is changed by reading it. */
async function obviousRoute(ctx: Ctx, h: DuplicatesHelpers): Promise<Response> {
  const sp = ctx.url.searchParams;
  const allowed = await h.allowed();
  const [built, sets] = await Promise.all([builtQueue(ctx.installationId, allowed), decisionSets(ctx.installationId)]);
  const open = selectGroups(built.all, { decided: sets.decided, later: new Set(sets.later.keys()), status: "open", now: Date.now() }).filter((g) => g.obvious);
  const page = pageOf(open, int(sp.get("page"), 0), 25);
  const rows = page.rows.map((g) => {
    const keep = g.people.find((p) => p.contactId === g.survivorId)!;
    const rest = g.people.filter((p) => p.contactId !== g.survivorId);
    return {
      key: g.key, locationId: g.locationId, locationName: g.locationName, keep: { name: keep.name, email: keep.email, phone: keep.phone },
      remove: rest.map((p) => ({ name: p.name, email: p.email, phone: p.phone })), tagsAdded: [...new Set(rest.flatMap((p) => p.tags))].filter((t) => !keep.tags.includes(t)),
    };
  });
  return json({ ...page, rows, switchedOff: ctx.demo || !isLive("WRITE_GHL_LIVE") });
}

type GroupBody = { locationId: string; contactIds: string[]; keepContactId: string | null };

async function readGroup(ctx: Ctx): Promise<GroupBody | Response> {
  const body = (await ctx.request.json().catch(() => null)) as { locationId?: unknown; contactIds?: unknown; keepContactId?: unknown } | null;
  const ids = Array.isArray(body?.contactIds) ? body.contactIds : [];
  if (typeof body?.locationId !== "string" || !ID.test(body.locationId) || ids.length < 2 || ids.length > 40 || ids.some((i) => typeof i !== "string" || !ID.test(i))) {
    return json({ error: "Send the account and the contacts in the group" }, 400);
  }
  const contactIds = [...new Set(ids as string[])];
  if (contactIds.length !== ids.length) return json({ error: "The same contact is listed twice" }, 400);
  const keepContactId = typeof body.keepContactId === "string" ? body.keepContactId : null;
  if (keepContactId && !contactIds.includes(keepContactId)) return json({ error: "The record to keep is not in the group" }, 400);
  return { locationId: body.locationId, contactIds, keepContactId };
}

async function snoozeRoute(ctx: Ctx, h: DuplicatesHelpers, undo: boolean): Promise<Response> {
  const g = await readGroup(ctx);
  if (g instanceof Response) return g;
  const key = groupKey(g.contactIds);
  const allowed = await h.allowed();
  if (undo) {
    return (await unsnoozeGroup(ctx.installationId, allowed, actorOf(ctx), g.locationId, key)) ? json({ ok: true }) : json({ error: "Nothing was set aside" }, 404);
  }
  const r = await snoozeGroup(ctx.installationId, allowed, actorOf(ctx), { locationId: g.locationId, key, contactIds: g.contactIds });
  forgetQueue(ctx.installationId);
  return r === "ok" ? json({ ok: true, days: 7 }) : json({ error: "Those contacts were not found" }, 404);
}

/**
 * The one-click merge. It is SWITCHED OFF (WRITE_GHL_LIVE is false, and the demo never writes): the answer says what would have been done and records one
 * "WOULD WRITE" audit line. The platform's public API has no merge endpoint, so even when switched on it refuses to merge a record that carries a
 * conversation, deals, appointments or a Do Not Disturb mark (see src/lib/ghl/crm-merge.ts and docs/features/DUPLICATES.md).
 */
async function mergeRoute(ctx: Ctx, h: DuplicatesHelpers): Promise<Response> {
  const g = await readGroup(ctx);
  if (g instanceof Response) return g;
  if (!g.keepContactId) return json({ error: "Choose the record to keep" }, 400);
  const allowed = await h.allowed();
  // Re-read from the caller's own account. A contact from another account, or one that does not exist, is "not found" and nothing is recorded.
  const loaded = await loadPeople(ctx.installationId, allowed, g.locationId, g.contactIds);
  if (!loaded) return json({ error: "Those contacts were not found" }, 404);
  if (anyClearlyDiffer(loaded.people)) return json({ error: "These look like different people (a different email and a different phone), so SubSync will not merge them.", different: true }, 422);
  const result = await mergeContacts(
    { installationId: ctx.installationId, locationId: g.locationId, keepId: g.keepContactId, people: loaded.people, token: () => h.locationToken(g.locationId) },
    // The demo company is made up: it can never write, whatever the switch says.
    ctx.demo ? { env: {} } : {},
  );
  if (result.outcome === "blocked") {
    return json({ ok: false, blocked: true, blockers: result.blockers, message: "SubSync cannot carry everything over for this one. Finish it in your CRM's own merge screen, which keeps conversations, deals and notes." });
  }
  if (result.outcome === "switched_off") {
    return json({ ok: true, switchedOff: true, steps: result.steps, caveats: result.caveats, message: "Merging from here is switched off for now, so nothing was changed. Finish it in your CRM with the buttons above." });
  }
  if (result.outcome === "needs_permission") return json({ ok: false, needsPermission: true, message: "SubSync needs permission to change contacts. Finish it in your CRM instead." }, 403);
  if (result.outcome === "failed") return json({ ok: false, message: "Your CRM refused the change, and nothing was removed. Finish it in your CRM instead.", step: result.step }, 502);
  await recordDecision(ctx.installationId, allowed, actorOf(ctx), { locationId: g.locationId, key: groupKey(g.contactIds), decision: "merged_in_platform", keepContactId: g.keepContactId, contactIds: g.contactIds });
  return json({ ok: true, merged: true });
}

export async function handleDuplicates(ctx: Ctx, h: DuplicatesHelpers): Promise<Response> {
  const [, b] = ctx.segments;
  const m = ctx.request.method;
  if (m === "GET" && !b) return overviewRoute(ctx, h);
  if (m === "GET" && b === "obvious") return obviousRoute(ctx, h);
  if (m === "POST" && b === "snooze") return snoozeRoute(ctx, h, false);
  if (m === "POST" && b === "unsnooze") return snoozeRoute(ctx, h, true);
  if (m === "POST" && b === "merge") return mergeRoute(ctx, h);
  return json({ error: "Not found" }, 404);
}

