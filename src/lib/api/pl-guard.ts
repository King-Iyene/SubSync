// ONE guard for every account id the Pipeline module is given (GET /api/app/pipeline3?part=..., and every pipeline3/act/... route). An id that arrives in an address or a body is only a
// REQUEST to look at an account: it is used only when it is well formed AND inside the accounts the verified session may read (`allowed`, decided by the router from the session; null
// means every account of the caller's own installation). The writing routes also confirm the account really belongs to the caller's installation before anything is read or minted for it.
// Every SQL behind these routes additionally filters by installation_id, so a wrong id can only ever find nothing.

import { ownedLocation } from "./tenant-guard";
const ID = /^[A-Za-z0-9_-]{3,64}$/;
export type Allowed = readonly string[] | null;

/** Syntax and session scope only (no database). Returns the id, or null when it is not one the caller may ask about. */
export function allowedAccount(allowed: Allowed, v: unknown): string | null {
  if (typeof v !== "string" || !ID.test(v)) return null;
  return allowed && !allowed.includes(v) ? null : v;
}

/** As allowedAccount, and the account must exist in the caller's own installation (the shared guard; a foreign id is the same answer as nothing there). */
export async function ownedAccount(installationId: string, allowed: Allowed, v: unknown): Promise<string | null> {
  try { return await ownedLocation(installationId, allowed ? [...allowed] : null, v); } catch { return null; }
}
