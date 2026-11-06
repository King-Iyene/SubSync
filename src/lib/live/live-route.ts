import { sql } from "../db";
import { teamNames } from "../analytics/inbox-queries";
import { assigneeLabel } from "../analytics/waiting-view";
import { callResultLabel } from "../people/helpers";
import { isPermissionError, mapContact, type ContactRow } from "../sync/ghl-data";
import { json, type AuthContext } from "../api/auth";
import { cacheContacts, cacheConversations, recordLiveCalls } from "./live-cache";
import { crmSource, ForeignContact, liveRead, type LiveRead } from "./live-read";
import { after } from "next/server";
import { deltaDue, runDelta, crmDeltaDeps } from "./delta";
import { GHL_API, GhlError } from "../ghl/client";
import { ghlFetch } from "../ghl/http";

// GET /api/app/workbench/live?locationId&contactId[&full=1]  and  GET /api/app/workbench/find?q=
// Both derive the installation from the verified session, accept only accounts the caller may see, use that account's own token, and write what they learn into the copy (write-through).

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
type H = { allowed: () => Promise<string[] | null>; locationToken: (locationId: string) => Promise<string> };
const ID = /^[A-Za-z0-9_-]{3,128}$/;

// One read per person per 2.5 s at most (two panels, or a fast double poll, share it): keeps the account far below its request limit.
const recent = new Map<string, { at: number; full: boolean; body: unknown }>();
const THROTTLE_MS = 2_500;

/** A short fingerprint of what the panel shows: when it changes between polls, the panel reloads its other parts. */
export function revOf(r: LiveRead): string {
  const parts = [[...r.contact.tags].sort().join("|"), r.contact.assignedTo ?? "", r.contact.dnd ? 1 : 0, r.contact.email ?? "", r.contact.phone ?? "", r.contact.updatedAt ?? "",
    r.conversation?.conversationId ?? "", r.conversation?.lastMessageAt ?? "", r.conversation?.unreadCount ?? 0, r.calls.length, r.calls[0]?.at ?? 0,
    r.notes.map((n) => n.id).join(","), r.tasks.map((t) => `${t.id}${t.done ? 1 : 0}`).join(","), r.appointments.map((a) => `${a.appointmentId}${a.status ?? ""}`).join(","), r.deals.map((d) => `${d.opportunityId}${d.stageId ?? ""}${d.status}`).join(",")];
  let h = 0;
  for (const ch of parts.join("~")) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return String(h);
}

async function accountKnown(ctx: Ctx, locationId: string): Promise<boolean> {
  const [r] = await sql()`select 1 from locations where installation_id = ${ctx.installationId} and location_id = ${locationId} and not ignored`;
  return !!r;
}

export async function liveRoute(ctx: Ctx, h: H): Promise<Response> {
  const locationId = ctx.url.searchParams.get("locationId"), contactId = ctx.url.searchParams.get("contactId");
  if (!locationId || !contactId || !ID.test(locationId) || !ID.test(contactId)) return json({ error: "Send the account and the person" }, 400);
  const allowed = await h.allowed();
  if ((allowed && !allowed.includes(locationId)) || !(await accountKnown(ctx, locationId))) return json({ error: "Contact not found" }, 404);
  if (ctx.demo) return json({ state: "off", note: "The demo does not read a CRM." });
  const full = ctx.url.searchParams.get("full") === "1";
  const key = `${ctx.installationId}:${locationId}:${contactId}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < THROTTLE_MS && (hit.full || !full)) return json(hit.body);
  try {
    const read = await liveRead(crmSource(await h.locationToken(locationId), locationId), locationId, contactId, full);
    await cacheContacts(ctx.installationId, locationId, [read.contact]).catch(() => 0);
    if (read.conversation) {
      await cacheConversations(ctx.installationId, locationId, [read.conversation]).catch(() => undefined);
      await recordLiveCalls(ctx.installationId, { locationId, contactId, conversationId: read.conversation.conversationId }, read.calls);
    }
    // Somebody has this account open: keep its newest changes fresh (bounded, after the answer is sent).
    if (deltaDue(`${ctx.installationId}:${locationId}`)) {
      const token = await h.locationToken(locationId);
      after(() => runDelta(ctx.installationId, locationId, crmDeltaDeps(token, locationId)).then(() => undefined));
    }
    const names = await teamNames(ctx.installationId);
    const c = read.contact;
    const body = {
      state: "ok", readAt: read.readAt, rev: revOf(read), full, missing: read.missing,
      tags: c.tags, ownerId: c.assignedTo, ownerName: c.assignedTo ? assigneeLabel(c.assignedTo, names) : null, dnd: c.dnd, email: c.email, phone: c.phone,
      conversation: read.conversation ? { id: read.conversation.conversationId, lastAt: read.conversation.lastMessageAt, direction: read.conversation.lastMessageDirection, unread: read.conversation.unreadCount } : null,
      calls: read.calls.map((x) => ({ at: new Date(x.at).toISOString(), direction: x.direction, result: callResultLabel(x.status, x.durationSeconds), by: x.userId ? assigneeLabel(x.userId, names) : null })),
      notes: read.notes.map((n) => ({ ...n, by: n.by ? assigneeLabel(n.by, names) : null })), tasks: read.tasks,
      appointments: read.appointments.map((a) => ({ id: a.appointmentId, title: a.title, status: a.status, at: a.startAt })),
      deals: read.deals.map((d) => ({ id: d.opportunityId, name: d.name, stageId: d.stageId, value: d.monetaryValue, status: d.status })),
    };
    recent.set(key, { at: Date.now(), full, body });
    if (recent.size > 500) for (const k of recent.keys()) { recent.delete(k); if (recent.size < 400) break; }
    return json(body);
  } catch (e) {
    if (e instanceof ForeignContact) return json({ error: "Contact not found" }, 404);
    if (isPermissionError(e)) return json({ state: "needs_permission", note: "Needs permission: reconnect SubSync to let it read this person live." });
    if (e instanceof GhlError && e.status === 429) return json({ state: "rate_limited", note: "The CRM asked SubSync to slow down.", retryInSeconds: 30 });
    return json({ state: "unavailable", note: "Your CRM did not answer. Showing the last sync." });
  }
}

/** Write-through after a SubSync write: read the person back from the CRM and keep the copy equal to it, so the panel and every list show the change at once. Never throws. */
export async function refreshLead(installationId: string, token: string, locationId: string, contactId: string): Promise<boolean> {
  try {
    const src = crmSource(token, locationId);
    const found = await src.contact(contactId);
    if (!found || (found.locationId && found.locationId !== locationId)) return false;
    await cacheContacts(installationId, locationId, [found.contact]);
    const conv = await src.conversation(contactId).catch(() => null);
    if (conv) await cacheConversations(installationId, locationId, [conv]);
    recent.delete(`${installationId}:${locationId}:${contactId}`);
    return true;
  } catch { return false; /* the next live read or sync makes it up */ }
}

/** The contacts the CRM finds for a search term, in the accounts the caller may see (most 5 accounts per search, 10 hits each). Hits are stored, so they open like any other person. */
export async function findRoute(ctx: Ctx, h: H): Promise<Response> {
  if (ctx.demo) return json({ rows: [] });
  return json({ rows: await crmFind(ctx.installationId, await h.allowed(), (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 80), h.locationToken, ctx.url.searchParams.get("locationId")) });
}

export async function crmFind(installationId: string, allowed: string[] | null, q: string, token_: (locationId: string) => Promise<string>, only: string | null = null) {
  const rows: Array<{ locationId: string; locationName: string | null; contactId: string; name: string; email: string | null; phone: string | null; tags: string[] }> = [];
  if (q.length < 3) return rows;
  const locs = (await sql()`select location_id, name from locations where installation_id = ${installationId} and not ignored order by name limit 200`)
    .filter((l) => (!allowed || allowed.includes(l.location_id as string)) && (!only || l.location_id === only)).slice(0, 5);
  await Promise.all(locs.map(async (l) => {
    try {
      const token = await token_(l.location_id as string);
      const res = await ghlFetch(`${GHL_API}/contacts/?${new URLSearchParams({ locationId: l.location_id as string, query: q, limit: "10" }).toString()}`, { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" }, cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { contacts?: unknown[] };
      const found = (Array.isArray(body.contacts) ? body.contacts : []).map(mapContact).filter((c): c is ContactRow => c !== null);
      await cacheContacts(installationId, l.location_id as string, found);
      for (const c of found) rows.push({ locationId: l.location_id as string, locationName: (l.name as string | null) ?? null, contactId: c.contactId, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || c.phone || "No name", email: c.email, phone: c.phone, tags: c.tags });
    } catch { /* a search that fails for one account leaves the others */ }
  }));
  return rows.slice(0, 30);
}
