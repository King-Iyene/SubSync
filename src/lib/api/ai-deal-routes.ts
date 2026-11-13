import { connectionFor, followUp, forecastWords, healthView, jobState, winLoss, type ListQuery, type Who } from "../ai/deal-jobs-run";
import { DEAL_JOB_FLAG, DEAL_JOB_IDS, isDealJobId, type DealJobId } from "../ai/deal-jobs";
import { setFeedback } from "../ai/store";
import { json, type AuthContext } from "./auth";
import { ownedAccount } from "./pl-guard";

// The four deal jobs' endpoints, mounted by ai-routes.ts under /api/app/ai:
//   GET  ?part=deal-status[&locationId=]         what each job's button should do for this person: off (show nothing), a hint, or ready
//   GET  ?part=deal-health&locationId=&id=       the Health badge and the findings (rules); plus the explanation if one was already written for exactly these facts. Never calls a provider.
//   POST act/deal-health {locationId, id}        writes the explanation (a provider call, once per distinct input)
//   POST act/deal-followup | deal-winloss | deal-forecast {from, to, location, pipeline}
//   POST act/deal-feedback {job, runId, value, locationId?}
// Who is asking and which accounts they may read come from the verified session (`allowed`), never from the request: an account id in a body only narrows inside them. Each job needs the
// global ai_byo flag AND its own flag, and the customer's own connection with that job switched on (the gateway checks that again on every run). Nothing here writes to the CRM.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
type Deps = { allowed: () => Promise<string[] | null> };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "") || null;
const ID = /^[A-Za-z0-9_-]{3,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}$/;

export const isDealPart = (part: string | null, isAct: boolean, name: string | undefined) => (isAct ? typeof name === "string" && name.startsWith("deal-") : typeof part === "string" && part.startsWith("deal-"));

export async function handleAiDeals(ctx: Ctx, deps: Deps, on: (f: string) => boolean, user: string): Promise<Response> {
  const isAct = ctx.segments[1] === "act", name = ctx.segments[2], part = ctx.url.searchParams.get("part");
  const flagOn = (j: DealJobId) => on("ai_byo") && on(DEAL_JOB_FLAG[j]);
  const allowed = await deps.allowed();
  const who: Who = { installationId: ctx.installationId, userKey: user, allowed, onlyOwnerId: ctx.kind === "client" && ctx.session.role !== "admin" ? ctx.session.userId ?? "none" : null };
  const sp = ctx.url.searchParams;

  if (!isAct) {
    const loc = sp.get("locationId") ? await ownedAccount(ctx.installationId, allowed, sp.get("locationId")) : "";
    if (loc === null) return json({ error: "That account is not available" }, 404);
    if (part === "deal-status") {
      const runLoc = loc || (allowed && allowed.length === 1 ? allowed[0] : "");
      const states = await Promise.all(DEAL_JOB_IDS.map(async (j) => [j, ctx.demo ? "off" : await jobState(ctx.installationId, runLoc, j, flagOn(j))] as const));
      return json({ jobs: Object.fromEntries(states) });
    }
    if (part === "deal-health") {
      if (!flagOn("deal_health") || ctx.demo) return json({ error: "Not switched on" }, 404);
      const id = sp.get("id");
      if (!loc || !id || !ID.test(id)) return json({ error: "That deal is not available" }, 404);
      const v = await healthView(who, loc, id, { run: false });
      return v ? json(v) : json({ error: "That deal is not available" }, 404);
    }
    return json({ error: "Not found" }, 404);
  }

  if (ctx.request.method !== "POST") return json({ error: "Not found" }, 404);
  if (ctx.demo) return json({ error: "The sample data cannot be changed." }, 403);
  const b = ((await ctx.request.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  if (name === "deal-feedback") {
    const job = b.job, v = b.value === 1 || b.value === -1 ? b.value : null, runId = text(b.runId, 40);
    if (!isDealJobId(job) || v === null || !runId || !/^[0-9a-f-]{36}$/i.test(runId)) return json({ error: "Bad request" }, 400);
    const loc = b.locationId ? await ownedAccount(ctx.installationId, allowed, b.locationId) : "";
    if (loc === null) return json({ error: "Not found" }, 404);
    const { scope } = await connectionFor(ctx.installationId, loc || (allowed && allowed.length === 1 ? allowed[0] : ""));
    return (await setFeedback(ctx.installationId, scope, runId, v)) ? json({ ok: true }) : json({ error: "Not found" }, 404);
  }

  const job = name === "deal-health" ? "deal_health" : name === "deal-followup" ? "deal_followup" : name === "deal-winloss" ? "deal_winloss" : name === "deal-forecast" ? "deal_forecast" : null;
  if (!job) return json({ error: "Not found" }, 404);
  if (!flagOn(job)) return json({ error: "This is not switched on for your account yet." }, 404);
  const fresh = b.fresh === true;

  if (job === "deal_health") {
    const loc = await ownedAccount(ctx.installationId, allowed, b.locationId), id = text(b.id, 64);
    if (!loc || !id || !ID.test(id)) return json({ error: "That deal is not available" }, 404);
    const v = await healthView(who, loc, id, { run: true, fresh, trigger: "view" });
    return v ? json(v) : json({ error: "That deal is not available" }, 404);
  }

  // The three list jobs: an account id only narrows inside what the caller may read; one outside it is the same answer as nothing there.
  const loc = b.location ? await ownedAccount(ctx.installationId, allowed, b.location) : null;
  if (b.location && !loc) return json({ error: "That account is not available" }, 404);
  const day = (v: unknown) => (typeof v === "string" && DAY.test(v) ? v : null), time = (v: unknown) => (typeof v === "string" && TIME.test(v) ? v : null);
  const q: ListQuery = { from: day(b.from), to: day(b.to), fromTime: time(b.fromTime), toTime: time(b.toTime), location: loc, pipeline: text(b.pipeline, 120) };
  const r = job === "deal_followup" ? await followUp(who, q, { fresh, trigger: "view" }) : job === "deal_winloss" ? await winLoss(who, q, { fresh, trigger: "view" }) : await forecastWords(who, q, { fresh, trigger: "view" });
  return json(r);
}

