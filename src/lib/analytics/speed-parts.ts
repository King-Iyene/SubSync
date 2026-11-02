// What the Speed to lead screen shows, built from the lead records. Pure (no database, no network): the query layer loads rows and lookups, this
// builds every figure AND the list behind it from the same rows, so a count and the leads it counts cannot disagree (KF-6), and so it is unit tested.
import { classifySource, autoVsHuman, bySource, hasNoSource, isNeverAnswered, judge, membersOf, NO_SOURCE, peopleProgress, progressToward, responseSeconds, SOURCE_CLASS_LABEL, sourceLabel, summarise, unknownSource, MIN_FOR_MEDIAN, MIN_PER_PERSON, type AutoVsHuman, type Judged, type Progress, type Summary, type TouchRow } from "./speed-intel";
import { resolveUser, type KnownUser, type PersonLabel, type UsersState } from "./people-labels";

export type LoadedRow = TouchRow & { name: string; assignedTo: string | null };

export type Lookups = {
  now: number; targetMinutes: number;
  locationNames: ReadonlyMap<string, string>;
  /** How the last read of the team list went, per client account. */
  usersAccess: ReadonlyMap<string, UsersState>;
  team: ReadonlyMap<string, KnownUser>;
};

export type LeadOut = {
  locationId: string; locationName: string; contactId: string; name: string;
  status: Judged;
  /** Waiting more than three days with nobody replying: missed, not waiting. */
  neverAnswered: boolean;
  /** Minutes from the lead arriving to the person's reply, or the minutes waited so far when nobody has replied. */
  minutes: number;
  /** What the lead's source says, in words ("No source recorded" when blank). */
  source: string;
  repliedBy: PersonLabel | null;
  owner: PersonLabel | null;
  unassigned: boolean;
  /** Seconds to the automatic first message, and to the person's reply (only for leads read since both were recorded). */
  autoSeconds: number | null; personSeconds: number | null; detailed: boolean;
};
export type Members = { count: number; shown: number; rows: LeadOut[] };

const seconds = (leadAt: number, at: number | null | undefined) => (at == null ? null : Math.max(0, Math.round((at - leadAt) / 1000)));

export function leadOut(r: LoadedRow, status: Judged, lk: Lookups): LeadOut {
  const waited = Math.round((lk.now - r.leadAt) / 60_000);
  const who = (id: string | null) => (id ? resolveUser(id, lk.team, lk.usersAccess.get(r.locationId)) : null);
  return {
    locationId: r.locationId, locationName: lk.locationNames.get(r.locationId) ?? "Client account", contactId: r.contactId, name: r.name,
    status, neverAnswered: status === "waiting" && isNeverAnswered(waited),
    minutes: r.touchAt === null ? waited : Math.round((r.touchAt - r.leadAt) / 60_000),
    source: sourceLabel(r.source),
    repliedBy: r.touchAt !== null ? who(r.userId) : null,
    owner: who(r.assignedTo), unassigned: r.assignedTo === null,
    autoSeconds: r.detailed ? seconds(r.leadAt, r.autoAt) : null, personSeconds: r.detailed ? seconds(r.leadAt, r.humanAt) : null, detailed: r.detailed === true,
  };
}

/** The leads behind one figure: the true count and the first `cap` rows, the ones that need attention first. */
export function membersPart(rows: LoadedRow[], lk: Lookups, keep: (r: LoadedRow, status: Judged) => boolean, cap = 100): Members {
  const m = membersOf(rows, lk.targetMinutes, lk.now, (r, s) => keep(r as LoadedRow, s), cap);
  return { count: m.count, shown: m.rows.length, rows: m.rows.map((x) => leadOut(x.row as LoadedRow, x.status, lk)) };
}

// ---- the cards ----

export type SummaryPart = {
  summary: Summary;
  /** Progress toward the minimum for the typical reply: "1 of 5 replies so far". */
  typical: Progress;
  lists: { within: Members; late: Members; waiting: Members; onlyAuto: Members };
  autoVsHuman: AutoVsHuman;
  /** A lead with no source at all, as a share of this card's leads. */
  unknownSource: ReturnType<typeof unknownSource>;
};
// The leads that count in a figure: the ones judged against the account target (a lead still inside its window is counted neither way).
const judgedOnly = (rows: LoadedRow[], lk: Lookups) => rows.filter((r) => judge(r, lk.targetMinutes, lk.now) !== null);

export function summaryPart(rows: LoadedRow[], lk: Lookups): SummaryPart {
  const summary = summarise(rows, lk.targetMinutes, lk.now);
  return {
    summary,
    typical: progressToward(summary.answered, MIN_FOR_MEDIAN, "replies"),
    lists: {
      within: membersPart(rows, lk, (_r, s) => s === "within"),
      late: membersPart(rows, lk, (_r, s) => s === "late"),
      waiting: membersPart(rows, lk, (_r, s) => s === "waiting"),
      // Only an automatic message went out and nobody has replied, past the target: the same leads autoVsHuman counts as onlyAutoPastTarget.
      onlyAuto: membersPart(rows, lk, (r) => r.detailed === true && r.autoAt != null && r.humanAt == null && (lk.now - r.leadAt) / 60_000 > lk.targetMinutes),
    },
    autoVsHuman: autoVsHuman(rows, lk.targetMinutes, lk.now),
    unknownSource: unknownSource(judgedOnly(rows, lk)),
  };
}

export type SourcePartRow = ReturnType<typeof bySource>[number] & { label: string; members: Members };
export type SourcePart = { rows: SourcePartRow[]; unknown: ReturnType<typeof unknownSource> & { members: Members }; total: number };
export function sourcePart(rows: LoadedRow[], lk: Lookups): SourcePart {
  const judgedRows = judgedOnly(rows, lk);
  return {
    rows: bySource(rows, lk.targetMinutes, lk.now).map((s) => ({
      ...s, label: SOURCE_CLASS_LABEL[s.cls],
      // The class's own target decides who is late, so its list is judged against that target, the same one its figures use.
      members: (() => { const m = membersOf(rows.filter((r) => classifySource(r.source, r.tags) === s.cls), s.targetMinutes, lk.now, () => true, 100); return { count: m.count, shown: m.rows.length, rows: m.rows.map((x) => leadOut(x.row as LoadedRow, x.status, { ...lk, targetMinutes: s.targetMinutes })) }; })(),
    })),
    unknown: { ...unknownSource(judgedRows), members: membersPart(rows, lk, (r) => hasNoSource(r), 100) },
    total: judgedRows.length,
  };
}

export type AccountPartRow = Summary & { locationId: string; name: string; access: string | null; members: Members };
export function accountsPart(rows: LoadedRow[], lk: Lookups, accounts: Array<{ locationId: string; name: string; access: string | null }>): AccountPartRow[] {
  return accounts.map((a) => {
    const mine = rows.filter((r) => r.locationId === a.locationId);
    return { locationId: a.locationId, name: a.name, access: a.access, ...summarise(mine, lk.targetMinutes, lk.now), members: membersPart(mine, lk, () => true, 50) };
  }).filter((a) => a.leads > 0 || a.access === "needs_permission")
    .sort((a, b) => b.stillWaiting - a.stillWaiting || (a.hitRate ?? 2) - (b.hitRate ?? 2));
}

export type PersonPartRow = PersonLabel & { userId: string; replies: number; medianSeconds: number | null; ranked: boolean; progress: Progress; members: Members };
export function peoplePart(rows: LoadedRow[], lk: Lookups, limit = 12): PersonPartRow[] {
  return peopleProgress(rows).slice(0, limit).map((p) => {
    // The person's account decides how their name can be read; a person can only appear under the accounts they replied in.
    const sample = rows.find((r) => r.userId === p.userId);
    const label = resolveUser(p.userId, lk.team, sample ? lk.usersAccess.get(sample.locationId) : null);
    return {
      ...label, userId: p.userId, replies: p.replies, medianSeconds: p.medianSeconds, ranked: p.ranked,
      progress: progressToward(p.replies, MIN_PER_PERSON, "replies"),
      members: membersPart(rows, lk, (r) => r.userId === p.userId && r.touchAt !== null, 100),
    };
  });
}

export { responseSeconds, NO_SOURCE };
