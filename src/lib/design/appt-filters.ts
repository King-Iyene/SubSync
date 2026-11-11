// The Appointments filters and how they travel in the address (pure, unit tested).
export type ApFilters = { days: 7 | 30 | 90; locationId: string; calendarId: string; source: string; q: string; userId: string };
export const DEFAULT_FILTERS: ApFilters = { days: 30, locationId: "", calendarId: "", source: "", q: "", userId: "" };

/** The filters live in the address (?ap_days=30&ap_loc=...) so a view can be shared and survives a reload. Pure, so it is unit tested. */
export function filtersToParams(f: ApFilters): Record<string, string> {
  const o: Record<string, string> = {};
  if (f.days !== 30) o.ap_days = String(f.days);
  if (f.locationId) o.ap_loc = f.locationId;
  if (f.calendarId) o.ap_cal = f.calendarId;
  if (f.userId) o.ap_user = f.userId;
  if (f.source) o.ap_src = f.source;
  if (f.q) o.ap_q = f.q;
  return o;
}
export function filtersFromParams(p: URLSearchParams): ApFilters {
  const id = (v: string | null) => (v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : "");
  const d = Number(p.get("ap_days"));
  return { days: d === 7 || d === 90 ? d : 30, locationId: id(p.get("ap_loc")), calendarId: id(p.get("ap_cal")), userId: id(p.get("ap_user")), source: (p.get("ap_src") ?? "").slice(0, 120), q: (p.get("ap_q") ?? "").slice(0, 60) };
}
