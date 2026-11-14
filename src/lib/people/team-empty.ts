// What the Team screens say when there is nobody to show, and when there is nothing to do. Pure: no imports, used by the browser and by tests.
// Rule: "Nothing needs you right now" is only ever said when people were actually checked. An empty roster gets a plain reason and the fix instead.

import type { RoleFilter, RoleId } from "./roles";

export type UsersState = "ok" | "needs_permission" | "unknown";

export const NEEDS_PERMISSION_LINE = "Needs permission: reconnect to read your team.";
export const NO_OWNER_LINE = "No lead or appointment has an owner yet: assign owners in your CRM, then they appear here.";

/** Why the people list is empty, or null when there are people. */
export function noPeopleReason(i: { usersState: UsersState; people: number }): { title: string; body: string } | null {
  if (i.people > 0) return null;
  if (i.usersState === "needs_permission") return { title: NEEDS_PERMISSION_LINE, body: "SubSync could not read the list of people in your CRM. Reconnect SubSync and approve it, and your team appears here." };
  return { title: "No people to show yet", body: `${NO_OWNER_LINE} A new team list can take up to an hour to arrive after the first sync.` };
}

/** The one sentence at the top of Team > Today. */
export function todaySentence(i: { things: number; people: number; accounts: number; self: boolean }): { kind: "things" | "ok" | "nobody"; text: string } {
  if (i.things > 0) return { kind: "things", text: `${i.things === 1 ? "One thing needs" : `${i.things} things need`} ${i.self ? "you" : "you today"}.` };
  if (i.people === 0) return { kind: "nobody", text: "There is nobody to check yet." };
  if (i.self) return { kind: "ok", text: "Nothing needs you right now." };
  return { kind: "ok", text: `Nothing needs you right now. We checked ${i.people.toLocaleString("en-US")} ${i.people === 1 ? "person" : "people"} in ${i.accounts.toLocaleString("en-US")} ${i.accounts === 1 ? "account" : "accounts"}: nobody is behind.` };
}

/** One line for a person with no counts at all in the period, so an empty row never looks like a bug. */
export const NO_ACTIVITY_YET = "No activity recorded yet";
export const hasNoActivity = (c: { touches: number; answered: number; appts: number; won: number; lost: number; held: number; noShow: number }): boolean =>
  c.touches + c.answered + c.appts + c.won + c.lost + c.held + c.noShow === 0;

/** The line under a role screen row that has no suggestion: how far the person is from the minimum. */
export function suggestionProgress(actions: number, min: number): string {
  return `${Math.max(0, actions)} of ${min} actions so far`;
}

/** Settings (or any screen) leaves a tab name under this key in sessionStorage before opening Team; Team starts on that tab. */
export const TEAM_START_TAB_KEY = "subsync.team.start-tab";
/** The line above the People screens when some people have no role label. Null when everybody has one (or nobody can be asked). */
export function noRoleLine(none: number): string | null {
  return none > 0 ? `${none.toLocaleString("en-US")} ${none === 1 ? "person has" : "people have"} no role set.` : null;
}

/** Who a role chip shows, and which pages it needs. "setters" includes people who are both. */
export const ROLE_CHIPS: ReadonlyArray<[string, string]> = [["all", "Everyone"], ["setters", "Setters"], ["closers", "Closers"], ["manager", "Managers"], ["support", "Support"], ["other", "Other"]];
export const ROLE_SET_VALUES: ReadonlySet<string> = new Set(["all", "setters", "closers", "manager", "support", "other", "none"]);

/** A request value to a role filter. "all", empty or anything unknown is no filter. */
export function parseRoleSet(v: string | null | undefined): RoleFilter | null {
  const s = (v ?? "").trim();
  return s && s !== "all" && ROLE_SET_VALUES.has(s) ? (s as RoleFilter) : null;
}

/** The role labels a filter lets through. "setters" includes people labelled both; "none" is people with no label at all. */
export function roleSetValues(f: RoleFilter): { roles: RoleId[]; orNone: boolean } {
  if (f === "all") return { roles: ["setter", "closer", "both", "support", "manager", "other"], orNone: true };
  if (f === "none") return { roles: [], orNone: true };
  if (f === "setters") return { roles: ["setter", "both"], orNone: false };
  if (f === "closers") return { roles: ["closer", "both"], orNone: false };
  return { roles: [f], orNone: false };
}
