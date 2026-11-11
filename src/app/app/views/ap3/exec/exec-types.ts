import type { ApFilters } from "../data";

export type Basis = "appt" | "booked";
/** What the Leadership tab needs from the shared filter bar. When the bar grows (two date axes, compare, calendar group, deal stage), only `execScopeOf` changes. */
export type ExecScope = { from: string; to: string; basis?: Basis; locationId: string; calendarId: string; userId: string; booker: string; owner: string; source: string; status: string; stage: string; bookedFrom?: string; bookedTo?: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Turns the module's filter object into the tab's scope. Reads the extra keys (basis, stage) loosely so a richer filter bar needs no change here. */
export function execScopeOf(f: ApFilters, now = new Date()): ExecScope {
  const x = f as ApFilters & { basis?: string; stage?: string; dateBasis?: string; bookedFrom?: string; bookedTo?: string };
  const custom = !!f.from && !!f.to;
  const to = custom ? f.to : iso(now), from = custom ? f.from : iso(new Date(now.getTime() - f.days * 86_400_000));
  const b = x.basis ?? x.dateBasis;
  return { from, to, basis: b === "booked" ? "booked" : undefined, locationId: f.locationId, calendarId: f.calendarId, userId: f.userId, booker: f.booker, owner: f.owner, source: f.source, status: f.status, stage: x.stage ?? "", bookedFrom: x.bookedFrom && x.bookedTo ? x.bookedFrom : undefined, bookedTo: x.bookedFrom && x.bookedTo ? x.bookedTo : undefined };
}
