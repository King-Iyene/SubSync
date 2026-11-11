// Team role labels (Setter, Closer, ...). The CRM has no such title, so the agency gives each team member one inside SubSync. Pure: no imports, safe for the browser and the server.
// Every module reads a person's label through this file: resolveRole() for one person, matchesRole() to filter, roleWord() for the words. Nothing here writes to the CRM.

export const ROLE_IDS = ["setter", "closer", "both", "support", "manager", "other"] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export const ROLE_LABEL: Record<RoleId, string> = { setter: "Setter", closer: "Closer", both: "Setter and closer", support: "Support", manager: "Manager", other: "Other" };
/** Short label for a chip beside a name. */
export const ROLE_SHORT: Record<RoleId, string> = { setter: "Setter", closer: "Closer", both: "Both", support: "Support", manager: "Manager", other: "Other" };
export const ROLE_TIP: Record<RoleId, string> = {
  setter: "Books the appointments: answers new leads and gets them on the calendar.",
  closer: "Takes the appointments and closes the deal.",
  both: "Books appointments and also takes them.",
  support: "Helps with questions and service, not with selling.",
  manager: "Leads the team.",
  other: "Anything else.",
};
/** The one line that explains the two words people ask about most. Shown as a tooltip wherever "Setter" or "Closer" appears. */
export const SETTER_CLOSER_TIP = "Setter: books the appointment. Closer: takes the appointment and closes the deal.";
/** What an Appointments screen calls the person who booked, until the agency has set any roles. */
export const BOOKED_BY = "Booked by";

export const isRoleId = (v: unknown): v is RoleId => typeof v === "string" && (ROLE_IDS as readonly string[]).includes(v);

/** The stored rows for one person: location_id '' is "everywhere", any other is one account only. */
export type RoleRow = { userId: string; locationId: string; role: RoleId };
export type RoleIndex = Map<string, Map<string, RoleId>>;

export function indexRoles(rows: readonly RoleRow[]): RoleIndex {
  const m: RoleIndex = new Map();
  for (const r of rows) {
    if (!isRoleId(r.role)) continue;
    const per = m.get(r.userId) ?? new Map<string, RoleId>();
    per.set(r.locationId ?? "", r.role);
    m.set(r.userId, per);
  }
  return m;
}

/** A person's role in one account: the account's own row first, then the "everywhere" row, otherwise null (no role set). */
export function resolveRole(index: RoleIndex, userId: string | null | undefined, locationId?: string | null): RoleId | null {
  if (!userId) return null;
  const per = index.get(userId);
  if (!per) return null;
  return (locationId ? per.get(locationId) : undefined) ?? per.get("") ?? null;
}

/** Does this role belong to a filter? "setter" includes people who are both; "closer" likewise. "none" is people with no role set. */
export type RoleFilter = RoleId | "setters" | "closers" | "none" | "all";
export function matchesRole(role: RoleId | null, f: RoleFilter): boolean {
  if (f === "all") return true;
  if (f === "none") return role === null;
  if (f === "setters") return role === "setter" || role === "both";
  if (f === "closers") return role === "closer" || role === "both";
  return role === f;
}

/** The words for a role, or null when none is set. */
export const roleWord = (r: RoleId | null, short = true): string | null => (r ? (short ? ROLE_SHORT[r] : ROLE_LABEL[r]) : null);

/** Do any people have a Setter or Closer label? Appointments say "Booked by" until this is true, then "Setter" and "Closer". */
export function hasSetterCloser(roles: ReadonlyArray<RoleId | null>): boolean {
  return roles.some((r) => r === "setter" || r === "closer" || r === "both");
}
/** The column or line label for the person who booked, following the rule above. */
export const bookedByLabel = (anyRoles: boolean): string => (anyRoles ? "Setter" : BOOKED_BY);
/** The column or line label for the person who takes the appointment. */
export const takenByLabel = (anyRoles: boolean): string => (anyRoles ? "Closer" : "Assigned to");

// ---------------- a suggested role, from behaviour (never applied by itself) ----------------

export type RoleEvidence = { booked: number; attended: number; days: number };
export type RoleSuggestion = { role: RoleId; why: string; estimate: true };
/** Under this many appointments in the window the behaviour says nothing, so nothing is suggested. */
export const MIN_SUGGEST = 8;

/** booked = appointments this person created that someone else may attend; attended = appointments assigned to them that were held or missed.
 *  Mostly booking: likely setter. Mostly attending: likely closer. Plenty of both: likely both. An estimate, with the evidence in words. */
export function suggestRole(e: RoleEvidence): RoleSuggestion | null {
  const { booked, attended } = e;
  if (booked + attended < MIN_SUGGEST) return null;
  const span = `in the last ${e.days} days`;
  const b = `${booked} ${booked === 1 ? "appointment" : "appointments"} booked`, a = `${attended} taken`;
  if (booked >= 5 && attended <= booked * 0.2) return { role: "setter", why: `Books many appointments others attend: ${b} and only ${a} ${span}.`, estimate: true };
  if (attended >= 5 && booked <= attended * 0.2) return { role: "closer", why: `Takes most of the appointments assigned to them: ${a} and only ${b} ${span}.`, estimate: true };
  if (booked >= 5 && attended >= 5) return { role: "both", why: `Both books and takes appointments: ${b} and ${a} ${span}.`, estimate: true };
  return null;
}

// ---------------- changing roles: parse, preview, plan ----------------

export const BULK_CAP = 200;
export type Change = { userId: string; locationId: string; from: RoleId | null; to: RoleId | null };

/** What a bulk change will do, one entry per person, skipping people who already have that role. `current` is each person's stored role for the scope being changed. */
export function planRoleChange(current: ReadonlyMap<string, RoleId | null>, userIds: readonly string[], to: RoleId | null, locationId: string): { changes: Change[]; unchanged: number } {
  const changes: Change[] = [];
  let unchanged = 0;
  for (const userId of new Set(userIds)) {
    const from = current.get(userId) ?? null;
    if (from === to) unchanged++;
    else changes.push({ userId, locationId, from, to });
  }
  return { changes, unchanged };
}

/** One plain sentence for the preview. */
export function previewLine(changes: readonly Change[], unchanged: number, to: RoleId | null, scope: "everywhere" | "one account"): string {
  const n = changes.length;
  if (n === 0) return unchanged > 0 ? "Nobody needs changing: they already have this." : "Nobody selected.";
  const what = to ? `the role ${ROLE_LABEL[to]}` : "no role";
  const where = scope === "everywhere" ? "in every client account (unless an account has its own)" : "in this client account only";
  return `Give ${n} ${n === 1 ? "person" : "people"} ${what} ${where}.${unchanged > 0 ? ` ${unchanged} already ${unchanged === 1 ? "has" : "have"} it.` : ""} Nothing is changed in your CRM.`;
}

/** The typed words that confirm a bulk change large enough to matter (more than 25 people). */
export const BIG_CHANGE = 25;
