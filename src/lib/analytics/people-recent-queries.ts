import { sql } from "../db";
import { cleanRecent, emptyRecent, personKey, pushOpened, pushQuery, SHOWN_OPENED, type RecentStore } from "../people/queue";
import { hydratePeople, type ListRow } from "./people-queue-queries";

// What a person looked at lately, kept on the server for them alone (a row of saved_views, page 'people-recent'): the words they searched and the people they opened,
// with the time. It feeds "Recent searches", "Recently opened" and "what changed since you last looked". Nothing here is shared with anyone else, it is never sent to
// the CRM, and a person who is no longer in the caller's accounts is not shown (the contacts are read through the caller's accounts again every time).

const PAGE = "people-recent";
const NAME = "recent";

export async function getRecent(installationId: string, owner: string): Promise<RecentStore> {
  const [r] = await sql()`select filters from saved_views where installation_id = ${installationId} and owner = ${owner} and page = ${PAGE} and name = ${NAME}`;
  return r ? cleanRecent(r.filters) : emptyRecent();
}

async function put(installationId: string, owner: string, store: RecentStore): Promise<void> {
  const db = sql();
  await db`insert into saved_views (installation_id, owner, page, name, filters) values (${installationId}, ${owner}, ${PAGE}, ${NAME}, ${db.json(store as never)})
    on conflict (installation_id, owner, page, name) do update set filters = excluded.filters`;
}

export async function rememberQuery(installationId: string, owner: string, q: string): Promise<RecentStore> {
  const next = pushQuery(await getRecent(installationId, owner), q);
  await put(installationId, owner, next);
  return next;
}

/** Forgets the person's recent searches, the people they opened, or both (a person may clear their own history; nobody else can). */
export async function clearRecent(installationId: string, owner: string, what: "queries" | "opened" | "all"): Promise<void> {
  const cur = await getRecent(installationId, owner);
  await put(installationId, owner, { q: what === "opened" ? cur.q : [], opened: what === "queries" ? cur.opened : [] });
}

/** Marks a person as opened now (the caller has already checked the person is in their accounts). Returns the time of the PREVIOUS opening, or null. */
export async function markOpened(installationId: string, owner: string, locationId: string, contactId: string, at: Date): Promise<string | null> {
  const cur = await getRecent(installationId, owner);
  const key = personKey(locationId, contactId);
  const before = cur.opened.find((o) => o.k === key)?.at ?? null;
  await put(installationId, owner, pushOpened(cur, key, at.toISOString()));
  return before;
}

/** The last few people opened, as rows (newest first), only those still in the caller's accounts. */
export async function recentPeople(installationId: string, allowed: string[] | null, store: RecentStore): Promise<ListRow[]> {
  const keys = store.opened.slice(0, SHOWN_OPENED * 2).map((o) => { const i = o.k.indexOf(":"); return { locationId: o.k.slice(0, i), contactId: o.k.slice(i + 1) }; });
  if (keys.length === 0) return [];
  const people = await hydratePeople(installationId, allowed, keys);
  const out: ListRow[] = [];
  for (const k of keys) {
    const p = people.get(personKey(k.locationId, k.contactId));
    if (p) out.push({ ...p, why: "" });
    if (out.length >= SHOWN_OPENED) break;
  }
  return out;
}
