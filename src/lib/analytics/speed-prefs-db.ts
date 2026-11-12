import { sql } from "../db";
import { cleanIgnoredPref } from "./ignored-leads-core";
import { clampCadence, DEFAULT_GOALS, sanitizeDispositions } from "../dial/dial6";

// Call mode and Speed choices kept on the server (stage SPEED6): the redial plan, hour goals, scripts per lead source and outcome sets, for the company ('') or one client account. A missing table answers
// ready: false and the browser keeps the choice (the old behaviour) until the migration has run. Every value is cleaned before it is stored.
export const PREF_KEYS = ["cadence", "goals", "scripts", "dispositions", "ignored"] as const;
export type PrefKey = (typeof PREF_KEYS)[number];
export const isPrefKey = (k: unknown): k is PrefKey => typeof k === "string" && (PREF_KEYS as readonly string[]).includes(k);

export function cleanPref(key: PrefKey, raw: unknown): unknown {
  if (key === "cadence") return clampCadence((raw ?? {}) as never);
  if (key === "goals") { const g = (raw ?? {}) as Record<string, unknown>; const n = (k: string, d: number) => { const v = Math.round(Number(g[k])); return Number.isFinite(v) ? Math.min(500, Math.max(1, v)) : d; }; return { calls: n("calls", DEFAULT_GOALS.calls), reached: n("reached", DEFAULT_GOALS.reached), booked: n("booked", DEFAULT_GOALS.booked) }; }
  if (key === "dispositions") return sanitizeDispositions(raw);
  if (key === "ignored") return cleanIgnoredPref(raw);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries((raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>).slice(0, 30)) if (typeof v === "string" && k.length <= 80) out[k.toLowerCase().slice(0, 80)] = v.slice(0, 1000);
  return out;
}

export async function loadPrefs(installationId: string, allowed: string[] | null): Promise<{ ready: boolean; prefs: Record<string, unknown> }> {
  try {
    const rows = await sql()`select scope, key, value from speed_prefs where installation_id = ${installationId}`;
    const prefs: Record<string, unknown> = {};
    for (const r of rows) { const scope = r.scope as string; if (scope === "" || !allowed || allowed.includes(scope)) prefs[`${scope}|${r.key as string}`] = r.value; }
    const ign = await sql()`select scope, value from ignored_leads_prefs where installation_id = ${installationId}`.catch(() => []);
    for (const r of ign) { const scope = r.scope as string; if (scope === "" || !allowed || allowed.includes(scope)) prefs[`${scope}|ignored`] = r.value; }
    return { ready: true, prefs };
  } catch { return { ready: false, prefs: {} }; }
}
export async function savePref(installationId: string, scope: string, key: PrefKey, raw: unknown): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const value = cleanPref(key, raw);
  try {
    if (key === "ignored") await sql()`insert into ignored_leads_prefs (installation_id, scope, value) values (${installationId}, ${scope}, ${JSON.stringify(value)}::text::jsonb) on conflict (installation_id, scope) do update set value = excluded.value, updated_at = now()`;
    else await sql()`insert into speed_prefs (installation_id, scope, key, value) values (${installationId}, ${scope}, ${key}, ${JSON.stringify(value)}::text::jsonb)
      on conflict (installation_id, scope, key) do update set value = excluded.value, updated_at = now()`;
    return { ok: true, value };
  } catch { return { ok: false, error: "Saving needs the latest database update. Your choice is kept in this browser meanwhile." }; }
}
