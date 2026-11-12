import { sql } from "../db";
import { GHL_API } from "../ghl/client";
import { ghlFetch } from "../ghl/http";
import { getCompanyAccessToken } from "../ghl/installations";
import { ttlCache } from "../ttl-cache";
import { DAY, dayKey } from "./wg-core";
import type { WgUsage } from "./wg-types";

// What the credit went on, for ONE account, read live from the platform's wallet transaction list (agency token, optional permission wallet.readonly, POST /wallet/transactions, Version v3,
// limit up to 1000). Read only, never stored here. The response shape is only partly documented (the page's schema and example disagree), so every field is read defensively and anything
// unexpected becomes "Not available from the platform yet". `location` must already have passed ownedLocation.

const cache = ttlCache<WgUsage>(10 * 60_000, 200);
const MAX_ROWS = 3000, PAGE = 1000;

export async function usageFor(inst: string, location: string, days = 7, now = Date.now()): Promise<WgUsage> {
  const key = JSON.stringify([inst, location, days, Math.floor(now / 600_000)]);
  const hit = cache.get(key);
  if (hit) return hit;
  const miss = (state: WgUsage["state"], note: string): WgUsage => ({ state, days, total: null, byType: [], byDay: [], note });
  const [row] = await sql()`select company_id from installations where id = ${inst}`;
  const companyKey = row?.company_id as string | undefined;
  if (!companyKey || companyKey.startsWith("loc:")) return miss("not_available", "Not available from the platform yet: this connection cannot read the usage list.");
  let token: string;
  try { token = await getCompanyAccessToken(companyKey); } catch { return miss("needs_permission", "Needs permission: reconnect"); }
  const from = new Date(now - days * DAY).toISOString(), to = new Date(now).toISOString();
  const byType = new Map<string, { amount: number; count: number }>(), byDay = new Map<string, number>();
  let total = 0, seen = 0;
  for (let skip = 0; skip < MAX_ROWS; skip += PAGE) {
    let res: Response;
    try {
      res = await ghlFetch(`${GHL_API}/wallet/transactions`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json", "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ locationId: location, skip, limit: PAGE, filters: { locationId: location, transactionType: "DEBIT", settlementTime: { from, to } } }),
      });
    } catch { return miss("not_available", "Not available from the platform yet."); }
    if (res.status === 401 || res.status === 403) return miss("needs_permission", "Needs permission: reconnect");
    if (res.status < 200 || res.status >= 300) return miss("not_available", "Not available from the platform yet.");
    let body: unknown = null;
    try { body = await res.json(); } catch { /* empty */ }
    const list = (body && typeof body === "object" ? (body as { transactions?: unknown }).transactions : null);
    if (!Array.isArray(list)) return miss("not_available", "Not available from the platform yet.");
    for (const t of list as unknown[]) {
      if (!t || typeof t !== "object") continue;
      const o = t as Record<string, unknown>, amt = Number(o.amount), at = typeof o.settlementTime === "string" ? Date.parse(o.settlementTime) : NaN;
      if (!Number.isFinite(amt) || amt <= 0) continue;
      const type = typeof o.chargeType === "string" && o.chargeType ? o.chargeType.slice(0, 40) : "Other";
      const e = byType.get(type) ?? { amount: 0, count: 0 };
      e.amount += amt; e.count++; byType.set(type, e);
      total += amt;
      if (Number.isFinite(at)) byDay.set(dayKey(at), (byDay.get(dayKey(at)) ?? 0) + amt);
    }
    seen += list.length;
    if (list.length < PAGE) break;
  }
  const out: WgUsage = {
    state: "ok", days, total: Math.round(total * 100) / 100,
    byType: [...byType.entries()].map(([type, v]) => ({ type, amount: Math.round(v.amount * 100) / 100, count: v.count })).sort((a, b) => b.amount - a.amount).slice(0, 12),
    byDay: [...byDay.entries()].map(([day, amount]) => ({ day, amount: Math.round(amount * 100) / 100 })).sort((a, b) => a.day.localeCompare(b.day)),
    note: seen >= MAX_ROWS ? "Only the newest 3,000 charges were read." : seen === 0 ? "The platform listed no charges in these days." : "Read live from the platform. Not stored.",
  };
  cache.set(key, out);
  return out;
}
