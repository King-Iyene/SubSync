import { briefLines, headlineOf } from "../analytics/today-queue";
import { applyView, canAssign, isSnoozeChoice, lanesFor, parseRowKey, resolveEvents, snoozeUntil, type SnoozeChoice } from "../analytics/today-state";
import { appendAction, findAction, NEEDS_UPDATE, NeedsUpdate } from "../analytics/today-store";
import { json, type AuthContext } from "./auth";
import type { buildToday } from "./today-api";

// The working queue's endpoints: Done, Snooze 1 day, Snooze until Monday, Assign to me and Undo on a Fix first row, and the preview of the daily brief.
//
// Who the caller is, which account they may act on, which lane their marks live in and what the row holds all come from the signed session and from SubSync's own
// read of Today. The browser sends only WHICH row (account and kind) and WHAT to do; it never sends the ids the mark covers, because the server works those out itself
// from the same read Today shows. A row of an account the caller cannot read is refused with the same answer as a row that does not exist. Nothing here is written to
// the CRM, and no metric reads the marks.

type Ctx = AuthContext & { request: Request };
export type TodayPayload = Awaited<ReturnType<typeof buildToday>>;
export type TodayDeps = { load: (ctx: Ctx) => Promise<TodayPayload>; permits: (ctx: Ctx, locationId: string) => Promise<boolean> };

export const userKeyOf = (ctx: AuthContext) => ctx.session.userId ?? `co:${ctx.session.companyId}`;
const NOT_FOUND = () => json({ error: "That row is not in Today any more." }, 404);

export async function todayAction(ctx: Ctx, deps: TodayDeps): Promise<Response> {
  const body = (await ctx.request.json().catch(() => null)) as { action?: unknown; rowKey?: unknown; choice?: unknown; eventId?: unknown } | null;
  if (!body || typeof body.action !== "string") return json({ error: "Say what to do with the row." }, 400);
  const userKey = userKeyOf(ctx);
  const lanes = lanesFor(ctx.kind, userKey);
  const lane = lanes[0];
  const actorName = ctx.session.userName ?? null;
  const actorRole = ctx.session.personRole ?? ctx.session.role ?? null;
  try {
    if (body.action === "undo") {
      const id = typeof body.eventId === "number" && Number.isInteger(body.eventId) && body.eventId > 0 ? body.eventId : null;
      if (id === null) return json({ error: "Say which action to undo." }, 400);
      // Only an event in one of the caller's own lanes can be found; anyone else's id finds nothing.
      const ev = await findAction(ctx.installationId, lanes, id);
      if (!ev || ev.action === "undo" || !(await deps.permits(ctx, ev.locationId))) return NOT_FOUND();
      const done = await appendAction({ installationId: ctx.installationId, locationId: ev.locationId, rowKey: ev.rowKey, kind: ev.kind, action: "undo", lane, actorKey: userKey, actorName, actorRole, until: null, undoes: ev.id, itemIds: [] });
      return json({ ok: true, eventId: done.id, at: done.at });
    }
    if (body.action !== "done" && body.action !== "snooze" && body.action !== "assign") return json({ error: "That action does not exist." }, 400);
    // A client's staff may only press Done and Snooze (the same rule is in the screen; this is the one that counts).
    if (body.action === "assign" && !canAssign(ctx.kind)) return json({ error: "Assigning is not available in your view.", forbidden: true }, 403);
    const row = parseRowKey(body.rowKey);
    if (!row) return json({ error: "That row is not valid." }, 400);
    let choice: SnoozeChoice | null = null;
    if (body.action === "snooze") {
      if (!isSnoozeChoice(body.choice)) return json({ error: "Choose 1 day or until Monday." }, 400);
      choice = body.choice;
    }
    if (!(await deps.permits(ctx, row.locationId))) return NOT_FOUND();
    const data = await deps.load(ctx);
    const items = data.items.filter((i) => i.locationId === row.locationId && i.kind === row.kind);
    if (items.length === 0) return NOT_FOUND();
    const now = Date.now();
    const until = choice ? snoozeUntil(choice, now, data.zones[row.locationId] ?? "UTC") : null;
    const done = await appendAction({
      installationId: ctx.installationId, locationId: row.locationId, rowKey: `${row.locationId}|${row.kind}`, kind: row.kind, action: body.action, lane,
      actorKey: userKey, actorName, actorRole, until, undoes: null, itemIds: items.map((i) => i.id).slice(0, 500),
    });
    return json({ ok: true, eventId: done.id, at: done.at, until, count: items.length });
  } catch (error) {
    if (error instanceof NeedsUpdate) return json({ error: NEEDS_UPDATE, needsUpdate: true }, 503);
    throw error;
  }
}

/** The text of the daily brief as it would go out: the same headline, breakdown and top rows as Today, from the same ranking. Nothing is sent. */
export function briefFromToday(data: TodayPayload, opts: { excludeJunk?: boolean } = {}) {
  const view = applyView({ items: data.items, totals: data.totals, accounts: data.accounts, staleDays: data.staleDays, now: data.now }, { holds: data.holds, excludeJunk: opts.excludeJunk ?? true });
  const headline = headlineOf({ scope: data.scope, rows: view.queue, totals: view.totals, outlier: view.outlier });
  return { headline: headline.text, lines: briefLines({ headline, rows: view.queue, setAside: view.held.length }), held: view.held.length };
}

export async function todayBrief(ctx: Ctx, deps: TodayDeps): Promise<Response> {
  if (ctx.kind === "client") return json({ error: "This is not available in your view.", forbidden: true }, 403);
  const data = await deps.load(ctx);
  const b = briefFromToday(data);
  return json({ ...b, subject: b.headline, note: "This is a preview. SubSync has sent nothing." });
}

/** Re-exported so tests can resolve a lane's marks without the database. */
export { resolveEvents };
