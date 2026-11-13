import { getReport } from "../analytics/proof-queries";
import { getSettings } from "../analytics/queries";
import { getSummary, needingDraft, saveDraft, saveSummary } from "../analytics/proof-summary";
import { validPeriod } from "../analytics/proof-core";
import { anomalyContext, accountsWithJob, journeysFor, meetingOf, oneThingCandidates, peopleWindow, scanAnomalies } from "../ai/team/data";
import { anomalyValues, coachReady, fallbackLine, summaryReady, TONE_LABEL, TONES, isTone, type Anomaly, type Tone } from "../ai/team/facts";
import { OPT_IN_JOBS, TEAM_JOB_IDS, TEAM_JOBS, type TeamJobId } from "../ai/team/jobs";
import { listPrefs, loadEffective, savePrefs, type PrefsPatch } from "../ai/team/prefs";
import { coachNote, explainAnomaly, leadStories, meetingDraft, oneThing, reportSummary, type Fail, type Mode, type Who } from "../ai/team/run";
import { publicConnection } from "../ai/store";
import { sql } from "../db";
import type { Feature } from "../entitlements";
import { resolveEntitlements } from "../flags";
import { json, type AuthContext } from "./auth";
import { personFromSession } from "../connections/person";
import { ownedLocation } from "./tenant-guard";

// /api/app/ai-team?part=status|prefs|report|leads|coach|anomalies|one-thing|meeting and POST /api/app/ai-team/act/<prefs|report-summary|report-summary-all|save-summary|lead-stories|coach|anomaly|one-thing|meeting>.
// The team and client jobs (docs/AI_AGENTS_PLAN.md section 9). Who is asking and which accounts they may read come ONLY from the signed session (`personFromSession`, `allowed`); an account id in a request
// goes through ownedLocation and only narrows inside `allowed`. Each job has its own feature flag on top of ai_byo. Suggest only: nothing is sent to a client or a lead and nothing is written to
// the CRM. Reading a page never calls the AI (`peek`); only an explicit button does.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
type Deps = { allowed: () => Promise<string[] | null> };
const FLAG = { report_summary: "ai_report", lead_story: "ai_leads", coach_note: "ai_coach", anomaly_explain: "ai_anomaly", meeting_summary: "ai_meeting", one_thing: "ai_one_thing" } as const satisfies Record<TeamJobId, string>;
export const TEAM_FLAGS = Object.values(FLAG);

const body = async (ctx: Ctx): Promise<Record<string, unknown>> => { try { const x = await ctx.request.json(); return x && typeof x === "object" ? (x as Record<string, unknown>) : {}; } catch { return {}; } };
const refused = (f: Fail) => json({ ok: false, code: f.code, error: f.message });
const num = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };

export async function handleAiTeam(ctx: Ctx, deps: Deps): Promise<Response> {
  const ent = await resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo);
  const on = (f: string) => ent.features[f as Feature] === true;
  if (!on("ai_byo") || !TEAM_FLAGS.some(on)) return json({ error: "This AI feature is not switched on for your account yet." }, 404);
  const user = ctx.session.userId ?? null;
  if (!user) return json({ error: "Please sign in again" }, 401);
  const isAct = ctx.segments[1] === "act", sp = ctx.url.searchParams, part = sp.get("part") ?? "status";
  // Who may manage and see everyone in scope: the company owner or an administrator (company-wide), or an account's own administrator (that account only). Everyone else sees only their own things.
  const person = personFromSession(ctx.session, ctx.kind, ctx.limitTo);
  const level: "all" | "account" | "self" = !person ? "self" : ctx.kind === "agency" ? (ctx.limitTo === null && (person.role === "agency_owner" || person.role === "agency_admin") ? "all" : "self") : person.role === "account_admin" ? "account" : "self";
  const manager = level !== "self";
  const allowed = await deps.allowed();
  const flags = { report: on("ai_report"), leads: on("ai_leads"), coach: on("ai_coach"), anomaly: on("ai_anomaly"), meeting: on("ai_meeting"), oneThing: on("ai_one_thing") };
  const inst = ctx.installationId;
  const who = (loc: string, trigger: Who["trigger"] = "view", more: Partial<Who> = {}): Who => ({ installationId: inst, locationId: loc, userKey: user, trigger, ...more });
  /** The account an id names, inside what the caller may read; for a one-account session the account itself when none is named. */
  const account = async (raw: unknown): Promise<string | null> => {
    const id = typeof raw === "string" && raw ? raw : !raw && ctx.limitTo ? ctx.limitTo : null;
    return id ? ownedLocation(inst, allowed, id) : null;
  };
  const need = (job: TeamJobId): Response | null => (on(FLAG[job]) ? null : json({ error: "This AI feature is not switched on for your account yet." }, 404));

  // ---------------------------------------------------------------- reads
  if (!isAct) {
    if (part === "status") {
      const conn = await publicConnection(inst, ctx.limitTo ?? "").catch(() => null);
      return json({ flags, canManage: manager, connected: Boolean(conn) || Boolean(await publicConnection(inst, "").catch(() => null)), jobs: TEAM_JOB_IDS.map((j) => ({ id: j, title: TEAM_JOBS[j].title, optIn: OPT_IN_JOBS.includes(j), on: on(FLAG[j]) })), tones: TONES.map((t) => ({ id: t, label: TONE_LABEL[t] })) });
    }
    if (part === "prefs") {
      if (!manager) return json({ error: "Ask the owner or an administrator." }, 403);
      const r = await listPrefs(inst, allowed, (sp.get("q") ?? "").trim().slice(0, 60), Math.max(0, num(sp.get("page"), 0)), 20);
      return json({ ...r, size: 20, jobs: TEAM_JOB_IDS.map((j) => ({ id: j, title: TEAM_JOBS[j].title, optIn: OPT_IN_JOBS.includes(j) })), tones: TONES.map((t) => ({ id: t, label: TONE_LABEL[t] })), level });
    }
    if (part === "report") {
      const bad = need("report_summary"); if (bad) return bad;
      if (ctx.kind !== "agency" || !manager) return json({ error: "Not available in this view" }, 403);
      const month = sp.get("period"), loc = await account(sp.get("account"));
      if (!validPeriod(month, new Date())) return json({ error: "Choose a month" }, 400);
      if (!loc) return json({ error: "Client account not found" }, 404);
      const [row, s, eff] = await Promise.all([getReport(inst, loc, month), getSummary(inst, loc, month), loadEffective(inst, loc)]);
      return json({ ...s, builtAt: row?.builtAt ?? null, ready: row ? summaryReady(row.payload) : false, jobOn: eff.jobs.report_summary, tone: eff.tone, shared: row?.status === "shared" });
    }
    if (part === "leads") {
      const bad = need("lead_story"); if (bad) return bad;
      if (!manager) return json({ error: "Ask the owner or an administrator." }, 403);
      const loc = await account(sp.get("account"));
      if (!loc) return json({ error: "Client account not found" }, 404);
      const eff = await loadEffective(inst, loc), st = await getSettings(inst);
      const days = Math.min(90, Math.max(7, num(sp.get("days"), 30))), page = Math.max(0, num(sp.get("page"), 0));
      const j = await journeysFor(inst, loc, { days, page, size: 25, countAutomated: st.countAutomatedTouches, defaultTarget: st.speedTargetMinutes, withNames: eff.leadNames });
      if (!j) return json({ error: "Client account not found" }, 404);
      const peek = await leadStories(who(loc, "view", { mode: "peek" }), j.rows, j.targetMinutes);
      return json({ ...j, names: eff.leadNames, jobOn: eff.jobs.lead_story, days, stories: peek.ok ? peek.lines : j.rows.map((r) => fallbackLine(r, j.targetMinutes)), aiLines: peek.ok ? peek.aiLines : j.rows.map(() => false), note: peek.ok ? null : peek.message });
    }
    if (part === "coach") {
      const bad = need("coach_note"); if (bad) return bad;
      const asked = sp.get("user") ?? "";
      if (!manager && asked && asked !== user) return json({ error: "A coaching note is private to the person and their manager." }, 403);
      const target = manager ? asked || user : user;
      return coach(ctx, who, allowed, target, await account(sp.get("account")), "peek");
    }
    if (part === "anomalies") {
      const bad = need("anomaly_explain"); if (bad) return bad;
      if (!manager) return json({ error: "Ask the owner or an administrator." }, 403);
      const loc = sp.get("account") ? await account(sp.get("account")) : null;
      if (sp.get("account") && !loc) return json({ error: "Client account not found" }, 404);
      const list = await scanAnomalies(inst, loc ? [loc] : allowed);
      return json({ rows: list.map((a) => ({ locationId: a.locationId, name: a.name, ...a.anomaly, ...anomalyValues(a.anomaly) })), checked: "this week against the four weeks before it" });
    }
    if (part === "one-thing") {
      const bad = need("one_thing"); if (bad) return bad;
      if (!manager) return json({ error: "Ask the owner or an administrator." }, 403);
      const loc = await account(sp.get("account"));
      if (!loc) return json({ error: "Client account not found" }, 404);
      const r = await oneThing(who(loc, "view", { mode: "peek" }), await oneThingCandidates(inst, loc));
      return json(r.ok ? { ok: true, text: r.text, top: r.top } : { ok: false, code: r.code, error: r.message });
    }
    if (part === "meeting") {
      const bad = need("meeting_summary"); if (bad) return bad;
      return meeting(ctx, who, allowed, user, sp.get("id") ?? "", "peek");
    }
    return json({ error: "Not found" }, 404);
  }

  // ---------------------------------------------------------------- writes and runs
  if (ctx.request.method !== "POST") return json({ error: "Not found" }, 404);
  if (ctx.demo) return json({ error: "The sample data cannot be changed." }, 403);
  const act = ctx.segments[2], b = await body(ctx);

  switch (act) {
    case "prefs": {
      if (!manager) return json({ error: "Ask the owner or an administrator." }, 403);
      const raw = typeof b.location === "string" ? b.location : "";
      // The company default is for the company owner or an administrator of the company; an account's own administrator sets only their own account.
      const loc = raw ? await ownedLocation(inst, allowed, raw) : level === "all" ? "" : null;
      if (loc === null) return json({ error: "Client account not found" }, 404);
      const patch: PrefsPatch = {};
      if (b.jobs && typeof b.jobs === "object") {
        const out: Record<string, boolean | null> = {};
        for (const j of TEAM_JOB_IDS) { const x = (b.jobs as Record<string, unknown>)[j]; if (typeof x === "boolean" || x === null) out[j] = x; }
        patch.jobs = out as PrefsPatch["jobs"];
      }
      if (typeof b.leadNames === "boolean" || b.leadNames === null) patch.leadNames = b.leadNames as boolean | null;
      if (b.tone !== undefined) { if (b.tone === null) patch.tone = null; else if (isTone(b.tone)) patch.tone = b.tone as Tone; else return json({ error: "Choose a tone from the list." }, 400); }
      if (loc !== "" && patch.tone !== undefined) patch.tone = undefined; // tone is the company's, not each account's
      await savePrefs(inst, loc, patch, user);
      return json({ ok: true });
    }
    case "report-summary": {
      const bad = need("report_summary"); if (bad) return bad;
      if (ctx.kind !== "agency" || !manager) return json({ error: "Not available in this view" }, 403);
      const month = b.month, loc = await account(b.account);
      if (!validPeriod(month, new Date())) return json({ error: "Choose a month" }, 400);
      if (!loc) return json({ error: "Client account not found" }, 404);
      return json(await writeOne(inst, loc, month as string, who(loc, "preview", { fresh: b.fresh === true })));
    }
    case "report-summary-all": {
      const bad = need("report_summary"); if (bad) return bad;
      if (ctx.kind !== "agency" || !manager) return json({ error: "Not available in this view" }, 403);
      const month = b.month;
      if (!validPeriod(month, new Date())) return json({ error: "Choose a month" }, 400);
      // A few accounts per request (the provider is rate limited and each answer is read in full); the screen calls again until nothing remains or something stops it.
      const todo = await needingDraft(inst, allowed, month as string, 5);
      let drafted = 0, stopped: { code: string; message: string } | null = null, skipped = 0;
      for (const loc of todo.ids) {
        const r = await writeOne(inst, loc, month as string, who(loc, "scheduled"));
        if (r.ok) drafted++;
        else if (r.code === "not_enough" || r.code === "job_off") { skipped++; await markSkipped(inst, loc, month as string); }
        else { stopped = { code: r.code, message: r.error }; break; }
      }
      return json({ ok: true, drafted, skipped, stopped, remaining: Math.max(0, todo.remaining - drafted - skipped) });
    }
    case "save-summary": {
      const bad = need("report_summary"); if (bad) return bad;
      if (ctx.kind !== "agency" || !manager) return json({ error: "Not available in this view" }, 403);
      const loc = await account(b.account);
      if (!loc || typeof b.month !== "string") return json({ error: "Client account not found" }, 404);
      const r = await saveSummary(inst, loc, b.month, b.text, user);
      return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status);
    }
    case "lead-stories": {
      const bad = need("lead_story"); if (bad) return bad;
      if (!manager) return json({ error: "Ask the owner or an administrator." }, 403);
      const loc = await account(b.account);
      if (!loc) return json({ error: "Client account not found" }, 404);
      const eff = await loadEffective(inst, loc), st = await getSettings(inst);
      const days = Math.min(90, Math.max(7, Number(b.days) || 30)), page = Math.max(0, Math.floor(Number(b.page) || 0));
      const j = await journeysFor(inst, loc, { days, page, size: 25, countAutomated: st.countAutomatedTouches, defaultTarget: st.speedTargetMinutes, withNames: eff.leadNames });
      if (!j) return json({ error: "Client account not found" }, 404);
      const r = await leadStories(who(loc, "preview", { fresh: b.fresh === true }), j.rows, j.targetMinutes);
      return r.ok ? json({ ok: true, stories: r.lines, aiLines: r.aiLines, runId: r.runId, costUsd: r.costUsd }) : refused(r);
    }
    case "coach": {
      const bad = need("coach_note"); if (bad) return bad;
      const asked = typeof b.user === "string" ? b.user : "";
      if (!manager && asked && asked !== user) return json({ error: "A coaching note is private to the person and their manager." }, 403);
      return coach(ctx, who, allowed, manager ? asked || user : user, await account(b.account), "run", b.fresh === true);
    }
    case "anomaly": {
      const bad = need("anomaly_explain"); if (bad) return bad;
      if (!manager) return json({ error: "Ask the owner or an administrator." }, 403);
      const loc = await account(b.account);
      if (!loc) return json({ error: "Client account not found" }, 404);
      const found = (await scanAnomalies(inst, [loc])).find((a) => a.anomaly.key === b.key);
      if (!found) return json({ ok: false, code: "not_enough", error: "That number is back inside its normal range." });
      const r = await explainAnomaly(who(loc, "preview", { fresh: b.fresh === true }), found.anomaly as Anomaly, await anomalyContext(inst, loc));
      return r.ok ? json({ ok: true, summary: r.summary, reasons: r.reasons, runId: r.runId, costUsd: r.costUsd, cached: r.cached }) : refused(r);
    }
    case "one-thing": {
      const bad = need("one_thing"); if (bad) return bad;
      if (!manager) return json({ error: "Ask the owner or an administrator." }, 403);
      const loc = await account(b.account);
      if (!loc) return json({ error: "Client account not found" }, 404);
      const r = await oneThing(who(loc, "preview", { fresh: b.fresh === true }), await oneThingCandidates(inst, loc));
      return r.ok ? json({ ok: true, text: r.text, top: r.top, runId: r.runId, costUsd: r.costUsd }) : refused(r);
    }
    case "meeting": {
      const bad = need("meeting_summary"); if (bad) return bad;
      return meeting(ctx, who, allowed, user, typeof b.id === "string" ? b.id : "", "run", b.fresh === true);
    }
  }
  return json({ error: "Not found" }, 404);
}

/** Drafts one report summary and keeps it as a DRAFT for the agency to review. Nothing here changes what a client sees. */
async function writeOne(inst: string, loc: string, month: string, w: Who): Promise<{ ok: true; text: string; runId: string | null; costUsd: number } | { ok: false; code: string; error: string }> {
  const row = await getReport(inst, loc, month);
  if (!row) return { ok: false, code: "not_enough", error: "Prepare this report first." };
  if (row.status === "shared") return { ok: false, code: "not_enough", error: "This report is shared. Take it back to a draft first." };
  const r = await reportSummary(w, row.payload);
  if (!r.ok) return { ok: false, code: r.code, error: r.message };
  if (!(await saveDraft(inst, loc, month, r.text))) return { ok: false, code: "error", error: "The draft could not be saved." };
  return { ok: true, text: r.text, runId: r.runId, costUsd: r.costUsd };
}
/** A report with too little behind it gets an empty marker draft so "Draft all" does not retry it forever; the agency sees "not enough recorded". */
async function markSkipped(inst: string, loc: string, month: string): Promise<void> {
  await sql()`update pr_reports set summary_draft = '', summary_draft_at = now() where installation_id = ${inst} and location_id = ${loc} and period = ${month + "-01"}::date and status = 'draft' and summary is null and summary_draft is null`.catch(() => undefined);
}

async function coach(ctx: Ctx, who: (loc: string, t?: Who["trigger"], more?: Partial<Who>) => Who, allowed: string[] | null, target: string, loc: string | null, mode: Mode, fresh = false): Promise<Response> {
  const inst = ctx.installationId;
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(target)) return json({ error: "Not found" }, 404);
  const ids = loc ? [loc] : await accountsWithJob(inst, allowed, "coach_note");
  const base = await loadEffective(inst, loc ?? "");
  if (!ids.length || (loc && !base.jobs.coach_note)) return json({ ok: false, code: "job_off", error: "Coaching notes are switched off for these client accounts. They are opt-in: switch them on in Settings, AI." });
  const { people, team } = await peopleWindow(inst, ids);
  const me = people.get(target);
  if (!me) return json({ ok: false, code: "not_enough", error: "No recorded activity for this person in the last 30 days." });
  const st = await getSettings(inst);
  const nums = { firstReplies: me.firstReplies, replyMinutes: me.replyMinutes, inTimePct: me.inTimePct, showPct: me.showPct, apptsSet: me.apptsSet, outcomesMarked: me.outcomesMarked, touches: me.touches, days: me.days };
  const eff = loc ? base : { ...base, jobs: { ...base.jobs, coach_note: true } };
  const r = await coachNote(who(loc ?? "", mode === "run" ? "preview" : "view", { mode, fresh, eff }), nums, team, st.speedTargetMinutes);
  const figures = { ...nums, ready: coachReady(nums), team: team.people >= 3 ? team : null };
  return r.ok ? json({ ok: true, strengths: r.strengths, fix: r.fix, runId: r.runId, figures }) : json({ ok: false, code: r.code, error: r.message, figures });
}

async function meeting(ctx: Ctx, who: (loc: string, t?: Who["trigger"], more?: Partial<Who>) => Who, allowed: string[] | null, user: string, id: string, mode: Mode, fresh = false): Promise<Response> {
  const m = await meetingOf(ctx.installationId, user, id);
  if (!m) return json({ error: "Not found" }, 404);
  // The account the call belongs to decides the opt-in. A call not matched to an account uses the company's choice, and the one account of a business session when there is one.
  const loc = m.locationId && (!allowed || allowed.includes(m.locationId)) ? m.locationId : ctx.limitTo ?? "";
  const r = await meetingDraft(who(loc, mode === "run" ? "preview" : "view", { mode, fresh }), { summary: m.summary, actionItems: m.actionItems });
  return r.ok ? json({ ok: true, summary: r.summary, followUp: r.followUp, runId: r.runId, costUsd: r.costUsd }) : json({ ok: false, code: r.code, error: r.message });
}

