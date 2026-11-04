import { logOutcome } from "../analytics/call-queries";
import { parseOutcome } from "../analytics/call-intel";
import { teamNames } from "../analytics/inbox-queries";
import { forgetPeopleLists, hydratePeople, peopleCounts, peopleQueue, type ListRow } from "../analytics/people-queue-queries";
import { personDetail } from "../analytics/people-person-queries";
import { clearRecent, getRecent, markOpened, recentPeople, rememberQuery } from "../analytics/people-recent-queries";
import { assigneeLabel } from "../analytics/waiting-view";
import { changedLine, changedSince } from "../people/person";
import { isListId, LIST_IDS, listInfo, queueSay, searchTerm, startHere, startOnMine, lastOpened, personKey } from "../people/queue";
import type { PersonRowOut } from "../people/types";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";

// The People call lists and the lead panel's own endpoints, under /api/app/people/... (the one catch-all route, already guarded). Who is asking comes from the verified session
// (`ctx`); the accounts that caller may read come from `allowed` (derived by the router from the session, never from the request); an id in the address only NARROWS inside
// them, and every query is bound to `allowed` again. A client's staff are held to their own account by the router before any of this runs.
//   GET    people/home                       the five counts, the sentence, and the first page of the list to start with
//   GET    people/queue?list=&mine=&q=&page= one page of one call list
//   GET    people/person/<account>/<id>      the lead panel: headline, deals, tags with days, timeline, what changed since the asker last looked
//   PUT    people/seen                       the asker opened this person now (for "what changed since you last looked" and "Recently opened")
//   GET    people/recent / POST / DELETE     recent searches and recently opened people of the asker
//   POST   people/outcome                    one call logged from SubSync (SubSync's own record, never sent to the CRM)

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };

export type QueueHelpers = {
  allowed: () => Promise<string[] | null>;
  links: () => Promise<ReturnType<typeof deepLinks>>;
  voter: string;
  settings: () => Promise<{ staleDays: number; speedTargetMinutes: number }>;
};

const ID = /^[A-Za-z0-9_-]{3,64}$/;
const CONTACT_ID = /^[A-Za-z0-9_-]{3,128}$/;
const int = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };

/** Adds the owner's name and the white-label link to rows (the link helper, never a fixed address). */
export function withNames(rows: readonly ListRow[], names: ReadonlyMap<string, string>, links: ReturnType<typeof deepLinks>): PersonRowOut[] {
  return rows.map(({ ownerLabel, ...r }) => ({ ...r, ownerName: ownerLabel ?? assigneeLabel(r.owner, names), url: links.contact(r.locationId, r.contactId) }));
}

export async function handlePeopleQueue(ctx: Ctx, h: QueueHelpers): Promise<Response | null> {
  const [, b, c, d] = ctx.segments;
  const m = ctx.request.method;
  const sp = ctx.url.searchParams;
  const me = ctx.session.userId ?? null;

  if (m === "GET" && b === "home") {
    const now = Date.now();
    const [allowed, st, names, links] = await Promise.all([h.allowed(), h.settings(), teamNames(ctx.installationId), h.links()]);
    const args = { installationId: ctx.installationId, allowed, meId: me, staleDays: st.staleDays, targetMinutes: st.speedTargetMinutes, now };
    const { counts, capped } = await peopleCounts(args);
    const start = startHere(counts);
    const staff = ctx.kind === "client";
    const mine = start ? startOnMine({ staff, mine: counts.find((x) => x.id === start)?.mine ?? null }) : false;
    const first = start ? await peopleQueue(args, { list: start, mine, q: "", page: 1 }) : null;
    return json({
      counts, capped, start, mine, staff, canMine: me !== null, staleDays: st.staleDays, say: queueSay(counts, st.staleDays), multi: allowed === null || allowed.length > 1,
      lists: LIST_IDS.map((id) => listInfo(id, st.staleDays)),
      page: first ? { ...first, rows: withNames(first.rows, names, links) } : null,
    });
  }

  if (m === "GET" && b === "queue") {
    const list = sp.get("list");
    if (!isListId(list)) return json({ error: "Unknown list" }, 400);
    const now = Date.now();
    const [allowed, st, names, links] = await Promise.all([h.allowed(), h.settings(), teamNames(ctx.installationId), h.links()]);
    const args = { installationId: ctx.installationId, allowed, meId: me, staleDays: st.staleDays, targetMinutes: st.speedTargetMinutes, now };
    const out = await peopleQueue(args, { list, mine: sp.get("mine") === "1", q: (sp.get("q") ?? "").slice(0, 100), page: int(sp.get("page"), 1), size: int(sp.get("size"), 25) });
    return json({ ...out, info: listInfo(list, st.staleDays), rows: withNames(out.rows, names, links) });
  }

  if (m === "GET" && b === "person" && c && d) {
    if (!ID.test(c) || !CONTACT_ID.test(d)) return json({ error: "Contact not found" }, 404);
    const now = Date.now();
    const [allowed, st, names, links] = await Promise.all([h.allowed(), h.settings(), teamNames(ctx.installationId), h.links()]);
    const detail = await personDetail({ installationId: ctx.installationId, allowed, locationId: c, contactId: d, staleDays: st.staleDays, nowMs: now, label: (id) => assigneeLabel(id, names) });
    if (!detail) return json({ error: "Contact not found" }, 404);
    const seen = lastOpened(await getRecent(ctx.installationId, h.voter), personKey(c, d));
    const ch = changedSince(detail.timeline, seen);
    const { conversationId, ...rest } = detail;
    void conversationId;
    return json({ ...rest, ownerName: assigneeLabel(detail.contact.owner, names), url: links.contact(c, d), lastSeenAt: seen, changed: ch ? { count: ch.count, titles: ch.titles, line: changedLine(ch, now) } : null, now });
  }

  if (m === "PUT" && b === "seen") {
    const body = (await ctx.request.json().catch(() => null)) as { locationId?: unknown; contactId?: unknown } | null;
    if (!body || typeof body.locationId !== "string" || typeof body.contactId !== "string" || !ID.test(body.locationId) || !CONTACT_ID.test(body.contactId)) return json({ error: "Contact not found" }, 404);
    const allowed = await h.allowed();
    // Only a person inside the caller's accounts can be remembered: the batch read joins to those accounts.
    const found = await hydratePeople(ctx.installationId, allowed, [{ locationId: body.locationId, contactId: body.contactId }]);
    if (found.size === 0) return json({ error: "Contact not found" }, 404);
    const before = await markOpened(ctx.installationId, h.voter, body.locationId, body.contactId, new Date());
    return json({ ok: true, previous: before });
  }

  if (b === "recent") {
    if (m === "GET") {
      const [allowed, names, links] = await Promise.all([h.allowed(), teamNames(ctx.installationId), h.links()]);
      const store = await getRecent(ctx.installationId, h.voter);
      return json({ queries: store.q, people: withNames(await recentPeople(ctx.installationId, allowed, store), names, links) });
    }
    if (m === "POST") {
      const body = (await ctx.request.json().catch(() => null)) as { q?: unknown } | null;
      const t = typeof body?.q === "string" ? searchTerm(body.q) : null;
      if (!t || !t.ok) return json({ error: "Type at least two letters, or three digits of a phone number" }, 400);
      return json({ ok: true, queries: (await rememberQuery(ctx.installationId, h.voter, t.q)).q });
    }
    if (m === "DELETE") {
      const what = sp.get("what");
      await clearRecent(ctx.installationId, h.voter, what === "opened" || what === "all" ? what : "queries");
      return json({ ok: true });
    }
  }

  if (m === "POST" && b === "outcome") {
    const parsed = parseOutcome(await ctx.request.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const ok = await logOutcome(ctx.installationId, await h.allowed(), parsed.value);
    if (!ok) return json({ error: "Contact not found" }, 404);
    forgetPeopleLists(ctx.installationId);
    return json({ ok: true });
  }

  return null;
}
