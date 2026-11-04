import { assigneeLabel } from "../analytics/waiting-view";
import { teamNames } from "../analytics/inbox-queries";
import { leadExtras } from "../analytics/people-detail";
import {
  coldTagsFor, getDialer, goingCold, listSavedLists, peopleOptions, removeList, saveList, searchPeople, setDialer, tagDetail, watchingSince, type ColdBucket,
} from "../analytics/people-list-queries";
import { fetchConversationActivity, fetchContactCustomFields, fetchCustomFieldNames, isPermissionError } from "../sync/ghl-data";
import { callResultLabel, errorRef, isoDay, isQueryTimeout, TIMEOUT_MESSAGE } from "../people/helpers";
import { describeFilter, listName, parseSmartFilter, scopeFilterTo } from "../people/filters";
import { parseDialer } from "../people/dial";
import { personKey } from "../people/queue";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import { handlePeopleQueue } from "./people-queue-routes";

// The People module's endpoints, under /api/app/people/... (the one catch-all route, already guarded). Every handler derives who is asking from the verified
// session (`ctx`), limits every read to the accounts that caller may see, and never takes an account, owner key or installation from the browser.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };

export type PeopleHelpers = {
  allowed: () => Promise<string[] | null>;
  links: () => Promise<ReturnType<typeof deepLinks>>;
  /** The owner's choice of cold-list tags (null: use the tag names). A client's staff get null. */
  coldChoice: () => Promise<string[] | null>;
  /** Who is asking, as a key made on the server (kind, account, sign-in id). */
  voter: string;
  /** The token for one account, for the live read of a single lead. */
  locationToken: (locationId: string) => Promise<string>;
  /** The settings the call lists use: the account's stale-deal days and the reply target. */
  settings: () => Promise<{ staleDays: number; speedTargetMinutes: number }>;
};

/** A friendly answer when the database stopped a read for taking too long, with an error ID the person can quote. Null for any other error. */
export function timeoutResponse(error: unknown, where: string): Response | null {
  if (!isQueryTimeout(error)) return null;
  const errorId = errorRef();
  console.error("query stopped: too slow", { where, errorId });
  return json({ error: TIMEOUT_MESSAGE, errorId, timeout: true }, 503);
}

/** The key under which a company's (or a business's) shared lists are kept. A client's staff have none. */
const teamOwnerOf = (ctx: Ctx): string | null => (ctx.kind === "client" ? null : `team:${ctx.limitTo ?? "agency"}`);

const BUCKETS = new Set(["recent", "quiet", "none"]);

export async function handlePeople(ctx: Ctx, h: PeopleHelpers): Promise<Response> {
  try {
    return await route(ctx, h);
  } catch (error) {
    const t = timeoutResponse(error, `people/${ctx.segments[1] ?? ""}`);
    if (t) return t;
    throw error;
  }
}

async function route(ctx: Ctx, h: PeopleHelpers): Promise<Response> {
  const [, b, c, d] = ctx.segments;
  const m = ctx.request.method;
  const sp = ctx.url.searchParams;
  const page = Math.min(1000, Math.max(1, Math.floor(Number(sp.get("page"))) || 1));

  // The call lists, the lead panel (headline, timeline, what changed) and recent searches have their own file.
  const queued = await handlePeopleQueue(ctx, { allowed: h.allowed, links: h.links, voter: h.voter, settings: h.settings });
  if (queued) return queued;

  if (m === "GET" && b === "options") {
    const allowed = await h.allowed();
    const [opts, names, dialer] = await Promise.all([peopleOptions(ctx.installationId, allowed), teamNames(ctx.installationId), getDialer(ctx.installationId, h.voter)]);
    return json({
      ...opts, owners: opts.owners.map((o) => ({ ...o, name: assigneeLabel(o.id, names) })),
      canShareLists: ctx.kind !== "client", singleAccount: ctx.limitTo !== null, dialer: parseDialer(dialer),
    });
  }

  if (m === "GET" && b === "search") {
    const parsed = parseSmartFilter(Object.fromEntries(sp.entries()));
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const filter = scopeFilterTo(parsed.filter, ctx.limitTo);
    const allowed = await h.allowed();
    const [cold, links, names] = await Promise.all([filter.cold ? coldTagsFor(ctx.installationId, allowed, await h.coldChoice()) : Promise.resolve([] as string[]), h.links(), teamNames(ctx.installationId)]);
    const res = await searchPeople(ctx.installationId, allowed, filter, page, cold);
    return json({
      // The choices are NOT echoed back: an answer must never name an account the caller did not ask about with their own rights (check-tenancy counts that as a leak).
      ...res, description: describeFilter(filter, { owner: (id) => assigneeLabel(id, names) }),
      rows: res.rows.map((r) => ({ ...r, rowId: personKey(r.locationId, r.contactId), why: "", at: null, value: null, ownerName: assigneeLabel(r.owner, names), url: links.contact(r.locationId, r.contactId) })),
    });
  }

  if (m === "GET" && b === "going-cold") {
    const bucket = sp.get("bucket") ?? "quiet";
    if (!BUCKETS.has(bucket)) return json({ error: "Unknown group" }, 400);
    const allowed = await h.allowed();
    const [cold, links, names] = await Promise.all([coldTagsFor(ctx.installationId, allowed, await h.coldChoice()), h.links(), teamNames(ctx.installationId)]);
    const res = await goingCold(ctx.installationId, allowed, bucket as ColdBucket, cold, page);
    return json({ ...res, bucket, rows: res.rows.map((r) => ({ ...r, rowId: personKey(r.locationId, r.contactId), why: r.lastSignalAt ? `Last seen ${new Date(r.lastSignalAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}` : "Nothing seen yet", at: r.lastSignalAt, value: null, ownerName: assigneeLabel(r.owner, names), url: links.contact(r.locationId, r.contactId) })) });
  }

  if (m === "GET" && b === "tags" && !c) {
    const allowed = await h.allowed();
    const [opts, since] = await Promise.all([peopleOptions(ctx.installationId, allowed), watchingSince(ctx.installationId, allowed)]);
    return json({ tags: opts.tags, watchingSince: since });
  }

  if (m === "GET" && b === "tags" && c) {
    const tag = decodeURIComponent(c).slice(0, 60);
    const today = isoDay(new Date());
    const to = sp.get("to") && /^\d{4}-\d{2}-\d{2}$/.test(sp.get("to") as string) ? (sp.get("to") as string) : today;
    const from = sp.get("from") && /^\d{4}-\d{2}-\d{2}$/.test(sp.get("from") as string) ? (sp.get("from") as string) : isoDay(new Date(Date.parse(`${to}T00:00:00Z`) - 89 * 86_400_000));
    // A window is at most 180 days and ends no later than today, so a hand-made address cannot ask for years of days.
    if (!(from <= to) || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 179 * 86_400_000) return json({ error: "Choose a window of up to 180 days" }, 400);
    const allowed = await h.allowed();
    const [res, links, names] = await Promise.all([tagDetail(ctx.installationId, allowed, tag, from, to), h.links(), teamNames(ctx.installationId)]);
    return json({
      ...res,
      days: res.days.map((day) => ({ ...day, members: day.members.map((x) => ({ ...x, ownerName: assigneeLabel(x.owner, names), url: links.contact(x.locationId, x.contactId) })) })),
    });
  }

  if (b === "lists") {
    const team = teamOwnerOf(ctx);
    if (m === "GET") {
      const lists = await listSavedLists(ctx.installationId, h.voter, team);
      return json({ lists, max: 20, canShare: team !== null });
    }
    if (m === "POST") {
      const body = (await ctx.request.json().catch(() => null)) as { name?: unknown; filter?: unknown; shared?: unknown } | null;
      const name = listName(body?.name);
      if (!name) return json({ error: "Give the list a name of up to 40 characters" }, 400);
      const parsed = parseSmartFilter(body?.filter);
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      // A list is never saved with a different account than the caller's own: a client's staff only have their own.
      const filter = scopeFilterTo(parsed.filter, ctx.limitTo);
      const made = await saveList(ctx.installationId, h.voter, team, body?.shared === true, name, filter);
      if (made === "full") return json({ error: "You can keep up to 20 lists. Delete one first." }, 400);
      if (made === "no_team") return json({ error: "Shared lists are not available in this view" }, 403);
      return json({ ok: true });
    }
    if (m === "DELETE" && c && /^[0-9a-fA-F-]{36}$/.test(c)) {
      return (await removeList(ctx.installationId, h.voter, team, c)) ? json({ ok: true }) : json({ error: "List not found" }, 404);
    }
  }

  if (b === "dialer") {
    if (m === "GET") return json({ provider: parseDialer(await getDialer(ctx.installationId, h.voter)) });
    if (m === "PUT") {
      const body = (await ctx.request.json().catch(() => null)) as { provider?: unknown } | null;
      if (body?.provider !== "crm" && body?.provider !== "phone") return json({ error: "Choose the CRM's dialer or your own phone app" }, 400);
      await setDialer(ctx.installationId, h.voter, body.provider);
      return json({ ok: true, provider: body.provider });
    }
  }

  // The lead panel's extras for one lead, in two parts: what SubSync holds (always), and a live read of the custom fields and the CRM's own call history of THIS
  // lead (read only, nothing stored, never for the demo, and any failure is reported as a state, not an error).
  if (m === "GET" && b === "contact" && c && d && /^[A-Za-z0-9_-]{3,64}$/.test(c) && /^[A-Za-z0-9_-]{3,128}$/.test(d)) {
    const ex = await leadExtras(ctx.installationId, await h.allowed(), c, d);
    if (!ex) return json({ error: "Contact not found" }, 404);
    const names = await teamNames(ctx.installationId);
    const { conversationId, ...rest } = ex;
    type Live = { state: "ok" | "needs_permission" | "unavailable" | "off"; customFields: Array<{ name: string; value: string }>; calls: Array<{ at: string; direction: string | null; result: string; by: string | null }>; messages: Array<{ at: string; direction: string | null; channel: string; by: string | null }>; note: string | null };
    let live: Live = { state: "off", customFields: [], calls: [], messages: [], note: "The demo does not read your CRM." };
    if (!ctx.demo) {
      live = { state: "ok", customFields: [], calls: [], messages: [], note: null };
      try {
        const token = await h.locationToken(c);
        const [fields, calls] = await Promise.allSettled([
          fetchCustomFieldNames(token, c).then((n) => fetchContactCustomFields(token, d, n)),
          conversationId ? fetchConversationActivity(token, c, conversationId) : Promise.resolve({ calls: [], messages: [] }),
        ]);
        const denied = [fields, calls].some((r) => r.status === "rejected" && isPermissionError(r.reason));
        const broken = [fields, calls].some((r) => r.status === "rejected" && !isPermissionError(r.reason));
        if (fields.status === "fulfilled") live.customFields = fields.value;
        if (calls.status === "fulfilled") {
          live.calls = calls.value.calls.map((x) => ({ at: new Date(x.at).toISOString(), direction: x.direction, result: callResultLabel(x.status, x.durationSeconds), by: x.userId ? assigneeLabel(x.userId, names) : null }));
          live.messages = calls.value.messages.map((x) => ({ at: new Date(x.at).toISOString(), direction: x.direction, channel: x.channel, by: x.userId ? assigneeLabel(x.userId, names) : null }));
        }
        if (denied) { live.state = "needs_permission"; live.note = "Needs permission: reconnect SubSync to let it read custom fields and call history."; }
        else if (broken) { live.state = "unavailable"; live.note = "Your CRM did not answer for custom fields or calls. Try again later."; }
      } catch {
        live = { state: "unavailable", customFields: [], calls: [], messages: [], note: "Custom fields and the CRM's call history could not be read right now." };
      }
    }
    return json({ ...rest, ownerName: assigneeLabel(rest.owner, names), live });
  }

  return json({ error: "Not found" }, 404);
}
