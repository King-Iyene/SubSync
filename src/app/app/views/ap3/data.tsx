"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ComponentType } from "react";
import { useData } from "../../session";
import { CONFLICTS_FIXTURE, FLOW_EMPTY, FLOW_FIXTURE, HEALTH_FIXTURE, OVERVIEW_FIXTURE, PEOPLE_FIXTURE, PROOF_FIXTURE, SOURCES_FIXTURE, SPEED_FIXTURE, page, rowsFixture } from "./fixtures";
import { adaptPart, API_PARAM, API_PART } from "./adapters";
import type { ApPart, ApPersonRow, ApRow, ApScope } from "./types";

/** Scope the user picks. `days` is turned into from/to on the server's day boundaries; everything else is passed through and re-checked on the server (never trusted). */
export { DEFAULT_FILTERS, filtersFromParams, filtersToParams, FILTER_KEYS, AGE_OPTIONS, STATUS_OPTIONS, SORT_OPTIONS, type ApFilters } from "@/lib/design/appt-filters";
import { DEFAULT_FILTERS, type ApFilters } from "@/lib/design/appt-filters";
import { addDays, localDay } from "@/lib/design/zone";

const FX = /[?&]apfx=(1|empty|error)/;
function fxFound(): string {
  if (typeof window === "undefined") return "";
  // The shell may rewrite the address, so the address the page was first opened with counts too.
  const first = (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.name ?? "";
  const m = FX.exec(window.location.href) ?? FX.exec(first);
  try { if (m) sessionStorage.setItem("ap3.fx", m[1]); return m ? m[1] : sessionStorage.getItem("ap3.fx") ?? ""; } catch { return m ? m[1] : ""; }
}
if (typeof window !== "undefined") fxFound(); // remember ?apfx at load: the shell may drop the query before the module renders
export const fixturesOn = () => fxFound() !== "";
const fxMode = () => { const v = fxFound(); return v === "empty" || v === "error" ? v : ""; };

export function scopeOf(f: ApFilters): ApScope {
  const to = localDay(Date.now()), from = addDays(to, -f.days); // days in the account time zone (docs/DATE_RULES.md)
  const custom = !!f.from && !!f.to; // a chosen date range replaces the preset days
  return { from: custom ? f.from : from, to: custom ? f.to : to, locationId: f.locationId || undefined, calendarId: f.calendarId || undefined, source: f.source || undefined, userId: f.userId || undefined };
}
export function queryOf(part: ApPart, f: ApFilters, extra: Record<string, string | number | undefined> = {}): string {
  const s = scopeOf(f); const p = new URLSearchParams({ part: API_PART[part] ?? part, from: s.from, to: s.to });
  if (s.locationId) p.set("location", s.locationId);
  if (s.calendarId) p.set("calendar", s.calendarId);
  if (s.source) p.set("source", s.source);
  if (s.userId) p.set("user", s.userId);
  if (f.status && part !== "needs-outcome") p.set("status", f.status);
  if (f.groupId) p.set("group", f.groupId);
  if (f.outcome) p.set("x_outcome", f.outcome);
  if (f.deal) p.set("x_deal", f.deal);
  if (f.stage) p.set("x_stage", f.stage);
  if (f.leadAge) p.set("x_lead", f.leadAge);
  if (f.contact) p.set("x_contact", f.contact);
  if (f.attention) p.set("x_attention", "1");
  if (f.active) p.set("active", f.active);
  if (f.bookedFrom && f.bookedTo) { p.set("booked_from", f.bookedFrom); p.set("booked_to", f.bookedTo); }
  if (f.q.trim()) p.set("q", f.q.trim());
  // The worklist filters only travel to the two worklists, so a number on another section is never narrowed by a filter that is not shown there.
  if (part === "needs-outcome" || part === "no-show-recovery") {
    if (f.booker) p.set("setter", f.booker);
    if (f.owner) p.set("closer", f.owner);
    if (f.age) p.set("age", String(f.age));
    if (f.sort) p.set("sort", f.sort);
    if (f.status && part === "needs-outcome") p.set("status", f.status);
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === "" || k === "expect") continue;
    p.set(API_PARAM[k] ?? k, String(k === "page" ? Math.max(0, Number(v) - 1) : v)); // the screens count pages from 1, the API from 0
  }
  return `appointments?${p}`;
}

function fixtureFor(part: ApPart, extra: Record<string, string | number | undefined>): unknown {
  const pg = Number(extra.page ?? 1), size = Number(extra.pageSize ?? 20);
  const mk = (kind: "needs" | "recover" | "all", n: number) => page(rowsFixture(n, kind).slice((pg - 1) * size, pg * size), n, pg, size);
  switch (part) {
    case "overview": return OVERVIEW_FIXTURE;
    case "needs-outcome": return mk("needs", 23);
    case "no-show-recovery": return mk("recover", 17);
    case "list": return mk("all", Number(extra.expect ?? 41));
    case "booking-share": {
      const sec = String(extra.section ?? "active"), calP = (n: number) => Array.from({ length: n }, (_, i) => ({ calendarId: `c${i}`, name: `Calendar ${i + 1}`, groupName: null, active: true }));
      const idle = (id: string, name: string, cals: number, setRole: string | null): ApPersonRow => ({ id, name, role: "setter", bookings: 0, showRate: null, noShowRate: null, closeRate: null, revenueCents: 0, avgLeadToBookedHours: null, trend: [], setRole, calendarCount: cals, calendars: calP(cals), state: "never", sold: 0, soldCents: 0, soldFromBookings: 0, soldRate: null, ownedShowed: 0, showed: 0, noShow: 0 });
      const active = PEOPLE_FIXTURE.map((p, i) => (p.unassigned ? p : { ...p, setRole: i % 3 === 2 ? "closer" : "setter", calendarCount: 2 + (i % 3), calendars: calP(2 + (i % 3)), showed: Math.round(p.bookings * (p.showRate ?? 0)), noShow: Math.round(p.bookings * (p.noShowRate ?? 0)), sold: i % 3 === 2 ? 3 + i : 0, soldCents: i % 3 === 2 ? 180_000 * (i + 1) : 0, soldFromBookings: i % 3 === 2 ? 0 : 2 + i, soldRate: i % 3 === 2 ? 0.3 : null, ownedShowed: i % 3 === 2 ? 12 : 0 }));
      const rows = sec === "oncal" ? [idle("i1", "Amara Eze", 2, "setter"), idle("i2", "Tunde Bello", 1, "closer"), idle("i3", "Rita Cole", 3, null)] : sec === "off" ? [idle("o1", "Sam Reed", 0, null), idle("o2", "Joy Okoro", 0, "setter")] : active;
      const sold = active.reduce((a, p) => a + (p.sold ?? 0), 0);
      return { rows, total: rows.length, rosterTotal: 25, roles: [{ key: "account_user", label: "Account user", n: 20 }, { key: "account_admin", label: "Account admin", n: 5 }], counts: { withBookings: active.length - 1, none: 5 }, sections: { active: active.length, oncal: 3, off: 2 },
        summary: { peopleBooked: active.length - 1, booked: 142, showed: 88, showRate: 0.71, sold, soldCents: active.reduce((a, p) => a + (p.soldCents ?? 0), 0) }, sale: { basis: "deal_won", countWithoutValue: true, available: true, phrase: "counted from deals won", rule: "Closer: whoever the meeting was assigned to. Setter: whoever booked it.", reason: null, roleFallback: false } };
    }
    case "flow-tree": return FLOW_FIXTURE;
    case "health": return { rows: HEALTH_FIXTURE };
    case "sources": return { sources: SOURCES_FIXTURE, speed: SPEED_FIXTURE };
    case "calendars": return { rows: CONFLICTS_FIXTURE, calendars: [], people: [], problems: [] };
    case "proof": return { rows: PROOF_FIXTURE };
  }
}

/** One part of the appointments API, or its typed fixture with ?apfx=1 (?apfx=empty and ?apfx=error show the other two states). */
export function useAp<T>(part: ApPart, f: ApFilters, extra: Record<string, string | number | undefined> = {}) {
  const fx = fixturesOn(), mode = fx ? fxMode() : "";
  const key = queryOf(part, f, extra);
  const raw = useData<unknown>(fx ? null : key);
  // The overview cards (worst account, best setter, the leak) come from the health and flow-tree parts of the same period.
  const more = !fx && part === "overview";
  const hx = useData<unknown>(more ? queryOf("health", { ...f, locationId: f.locationId }) : null);
  const tx = useData<unknown>(more ? queryOf("flow-tree", f) : null);
  const adapted = useMemo(() => (raw.data ? (adaptPart(part, raw.data, { health: hx.data, tree: tx.data }) as T) : null), [raw.data, hx.data, tx.data, part]);
  const live = { data: adapted, error: raw.error, loading: raw.loading, reload: () => { raw.reload(); if (more) { hx.reload(); tx.reload(); } } };
  const [fix, setFix] = useState<{ data: T | null; error: boolean; loading: boolean }>({ data: null, error: false, loading: fx });
  const reload = useCallback(() => {
    if (!fx) return void live.reload();
    setFix((s) => ({ ...s, loading: true }));
    setTimeout(() => {
      if (mode === "error") return setFix({ data: null, error: true, loading: false });
      if (mode === "empty") return setFix({ data: (part === "flow-tree" ? FLOW_EMPTY : part === "overview" ? { ...OVERVIEW_FIXTURE, headline: { ...OVERVIEW_FIXTURE.headline, booked: 0, marked: 0, needsOutcome: 0, noShowsToRecover: 0, showed: 0, passed: 0, atRisk: 0, trueShowRate: null, reportedShowRate: null, trueRange: null }, revenueAtRisk: null, journey: [], cards: { worstAccount: null, topSetter: null, leak: null } } : { total: 0, page: 1, pageSize: 20, rows: [], sources: [], speed: [] }) as T, error: false, loading: false });
      setFix({ data: fixtureFor(part, extra) as T, error: false, loading: false });
    }, 260);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx, mode, key]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (fx) reload(); }, [fx, reload]);
  return fx ? { data: fix.data, error: fix.error ? ({ message: "Could not load this" } as never) : null, loading: fix.loading, reload } : live;
}

export type ApRows = { total: number; page: number; pageSize: number; rows: ApRow[]; /** The keyset cursor of the next page (null on the last page). */ next?: string | null };

// A tiny registry so slice AB can mount the appointment details content (timeline, booker, deal, reminders, edit, delete) and the Meetings section without touching these files.
export type ApSlotName = "Details" | "Meetings" | "RowActions" | "BulkActions";
type SlotProps = { row?: ApRow; rows?: ApRow[]; onChanged?: () => void; filters?: ApFilters };
const slots = new Map<ApSlotName, ComponentType<SlotProps>>(); const subs = new Set<() => void>(); let ver = 0;
export function registerApSlot(name: ApSlotName, c: ComponentType<SlotProps>) { slots.set(name, c); ver++; subs.forEach((f) => f()); }
export function ApSlot({ name, ...props }: { name: ApSlotName } & SlotProps) {
  useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => ver, () => 0);
  const C = slots.get(name);
  // eslint-disable-next-line react-hooks/static-components -- a registered slot is a stable component, registered once at start-up
  return C ? <C {...props} /> : null;
}
export const hasApSlot = (n: ApSlotName) => slots.has(n);
export const useMemoFilters = (f: ApFilters) => useMemo(() => f, [f.days, f.locationId, f.source, f.q, f.userId, f.calendarId, f.from, f.to, f.booker, f.owner, f.status, f.age, f.sort]); // eslint-disable-line react-hooks/exhaustive-deps
