import { ratesFromOutcomes } from "../../../../lib/design/appt-flow-layout.ts";
import type {
  Appt3BookingShare, Appt3Calendars, Appt3FlowTree, Appt3Health, Appt3NeedsOutcome, Appt3Overview, Appt3Receipt, Appt3Recovery, Appt3Row, Appt3Sources, FlowNode, Page, Rate,
  ApCalendarsView, ApConflictRow, ApFlowCloser, ApFlowSetter, ApFlowTree, ApHealthRow, ApOutcome, ApOverview, ApPersonRow, ApProof, ApRow, ApSourceRow, ApSpeedBand, ApStatus,
} from "./types";

// Turns the real response of /api/app/appointments?part=... (slice AD's types, appointments3-types.ts) into the shapes the screens draw. Pure, so it is unit tested.
// Money: the API sends dollars, the screens count whole cents. Pages: the API is 0-based with `size`, the screens are 1-based with `pageSize`.

const v = (r: Rate | null | undefined) => (r && r.enough ? r.value : null);
const cents = (d: number | null | undefined) => (d === null || d === undefined ? null : Math.round(d * 100));

/** Screen part name and query names -> the API's. */
export const API_PART: Record<string, string> = { "no-show-recovery": "noshow-recovery", proof: "receipt" };
export const API_PARAM: Record<string, string> = { booker: "setter", owner: "closer", outcome: "bucket", pageSize: "size" };

const STATUS: Record<string, ApStatus> = { showed: "showed", noshow: "noshow", cancelled: "cancelled", invalid: "invalid", completed: "completed" };
export function adaptRow(r: Appt3Row, now = Date.now()): ApRow {
  const start = Date.parse(r.startAt), past = start < now;
  const flags: ApRow["flags"] = [];
  if (r.hasConflict) flags.push("double-booked");
  if (r.dealStatus === null) flags.push("no-deal");
  return {
    id: r.appointmentId, locationId: r.locationId, accountName: r.accountName ?? "", contactId: r.contactId ?? "", contactName: r.contactName, startAt: r.startAt, calendarName: r.calendarName ?? "",
    status: STATUS[r.bucket] ?? "booked", ownerId: r.ownerId, ownerName: r.ownerName, bookerId: r.bookerId, bookerName: r.bookerName, source: r.source, phone: r.phone,
    dealValueCents: cents(r.dealValue), dealStatus: r.dealStatus ?? "none", hoursPast: past ? Math.max(0, (now - start) / 3_600_000) : null, flags, url: r.url ?? null, calendarId: r.calendarId ?? null,
  };
}
export function adaptList(p: Appt3NeedsOutcome | Appt3Recovery | Page<Appt3Row>, now?: number) {
  return { total: p.total, page: p.page + 1, pageSize: p.size, rows: (p.rows ?? []).map((r) => adaptRow(r, now)) };
}

export function adaptOverview(o: Appt3Overview, extra: { health?: Appt3Health | null; tree?: Appt3FlowTree | null } = {}): ApOverview {
  const rank = (extra.health?.rows ?? []).filter((r) => r.noshowRate.enough && r.noshowRate.value !== null).sort((a, b) => (b.noshowRate.value ?? 0) - (a.noshowRate.value ?? 0))[0];
  const top = (extra.tree?.nodes ?? []).filter((n) => n.level === "setter" && n.badges && n.badges.showRate.enough).sort((a, b) => (b.badges!.showRate.value ?? 0) - (a.badges!.showRate.value ?? 0))[0];
  const at = o.revenueAtRisk;
  return {
    today: o.today,
    headline: { needsOutcome: o.unmarked, noShowsToRecover: o.noshowToRecover, reportedShowRate: v(o.reportedShowRate), trueShowRate: v(o.trueShowRate), trueRange: null, marked: Math.max(0, (o.trueShowRate?.of ?? 0) - o.unmarked), booked: o.booked },
    revenueAtRisk: at && at.enough && at.low !== null && at.high !== null ? { lowCents: cents(at.low)!, highCents: cents(at.high)!, basis: at.formula } : null,
    journey: (o.journey ?? []).map((j) => ({ key: j.key, label: j.label, count: j.count })),
    cards: {
      worstAccount: rank ? { id: rank.locationId, name: rank.accountName ?? "Account", noShowRate: rank.noshowRate.value! } : null,
      topSetter: top ? { id: top.userId ?? "none", name: top.label, showRate: top.badges!.showRate.value! } : null,
      leak: extra.tree?.leak?.text ?? null,
    },
    needsPermission: false,
  };
}

const LEAF: Record<string, ApOutcome> = { showed: "showed", noshow: "noshow", cancelled: "cancelled", unmarked: "unmarked", won: "won", lost: "lost" };
const emptyOutcomes = (): Record<ApOutcome, number> => ({ won: 0, lost: 0, showed: 0, noshow: 0, cancelled: 0, unmarked: 0 });
function stats(n: FlowNode) {
  const b = n.badges;
  return { bookings: b?.bookings ?? n.count, showRate: v(b?.showRate), noShowRate: v(b?.noshowRate), closeRate: v(b?.closeRate), revenueCents: cents(b?.wonValue) ?? 0, avgLeadToBookedHours: b?.leadToBookedMedianMinutes == null ? null : b.leadToBookedMedianMinutes / 60 };
}
export function adaptFlow(t: Appt3FlowTree, periodLabel = "This period"): ApFlowTree {
  const nodes = t.nodes ?? [];
  const kids = (id: string) => nodes.filter((n) => n.parentId === id);
  const totals = emptyOutcomes();
  const setters: ApFlowSetter[] = nodes.filter((n) => n.level === "setter").map((s) => {
    const closers: ApFlowCloser[] = kids(s.id).filter((c) => c.level === "closer").map((c) => {
      const outcomes = emptyOutcomes();
      for (const l of kids(c.id)) if (l.leaf && LEAF[l.leaf]) { outcomes[LEAF[l.leaf]] += l.count; totals[LEAF[l.leaf]] += l.count; }
      return { id: c.userId ?? "none", name: c.label, outcomes, ...stats(c) };
    });
    return { id: s.userId ?? "none", name: s.label, closers, hiddenClosers: 0, ...stats(s) };
  });
  const min = 5;
  return { booked: t.totalBooked ?? 0, periodLabel, setters, hiddenSetters: t.hiddenPeople ?? 0, totals, overall: ratesFromOutcomes(totals, min), minBookings: min };
}

export function adaptShare(s: Appt3BookingShare): { rows: ApPersonRow[] } {
  return {
    rows: (s.rows ?? []).map((p) => ({
      id: p.userId ?? "none", name: p.name, role: p.role === "closer" ? "closer" : p.role === "both" ? "both" : "setter", unassigned: p.userId === null,
      bookings: p.role === "closer" ? p.owned : p.booked, showRate: v(p.showRate), noShowRate: v(p.noshowRate), closeRate: v(p.closeRate), revenueCents: cents(p.wonValue) ?? 0,
      avgLeadToBookedHours: p.leadToBookedMedianMinutes === null ? null : p.leadToBookedMedianMinutes / 60, trend: (p.trend ?? []).map((t) => t.booked),
    })),
  };
}

export function adaptHealth(h: Appt3Health): { rows: ApHealthRow[] } {
  return { rows: (h.rows ?? []).map((r) => ({ locationId: r.locationId, name: r.accountName ?? "Account", booked: r.booked, showRate: v(r.showRate), noShowRate: v(r.noshowRate), cancelRate: v(r.cancelRate), unmarked: r.unmarked })) };
}

export function adaptSources(s: Appt3Sources): { sources: ApSourceRow[]; speed: ApSpeedBand[] } {
  return {
    sources: (s.bySource ?? []).map((r) => ({ source: r.source, booked: r.booked, showRate: v(r.showRate), medianFirstReplyMinutes: null, won: r.closeRate.value !== null ? Math.round(r.closeRate.value * r.closeRate.of) : 0 })),
    speed: (s.bySpeed ?? []).map((r) => ({ label: r.label, booked: r.booked, showRate: v(r.showRate) })),
  };
}

export function adaptCalendars(c: Appt3Calendars): ApCalendarsView {
  const conflicts: ApConflictRow[] = (c.conflicts?.rows ?? []).map((x) => ({
    id: `${x.a.appointmentId}:${x.b.appointmentId}`, kind: "double-booking", accountName: x.accountName ?? "", calendarName: x.calendarName ?? "", when: x.a.startAt,
    people: [x.a.contactName, x.b.contactName], note: `${x.overlapMinutes} minutes overlap`,
  }));
  return {
    rows: conflicts,
    calendars: (c.calendarsAll ?? []).map((x) => ({ ...x, accountName: x.accountName ?? "", calendarName: x.calendarName ?? "Calendar" })),
    people: c.peopleAll ?? [], problems: c.problems ?? [],
  };
}

export function adaptReceipt(r: Appt3Receipt): { rows: ApProof[] } {
  return { rows: [{ weekOf: r.weekStart, weekEnd: r.weekEnd, locationId: r.locationId, accountName: r.accountName ?? "All accounts", booked: r.booked, showed: r.showed, recovered: r.recovered, stillUnmarked: r.stillUnmarked, trueShowRate: v(r.trueShowRate), caught: r.noshow, fixed: r.fixedByUs }] };
}

/** One entry point: the screen part name and the raw API body. `extra` carries the other parts the overview cards need. */
export function adaptPart(part: string, raw: unknown, extra: { health?: unknown; tree?: unknown } = {}): unknown {
  if (!raw || typeof raw !== "object") return raw;
  switch (part) {
    case "overview": return adaptOverview(raw as Appt3Overview, { health: extra.health as Appt3Health | null, tree: extra.tree as Appt3FlowTree | null });
    case "needs-outcome": case "no-show-recovery": case "list": return adaptList(raw as Page<Appt3Row>);
    case "booking-share": return adaptShare(raw as Appt3BookingShare);
    case "flow-tree": return adaptFlow(raw as Appt3FlowTree);
    case "health": return adaptHealth(raw as Appt3Health);
    case "sources": return adaptSources(raw as Appt3Sources);
    case "calendars": return adaptCalendars(raw as Appt3Calendars);
    case "proof": return adaptReceipt(raw as Appt3Receipt);
  }
  return raw;
}
