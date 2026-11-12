import { sql } from "../db";
import { accountRows, repRows, sumCounts, summarizeOutcomes, tallyByOwner, loggedShare, LOG_WINDOW_HOURS, COUNT_WINDOW_DAYS, MIN_OUTCOME_MEETINGS } from "../connections/meeting-logging";
import { callGroups, inScope, outcomeDays, peopleOf } from "../connections/meeting-logging-store";
import { personFromSession, statusScope, type Person, type StatusScope } from "../connections/person";
import type { Feature } from "../entitlements";
import { json, type AuthContext } from "./auth";

// Calls held, not logged, and what followed a call (docs/features/MEETINGS_BRIEF.md slices 3 and 4). Who is asking comes ONLY from the signed session; nothing about the
// person, the company or the account is read from the request, and the route takes no parameters at all. A person sees their own counts; an administrator also sees the people
// their status scope covers (the same scope as the team connections table). Counts only, for everyone: the answer holds no title, summary, attendee or transcript, so an owner
// never reads another person's call (rule 12). The numbers of a person's own row equal the rows of their Meeting inbox (the same statuses and reasons).

type Ctx = AuthContext & { request: Request; url: URL };

const on = (ctx: Ctx, f: Feature) => ctx.entitlements.features[f] === true && !ctx.entitlements.locked.includes(f);
const missing = (e: unknown) => { const c = (e as { code?: string } | null)?.code; return c === "42P01" || c === "42703"; };

async function accountNames(installationId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await sql()`select location_id, name from locations where installation_id = ${installationId} and location_id = any(${ids}::text[])`;
  return new Map(rows.map((r) => [r.location_id as string, (r.name as string | null) ?? "Unnamed account"]));
}

/** The accounts an administrator's scope covers, for the outcome history: null means every account of the installation. */
const accountsOfScope = (s: StatusScope): string[] | null => (s.kind === "all" ? null : s.kind === "account" ? [s.locationId] : s.kind === "listed" ? s.locationIds : []);

// The demo has no connected meeting tool, so it shows made-up counts for a fictional company (the whole demo is labelled sample data).
const c = (logged: number, needsContact: number, needsOk: number, needsPermission: number, failed: number, overdue: number) => {
  const notLogged = needsContact + needsOk + needsPermission + failed, held = logged + notLogged;
  return { held, logged, notLogged, overdue, needsContact, needsOk, needsPermission, failed, share: loggedShare({ ...sumCounts([]), held, logged }) };
};
function sampleLogged(logged: boolean, outcomes: boolean) {
  const reps = [
    { ...c(9, 3, 0, 0, 1, 3), name: "Dana (sample)", accountName: "Summit HVAC Services", isMe: true },
    { ...c(11, 2, 1, 0, 0, 1), name: "Marcus (sample)", accountName: "Summit HVAC Services", isMe: false },
    { ...c(14, 0, 0, 0, 0, 0), name: "Priya (sample)", accountName: "Harbor Law Group", isMe: false },
  ];
  const accounts = [
    { ...c(20, 5, 1, 0, 1, 4), name: "Summit HVAC Services" },
    { ...c(14, 0, 0, 0, 0, 0), name: "Harbor Law Group" },
  ];
  const total = c(34, 5, 1, 0, 1, 4);
  return {
    mine: logged ? reps[0] : null,
    team: logged ? { scope: "all", total, reps, accounts } : null,
    outcomes: outcomes ? { enough: true, total: 46, needed: 0, historyStarts: "2026-10-02", logged24hShare: 78, nextStepShare: 61, movedOrBookedShare: 37, logged24h: 36, nextStepSet: 28, movedOrBooked7d: 17 } : null,
  };
}

export async function meetingLoggedView(ctx: Ctx): Promise<Response> {
  const logged = on(ctx, "mn_logged"), outcomes = on(ctx, "mn_outcomes");
  const flags = { logged, outcomes };
  const base = { windowHours: LOG_WINDOW_HOURS, windowDays: COUNT_WINDOW_DAYS, minOutcomeMeetings: MIN_OUTCOME_MEETINGS };
  if (!logged && !outcomes) return json({ ...base, flags, mine: null, team: null, outcomes: null });
  if (ctx.demo) return json({ ...base, flags, demo: true, ...sampleLogged(logged, outcomes) });
  const person: Person | null = personFromSession(ctx.session, ctx.kind, ctx.limitTo);
  if (!person) return json({ error: "Please sign in again" }, 401);
  const scope = statusScope(person, null);
  const now = Date.now();
  try {
    const out: { mine: unknown; team: unknown; outcomes: unknown } = { mine: null, team: null, outcomes: null };
    if (logged) {
      const groups = await callGroups(ctx.installationId, scope.kind === "none" ? person.userId : null, now);
      const tallies = tallyByOwner(groups);
      const mine = tallies.get(person.userId);
      out.mine = mine ? { ...mine, share: loggedShare(mine) } : { ...sumCounts([]), share: null };
      if (scope.kind !== "none") {
        const owners = [...tallies.keys()];
        const people = await peopleOf(ctx.installationId, owners);
        const covered = inScope(scope, people, owners);
        const reps = repRows(new Map([...tallies].filter(([o]) => covered.has(o))), people);
        const accounts = accountRows(reps);
        const names = await accountNames(ctx.installationId, accounts.map((a) => a.locationId).filter((x): x is string => !!x));
        const total = sumCounts(reps);
        out.team = {
          scope: scope.kind, total: { ...total, share: loggedShare(total) },
          // The owner's row of a person is for that person only to open; here every row is a count.
          reps: reps.map((r) => ({ ...r, isMe: r.owner === person.userId, accountName: r.homeLocationId ? names.get(r.homeLocationId) ?? null : null, owner: undefined })),
          accounts: accounts.map((a) => ({ ...a, name: a.locationId ? names.get(a.locationId) ?? "Unnamed account" : null })),
        };
      }
    }
    if (outcomes && scope.kind !== "none") {
      const days = await outcomeDays(ctx.installationId, accountsOfScope(scope));
      out.outcomes = summarizeOutcomes(days);
    }
    return json({ ...base, flags, ...out });
  } catch (e) {
    // The table of the history does not exist until the migration is applied: say so plainly instead of failing the whole screen.
    if (missing(e)) return json({ ...base, flags, mine: null, team: null, outcomes: null, notReady: true });
    throw e;
  }
}
