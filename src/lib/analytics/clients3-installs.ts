// Which client accounts have SubSync installed, and on which plan, from the platform's installed list (agency token, permission oauth.readonly, live-verified 13 Nov 2026).
// GET /oauth/installedLocations?companyId&appId&skip&limit (Version 2021-07-28). Each item: _id, name, isInstalled, versionId, installedAt, planId, trial { onTrial }.
// The platform gives NO trial end date and NO payment status for the app on this list. Pure logic (no database), tested with mocked responses.
import type { Getter, Resp } from "./clients3-saas.ts";

export type InstallRow = { locationId: string; name: string | null; installed: boolean; versionId: string | null; installedAt: string | null; planId: string | null; onTrial: boolean | null };
export type AccessState = "ok" | "needs_permission" | "not_available";

const dig = (o: unknown, ...keys: string[]): unknown => { let c = o; for (const k of keys) { if (c && typeof c === "object") c = (c as Record<string, unknown>)[k]; else return undefined; } return c; };
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);

/** The platform's own words when the permission was never granted to this install ("The token is not authorized for this scope."). */
export function scopeRefusal(status: number, body: unknown): boolean {
  if (status !== 401 && status !== 403) return false;
  const msg = String(dig(body, "message") ?? "").toLowerCase();
  return msg.includes("not authorized for this scope") || msg.includes("not authorised for this scope");
}

/** Three honest states for one read. "needs_permission" = the install never granted the permission (reconnect fixes it). "not_available" = the platform answered but does not give this to this app or account. */
export function accessState(r: Resp, granted: string[] | null, needScope: string): AccessState {
  if (r.status >= 200 && r.status < 300) return "ok";
  if (r.status === 401 || r.status === 403) {
    if (scopeRefusal(r.status, r.body)) return "needs_permission";
    if (granted && !granted.includes(needScope)) return "needs_permission";
  }
  return "not_available";
}

const PAGE = 100, MAX_PAGES = 50;
export const INSTALLS_VERSION = "2021-07-28";

/** Page through every account the platform lists for this app. `failed` carries the real HTTP status (and body) when a call did not succeed. */
export async function readInstalls(get: Getter, companyId: string, appId: string): Promise<{ failed: Resp | null; rows: InstallRow[] }> {
  const rows: InstallRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const path = `/oauth/installedLocations?companyId=${encodeURIComponent(companyId)}&appId=${encodeURIComponent(appId)}&skip=${page * PAGE}&limit=${PAGE}`;
    const r = await get(path, INSTALLS_VERSION).catch((): Resp => ({ status: 0, body: null }));
    if (r.status < 200 || r.status >= 300) return { failed: r, rows };
    const list = dig(r.body, "locations");
    const items = Array.isArray(list) ? list : [];
    for (const it of items) {
      const id = str(dig(it, "_id"));
      if (!id) continue;
      const at = str(dig(it, "installedAt"));
      const onTrial = dig(it, "trial", "onTrial");
      rows.push({
        locationId: id, name: str(dig(it, "name")), installed: dig(it, "isInstalled") === true, versionId: str(dig(it, "versionId")),
        installedAt: at && !Number.isNaN(Date.parse(at)) ? at : null, planId: str(dig(it, "planId")), onTrial: typeof onTrial === "boolean" ? onTrial : null,
      });
    }
    const count = Number(dig(r.body, "count"));
    if (items.length < PAGE || (Number.isFinite(count) && rows.length >= count)) break;
  }
  return { failed: null, rows };
}

/** One plain line for the install block of one account. */
export function installLine(i: { installed: boolean; versionId: string | null; installedAt: string | null; planLabel: string | null; onTrial: boolean | null; trialEndsAt: string | null }): string {
  if (!i.installed) return "Not installed";
  const bits = ["Installed"];
  if (i.installedAt) bits.push(i.installedAt.slice(0, 10));
  if (i.planLabel) bits.push(i.planLabel);
  if (i.onTrial) bits.push(i.trialEndsAt ? `trial ends ${i.trialEndsAt.slice(0, 10)}` : "on a trial (end date not given by the platform)");
  return bits.join(", ");
}

const DAY = 86_400_000;
/** Trial end from the install event (start + length), only when both are known. Null otherwise: the installed list gives no end date. */
export function trialEnd(start: Date | string | null, days: number | null): string | null {
  if (!start || !days || days <= 0) return null;
  const t = new Date(start).getTime();
  return Number.isNaN(t) ? null : new Date(t + days * DAY).toISOString();
}
/** True when a known trial end is within `within` days from now (and not yet over). */
export function trialEndingSoon(endsAt: string | null, now: number, within = 3): boolean {
  if (!endsAt) return false;
  const left = Date.parse(endsAt) - now;
  return left >= 0 && left <= within * DAY;
}
