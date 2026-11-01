// The request handlers of stage F8, kept out of router.ts so that file only gains a few dispatch lines: Give feedback, Report a problem, Suggest something,
// the settings history and the permission groups. Every handler takes who is asking from the verified session (the router passes it in); nothing in the
// request body names a company, an account or a person.
import { personKey, parseFeedback, parseProblem, parseSuggestion } from "../feedback.ts";
import { feedbackGivenBy, mySuggestions, saveFeedback, saveProblem, saveSuggestion, settingsHistory, type Who } from "../feedback-queries";
import { json, type AuthContext } from "./auth";

export const whoOf = (ctx: AuthContext): Who => ({
  installationId: ctx.installationId, kind: ctx.kind, limitTo: ctx.limitTo,
  who: personKey(ctx.kind, ctx.limitTo, ctx.session.userId), actor: ctx.session.userName ?? ctx.session.userId ?? null,
});

const TOO_MANY = "You have sent a lot of feedback today. Thank you. Please try again tomorrow, or email us.";

async function body(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

export async function giveFeedback(ctx: AuthContext, request: Request): Promise<Response> {
  const parsed = parseFeedback(await body(request));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const saved = await saveFeedback(whoOf(ctx), parsed.value);
  if (!saved.ok) return json({ error: TOO_MANY }, 429);
  return json({ ok: true, reference: saved.reference });
}

export async function reportProblem(ctx: AuthContext, request: Request): Promise<Response> {
  const parsed = parseProblem(await body(request));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const saved = await saveProblem(whoOf(ctx), parsed.value);
  if (!saved.ok) return json({ error: TOO_MANY }, 429);
  return json({ ok: true, reference: saved.reference });
}

export async function suggest(ctx: AuthContext, request: Request): Promise<Response> {
  const parsed = parseSuggestion(await body(request));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const saved = await saveSuggestion(whoOf(ctx), parsed.value);
  if (!saved.ok) return json({ error: TOO_MANY }, 429);
  return json({ ok: true, reference: saved.reference });
}

/** The caller's own suggestions, for the What's new page. */
export async function ownSuggestions(ctx: AuthContext) {
  return mySuggestions(ctx.installationId, whoOf(ctx).who);
}

/** The history of settings changes: agency and business sessions only (the route policy refuses a client's). */
export async function history(ctx: AuthContext): Promise<Response> {
  return json({ rows: await settingsHistory(ctx.installationId) });
}

export async function feedbackCount(ctx: AuthContext): Promise<number> {
  return feedbackGivenBy(ctx.installationId, whoOf(ctx).who);
}
