import { SECTION_LABEL, type Brief } from "../analytics/br-core";
import { appointmentView } from "../analytics/appointment-queries";
import { getSettings } from "../analytics/queries";
import { speedView } from "../analytics/speed-queries";
import { sql } from "../db";
import { runJob, hashInput, idempotencyKey, killedGlobally, type Deps, type JobResult } from "./gateway";
import { dbStore, publicConnection } from "./store";

// Job 1: the 7 am brief writer. Our code works out every number (br-core.ts); the model only writes a short note around them. The input is built here, on the server, from this
// tenant's own brief: counts and dollars by default. Titles and reasons (which can carry client or person names) are added ONLY after the account's own opt-in. Suggest only: nothing is
// sent to a lead or written to the CRM.

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const TIER = { 1: "something stops working today", 2: "money is at risk", 3: "people are waiting", 4: "a tidy-up" } as const;

export type Facts = { text: string; fields: string[]; includesNames: boolean };

/** The exact text sent to the model for the whole-company brief. Pure. */
export function briefFacts(b: Brief, shareNames: boolean): Facts {
  const lines = [
    `Day: ${b.dayText}`,
    `Client accounts watched: ${b.accounts}`,
    `Estimated revenue at risk (an estimate): ${b.dollar.amount !== null ? money(b.dollar.amount) : "no honest figure"}`,
    `Items needing a look today: ${b.items.length}`,
    ...b.items.map((it) => `- Area: ${SECTION_LABEL[it.section]}; count: ${it.count}; estimated dollars: ${it.dollars !== null && it.dollars > 0 ? money(it.dollars) : "none"}; priority: ${TIER[it.tier]}${shareNames ? `; title: ${it.title}; why: ${it.why}` : ""}`),
  ];
  const fields = ["day", "number of client accounts", "estimated revenue at risk", "number of items", "area name, count, estimated dollars and priority of each item"];
  if (shareNames) fields.push("title and reason of each item (may contain client or person names)");
  return { text: lines.join("\n"), fields, includesNames: shareNames };
}

/** The same for ONE client account, from numbers our own queries already produced. Pure. */
export type AccountNumbers = { name: string | null; leads: number; answeredInTime: number; targetMinutes: number; neverAnswered: number; noShowsToRecover: number | null; unmarked: number | null };
export function accountFacts(a: AccountNumbers, shareNames: boolean): Facts {
  const lines = [
    `Account: ${shareNames && a.name ? a.name : "this client account"}`,
    `New leads in the period: ${a.leads}`,
    `Answered within ${a.targetMinutes} minutes: ${a.answeredInTime}`,
    `Never answered: ${a.neverAnswered}`,
    ...(a.noShowsToRecover !== null ? [`No-shows still to win back: ${a.noShowsToRecover}`] : []),
    ...(a.unmarked !== null ? [`Appointments with no outcome recorded: ${a.unmarked}`] : []),
  ];
  const fields = ["number of leads, answered in time, never answered", "answer-time target in minutes", "no-shows to win back and appointments with no outcome"];
  if (shareNames && a.name) fields.push("the account name");
  return { text: lines.join("\n"), fields, includesNames: shareNames && Boolean(a.name) };
}

export const realDeps = (): Deps => ({ store: dbStore, fetch: (url, init) => fetch(url, init as RequestInit) as never, killAll: killedGlobally });

type Args = { installationId: string; userKey: string | null; trigger: "scheduled" | "preview" | "view"; fresh?: boolean; deps?: Deps };

/** The account-wide note for a brief. Null unless the company has an AI connection, the brief job is on and the answer passes the number check. */
export async function companyNote(a: Args, b: Brief): Promise<{ result: JobResult; facts: Facts }> {
  const conn = await publicConnection(a.installationId, "");
  const facts = briefFacts(b, conn?.shareNames === true);
  return { facts, result: await runJob(a.deps ?? realDeps(), { installationId: a.installationId, locationId: "", userKey: a.userKey, job: "brief", trigger: a.trigger, input: facts, fresh: a.fresh }) };
}

/** The note only if it was already written for exactly today's numbers (so opening the page never calls the provider). */
export async function peekCompanyNote(installationId: string, b: Brief, deps?: Deps): Promise<string | null> {
  const conn = await publicConnection(installationId, "");
  if (!conn || conn.paused || conn.status !== "connected" || conn.jobs.brief !== true) return null;
  const facts = briefFacts(b, conn.shareNames);
  const hit = await (deps?.store ?? dbStore).cachedRun(installationId, "", idempotencyKey(installationId, "", "brief", hashInput(facts.text)));
  return hit?.output ?? null;
}

/** For the scheduled email: the wording or null. Never throws, never blocks the brief. */
export async function wordingForEmail(installationId: string, b: Brief): Promise<string | null> {
  try {
    const r = await companyNote({ installationId, userKey: null, trigger: "scheduled" }, b);
    return r.result.ok ? r.result.text : null;
  } catch { return null; }
}

// ---------------- one client account ----------------

/** The numbers for ONE client account, read from our own queries limited to that account. Null when they cannot be read. */
export async function accountNumbers(installationId: string, locationId: string): Promise<AccountNumbers | null> {
  try {
    const target = (await getSettings(installationId).catch(() => null))?.speedTargetMinutes ?? 15;
    const [sp, ap, loc] = await Promise.all([
      speedView(installationId, [locationId], target), appointmentView(installationId, [locationId]).catch(() => null),
      sql()`select name from locations where installation_id = ${installationId} and location_id = ${locationId}`,
    ]);
    return { name: (loc[0]?.name as string | undefined) ?? null, leads: sp.overall.leads, answeredInTime: sp.overall.withinTarget, targetMinutes: target, neverAnswered: sp.neverAnswered, noShowsToRecover: ap ? ap.recoverTotal : null, unmarked: ap ? ap.unmarkedTotal : null };
  } catch { return null; }
}

/** A short note about one client account. The account's own connection is used first, then the company's; either way only this account's numbers are in the input. */
export async function accountNote(a: Args & { locationId: string }): Promise<{ result: JobResult; facts: Facts | null }> {
  const own = await publicConnection(a.installationId, a.locationId), conn = own ?? (await publicConnection(a.installationId, ""));
  const n = await accountNumbers(a.installationId, a.locationId);
  if (!n) return { facts: null, result: { ok: false, code: "error", message: "The numbers for this account could not be read." } };
  const facts = accountFacts(n, conn?.shareNames === true);
  return { facts, result: await runJob(a.deps ?? realDeps(), { installationId: a.installationId, locationId: a.locationId, userKey: a.userKey, job: "brief", trigger: a.trigger, input: facts, fresh: a.fresh }) };
}
