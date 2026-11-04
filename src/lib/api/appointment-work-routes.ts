import { parseWindow } from "../analytics/appointment-f3";
import { parseBucket, parseBy, parseSort, WORK_KINDS, type WorkItem, type WorkKind } from "../analytics/appointment-work";
import { workCompare, workList, workOverview } from "../analytics/appointment-work-queries";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";

// The rebuilt Appointments page's endpoints, under /api/app/appointments/work, /list and /compare (the one catch-all route, already guarded; a client's staff may read,
// as for every appointment view). Each handler takes the accounts the caller may see from the router (`allowed`, from the signed session) and never anything from the
// request. Nothing here writes: SubSync does not change appointments in the CRM.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type ApptWorkHelpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>> };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const int = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };
const idOr = (v: string | null) => (v && ID.test(v) ? v : null);

function windowOf(sp: URLSearchParams) {
  return parseWindow({ from: sp.get("from"), to: sp.get("to"), cmpFrom: sp.get("cmpFrom"), cmpTo: sp.get("cmpTo") }, Date.now());
}

/** A row with its white-label link to the contact (never a phone or mail link). A booking with no contact has no link. */
const withUrl = (links: ReturnType<typeof deepLinks>) => (i: WorkItem) => ({ ...i, url: i.contactId ? links.contact(i.locationId, i.contactId) : null });

export async function handleApptWork(ctx: Ctx, h: ApptWorkHelpers): Promise<Response> {
  const sp = ctx.url.searchParams;
  const what = ctx.segments[1];
  const [allowed, links] = await Promise.all([h.allowed(), h.links()]);
  const link = withUrl(links);
  if (what === "work") {
    const v = await workOverview(ctx.installationId, allowed, { window: windowOf(sp) });
    return json({
      ...v, canSeeAccounts: ctx.limitTo === null, canEditTargets: ctx.kind !== "client",
      lists: Object.fromEntries(WORK_KINDS.map((k) => [k, { ...v.lists[k], rows: v.lists[k].rows.map(link) }])),
    });
  }
  if (what === "list") {
    const kindP = sp.get("kind");
    const kind = kindP === "all" || kindP === "window" ? kindP : (WORK_KINDS as string[]).includes(kindP ?? "") ? (kindP as WorkKind) : "all";
    const v = await workList(ctx.installationId, allowed, {
      kind, bucket: parseBucket(sp.get("bucket")), window: windowOf(sp),
      query: { q: (sp.get("q") ?? "").slice(0, 80), sort: parseSort(sp.get("sort")), location: idOr(sp.get("location")), user: idOr(sp.get("user")), calendar: idOr(sp.get("calendar")) },
      page: int(sp.get("page"), 0), size: int(sp.get("size"), 25),
    });
    return json({ ...v, rows: v.rows.map(link), canSeeAccounts: ctx.limitTo === null });
  }
  if (what === "compare") {
    const sort = sp.get("sort") === "name" ? "name" : sp.get("sort") === "rate" ? "rate" : "todo";
    const by = parseBy(sp.get("by"));
    // A client account's own staff have no use for a list of client accounts, and must never get one.
    if (by === "account" && ctx.limitTo) return json({ by, rows: [], page: 0, pages: 1, total: 0, from: 0, to: 0 });
    return json(await workCompare(ctx.installationId, allowed, { by, window: windowOf(sp), q: (sp.get("q") ?? "").slice(0, 60), sort, page: int(sp.get("page"), 0), size: int(sp.get("size"), 10) }));
  }
  return json({ error: "Not found" }, 404);
}
