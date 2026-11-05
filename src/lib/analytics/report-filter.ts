import { isIsoDay, MAX_FLOW_DAYS, resolveFlowRange, type FlowPreset } from "./lead-flow.ts";

// The filter bar each report tab of Today carries: dates and (for a company with several clients) one client. State lives in the address after the # so a link, a reload and the
// back button keep it, and a drill-down opens the same people the mark counted. Each tab has its own prefix: Growth "g" (gr gf gt gc), Lead flow "l", Clients "c", Proof "p", Sources "s", Coverage "v".
// <prefix>r = range choice, <prefix>f / <prefix>t = custom start and end, <prefix>c = client id, or "all" when "All clients" was chosen on purpose (no value = follow the header).

export type ReportState = { preset: FlowPreset | null; from: string; to: string; client: string | null };
const ID = /^[A-Za-z0-9_-]{3,64}$/;
const PRESETS = new Set<string>(["7d", "30d", "this-month", "last-month", "90d", "custom"]);

export function readReportState(hash: string, prefix: string): ReportState {
  const q = hash.indexOf("?");
  const p = new URLSearchParams(q === -1 ? "" : hash.slice(q + 1));
  const r = p.get(`${prefix}r`), f = p.get(`${prefix}f`), t = p.get(`${prefix}t`), c = p.get(`${prefix}c`);
  return { preset: r && PRESETS.has(r) ? (r as FlowPreset) : null, from: isIsoDay(f) ? f : "", to: isIsoDay(t) ? t : "", client: c === "all" ? "all" : c && ID.test(c) ? c : null };
}
/** The address with this tab's choices set; a null or empty value removes the part. Everything else in the address stays. */
export function writeReportState(hash: string, prefix: string, patch: Partial<ReportState>): string {
  const q = hash.indexOf("?");
  const head = q === -1 ? hash : hash.slice(0, q);
  const p = new URLSearchParams(q === -1 ? "" : hash.slice(q + 1));
  const set = (k: string, v: string | null | undefined) => { if (v) p.set(`${prefix}${k}`, v); else p.delete(`${prefix}${k}`); };
  if ("preset" in patch) set("r", patch.preset);
  if ("from" in patch) set("f", patch.from);
  if ("to" in patch) set("t", patch.to);
  if ("client" in patch) set("c", patch.client);
  if (patch.preset && patch.preset !== "custom") { set("f", null); set("t", null); }
  const rest = p.toString().replace(/%2C/gi, ",");
  return `${head || "#today"}${rest ? `?${rest}` : ""}`;
}
export const isDefaultState = (s: ReportState, defaultPreset: FlowPreset) => (s.preset === null || s.preset === defaultPreset) && s.client === null;

/** The days a state means, given today's date. A missing or wrong choice falls back to the tab's own default. */
export const rangeOf = (s: ReportState, defaultPreset: FlowPreset, today: string) => resolveFlowRange(s.preset ?? defaultPreset, today, s.from, s.to);

/** The server's reading of `from`, `to` and `client`. A bad date is a plain 400; a client the caller may not read is refused (404), never silently widened. */
export type ParsedReport = { ok: true; from: string | null; to: string | null; client: string | null } | { ok: false; status: 400 | 404; error: string };
export function parseReportParams(url: URL, permits: (locationId: string) => boolean): ParsedReport {
  const from = url.searchParams.get("from"), to = url.searchParams.get("to"), client = url.searchParams.get("client");
  if ((from !== null || to !== null) && (!isIsoDay(from) || !isIsoDay(to) || from > to)) return { ok: false, status: 400, error: "Pick a start date and an end date that is not before it." };
  if (from && to && (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1 > MAX_FLOW_DAYS) return { ok: false, status: 400, error: `Pick at most ${MAX_FLOW_DAYS} days.` };
  if (client !== null && client !== "" && (!ID.test(client) || !permits(client))) return { ok: false, status: 404, error: "That client is not in your list." };
  return { ok: true, from, to, client: client || null };
}
