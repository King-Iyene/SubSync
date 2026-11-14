import { json, ownerSession, type AuthContext } from "./auth";
import { ownedLocation } from "./tenant-guard";
import { viewerOf } from "./people3-routes";
import { QUEUES, defaultTagOf, type QueueKey } from "../call-queue-tags/tags";
import { cachedChecks, companySnapshotOn, getQueueTags, saveQueueTags, setCompanySnapshot } from "../call-queue-tags/store";
import { runCheck } from "../call-queue-tags/run";
import { judgeSetup } from "../call-queue-tags/check";
import { SNAPSHOT_STEPS, snapshotUrlFrom, snapshotVisible } from "../call-queue-tags/snapshot";
import { sql } from "../db";

// Call queue tags, under /api/app/cqt/<part>. Who is asking and which accounts they may open come from the verified session (`ctx`, `h.allowed`); an account id from the request is only
// used after ownedLocation. The access rules (access.ts) also stop a client's staff from changing anything, and stop every account session from the snapshot address.
//   GET  tags?locationId     the four tags of an account, the defaults, who may edit, and (agency only) whether the one-click setup card shows
//   PUT  tags                { locationId, tags: { first_reply?, ... } } an owner, admin or agency person saves
//   GET  check?locationId    the last cached "Check that it worked" answer for an account (no CRM call)
//   POST check               { locationId } read the CRM now (read only) and cache the answer
//   GET  snapshot            the optional one-click setup address: agency session only, only while every switch is on
//   PUT  switch              { companyId?: ignored } the platform owner switches the one-click card on or off for a company

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
type H = { allowed: () => Promise<string[] | null> };

export async function handleCqt(ctx: Ctx, h: H): Promise<Response> {
  const part = ctx.segments[1], m = ctx.request.method;
  const body = m === "GET" ? null : ((await ctx.request.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
  const canEdit = viewerOf(ctx).level !== "self";

  if (part === "snapshot" && m === "GET") {
    // Agency only, again here (the access rules already refuse an account session). Any other reason looks the same as "not there".
    const g = ctx.kind === "agency" && !ctx.demo ? await gate(ctx) : null;
    if (!g?.show || !g.url) return json({ error: "Not found" }, 404);
    return json({ url: g.url, steps: SNAPSHOT_STEPS });
  }
  if (part === "switch" && m === "PUT") {
    if (!ownerSession(ctx.session)) return json({ error: "Not found" }, 404);
    const on = body?.on === true;
    // The owner names the company; its own company when none is named.
    const target = typeof body?.companyId === "string" && /^[A-Za-z0-9_-]{3,128}$/.test(body.companyId) ? await sql()`select id from installations where company_id = ${body.companyId}` : [{ id: ctx.installationId }];
    if (!target[0]) return json({ error: "Company not found." }, 404);
    return json({ ok: await setCompanySnapshot(target[0].id as string, on), on });
  }

  if (part === "accounts" && m === "GET") {
    const allowed = await h.allowed();
    const db = sql();
    const rows = await db`select location_id, name from locations where installation_id = ${ctx.installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} order by name limit 300`;
    return json({ accounts: rows.map((r) => ({ id: r.location_id as string, name: (r.name as string | null) ?? "Unnamed account" })) });
  }

  const loc = await ownedLocation(ctx.installationId, await h.allowed(), (body ? body.locationId : ctx.url.searchParams.get("locationId")) ?? "");
  if (part === "tags" && m === "GET") {
    if (!loc) return json({ error: "Client account not found." }, 404);
    const tags = await getQueueTags(ctx.installationId, loc);
    const snap = ctx.kind === "agency" && !ctx.demo ? await gate(ctx) : null;
    return json({
      canEdit, kind: ctx.kind, tags,
      queues: QUEUES.map((q) => ({ key: q.key, label: q.label, what: q.what, defaultTag: q.defaultTag, workflow: q.workflow, tag: tags[q.key] })),
      // Only a boolean and the plain steps. The address is a separate request that an account session can never make.
      snapshot: snap?.show ? { show: true, steps: SNAPSHOT_STEPS } : { show: false },
    });
  }
  if (part === "tags" && m === "PUT") {
    if (!canEdit) return json({ error: "Ask an administrator to change the call queue tags." }, 403);
    if (!loc) return json({ error: "Client account not found." }, 404);
    const raw = body?.tags && typeof body.tags === "object" ? (body.tags as Record<string, unknown>) : {};
    const r = await saveQueueTags(ctx.installationId, loc, raw as Partial<Record<QueueKey, unknown>>, ctx.session.userName ?? ctx.session.userId ?? null);
    return json(r, r.ok ? 200 : 400);
  }
  if (part === "check" && m === "GET") {
    if (!loc) return json({ error: "Client account not found." }, 404);
    const [c] = await cachedChecks(ctx.installationId, [loc]);
    return json({ checked: !!c, state: c?.state ?? "unchecked", checkedAt: c?.checkedAt ?? null });
  }
  if (part === "check" && m === "POST") {
    if (!loc) return json({ error: "Client account not found." }, 404);
    if (ctx.demo) return json(judgeSetup(await getQueueTags(ctx.installationId, loc), { tagsReadable: true, workflowsReadable: true, tagNames: QUEUES.map((q) => defaultTagOf(q.key)), workflowNames: QUEUES.flatMap((q) => (q.workflow ? [q.workflow] : [])) }));
    return json(await runCheck(ctx.installationId, loc));
  }
  return json({ error: "Unknown action" }, 404);
}

async function gate(ctx: Ctx) {
  const url = snapshotUrlFrom();
  const companyOn = url ? await companySnapshotOn(ctx.installationId) : false;
  return { ...snapshotVisible({ kind: ctx.kind, demo: ctx.demo, flagOn: ctx.entitlements.features.cq_snapshot === true, companyOn, url }), url };
}

/** Getting started: the cached facts for the one "Set up your call queues" row. Never calls the CRM. */
export async function callQueueGuideFacts(installationId: string, allowed: readonly string[] | null) {
  const db = sql();
  const accounts = await db`select location_id from locations where installation_id = ${installationId} and not ignored ${allowed ? db`and location_id = any(${allowed as string[]}::text[])` : db``} limit 500`;
  const ids = accounts.map((r) => r.location_id as string);
  const checks = ids.length ? await cachedChecks(installationId, ids) : [];
  return { accounts: ids.length, checks: checks.map((c) => ({ state: c.state })) };
}
