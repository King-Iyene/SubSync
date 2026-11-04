import { sql } from "../db";
import { ttlCache } from "../ttl-cache";
import { DEFAULT_RULES, DEFAULT_SURVIVORSHIP, parseRules, parseSurvivorship, type MatchRules, type Survivorship } from "./cleanup-rules";

// The saved Clean-up choices (stage CLEANUP): how strictly to match duplicates, which value wins, the merge workflow and whether SubSync may change contacts, per client
// account, with a company default underneath. Reading never fails because a column is missing: until the migration `20261105120000_cleanup_v2.sql` is applied every
// account simply uses the built-in Balanced rules and writing is off. Only the choices live here; nothing here touches a contact.

export type AccountConfig = {
  match: MatchRules;
  survive: Survivorship;
  /** The id of the customer's own "Merge Contact" workflow in this account (typed by them; SubSync cannot create it). */
  mergeWorkflowId: string | null;
  /** The per-account opt-in for changing contacts from SubSync. Off until a person switches it on. */
  writeEnabled: boolean;
  /** Where the matching choice comes from. */
  source: "account" | "company" | "builtin";
};

export const BUILTIN: AccountConfig = { match: DEFAULT_RULES, survive: DEFAULT_SURVIVORSHIP, mergeWorkflowId: null, writeEnabled: false, source: "builtin" };

export type Ready = { rules: boolean; defaults: boolean; snapshots: boolean };
const ready = ttlCache<Ready>(60_000, 2);

/** Which of this stage's database pieces exist (the migration may not have been applied yet). Cached a minute. */
export async function schemaReady(): Promise<Ready> {
  const hit = ready.get("x");
  if (hit) return hit;
  let r: Ready = { rules: false, defaults: false, snapshots: false };
  try {
    const rows = await sql()`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and ((table_name = 'locations' and column_name in ('cleanup_rules', 'cleanup_write_enabled')) or (table_name = 'settings' and column_name = 'cleanup_defaults') or table_name = 'cleanup_quality_snapshots')`;
    const has = (t: string, c?: string) => rows.some((x) => x.table_name === t && (!c || x.column_name === c));
    r = { rules: has("locations", "cleanup_rules") && has("locations", "cleanup_write_enabled"), defaults: has("settings", "cleanup_defaults"), snapshots: has("cleanup_quality_snapshots") };
  } catch {
    // an unreadable catalogue means "not ready": the screens say so in words
  }
  ready.set("x", r);
  return r;
}
export const forgetSchema = () => ready.clear("x");

const parseBlob = (raw: unknown): { match: MatchRules; survive: Survivorship; mergeWorkflowId: string | null } => {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const wf = typeof o.mergeWorkflowId === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(o.mergeWorkflowId) ? o.mergeWorkflowId : null;
  return { match: parseRules(o.match), survive: parseSurvivorship(o.survive), mergeWorkflowId: wf };
};

/** The effective choices for each client account the caller may see: the account's own, else the company default, else Balanced. */
export async function loadConfigs(installationId: string, allowed: string[] | null): Promise<Map<string, AccountConfig>> {
  const out = new Map<string, AccountConfig>();
  const r = await schemaReady();
  const db = sql();
  const locs = await db`select location_id from locations where installation_id = ${installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}`;
  if (!r.rules) { for (const l of locs) out.set(l.location_id as string, BUILTIN); return out; }
  const [def] = r.defaults ? await db`select cleanup_defaults from settings where installation_id = ${installationId}` : [];
  const company = def?.cleanup_defaults ? parseBlob(def.cleanup_defaults) : null;
  const rows = await db`select location_id, cleanup_rules, cleanup_write_enabled from locations where installation_id = ${installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}`;
  for (const l of rows) {
    const own = l.cleanup_rules ? parseBlob(l.cleanup_rules) : null;
    const base = own ?? company;
    out.set(l.location_id as string, {
      match: base?.match ?? DEFAULT_RULES, survive: base?.survive ?? DEFAULT_SURVIVORSHIP, mergeWorkflowId: own?.mergeWorkflowId ?? company?.mergeWorkflowId ?? null,
      writeEnabled: l.cleanup_write_enabled === true, source: own ? "account" : company ? "company" : "builtin",
    });
  }
  return out;
}

export type ConfigInput = { match?: unknown; survive?: unknown; mergeWorkflowId?: string | null };

/**
 * Saves the choices for one account (`scope` an account id) or for the whole company (`scope` "company", an agency only: the caller checks). Only the parts sent change.
 * Returns "unavailable" when the migration has not been applied, and "not_found" for an account the caller may not see.
 */
export async function saveConfig(installationId: string, allowed: string[] | null, actor: string | null, scope: string, input: ConfigInput): Promise<"ok" | "not_found" | "unavailable"> {
  const r = await schemaReady();
  if (!r.rules || (scope === "company" && !r.defaults)) return "unavailable";
  const db = sql();
  const merge = (cur: unknown) => {
    const old = parseBlob(cur);
    return {
      match: input.match !== undefined ? parseRules(input.match) : old.match, survive: input.survive !== undefined ? parseSurvivorship(input.survive) : old.survive,
      mergeWorkflowId: input.mergeWorkflowId !== undefined ? (input.mergeWorkflowId && /^[A-Za-z0-9_-]{6,64}$/.test(input.mergeWorkflowId) ? input.mergeWorkflowId : null) : old.mergeWorkflowId,
    };
  };
  if (scope === "company") {
    if (allowed) return "not_found";
    const [cur] = await db`select cleanup_defaults from settings where installation_id = ${installationId}`;
    const blob = merge(cur?.cleanup_defaults);
    await db`insert into settings (installation_id, cleanup_defaults) values (${installationId}, ${db.json(blob as never)}) on conflict (installation_id) do update set cleanup_defaults = excluded.cleanup_defaults`;
    await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, 'cleanup.rules_saved', ${db.json({ scope: "company", preset: blob.match.preset } as never)})`;
    return "ok";
  }
  if (allowed && !allowed.includes(scope)) return "not_found";
  const [cur] = await db`select cleanup_rules from locations where installation_id = ${installationId} and location_id = ${scope} and not ignored`;
  if (!cur) return "not_found";
  const blob = merge(cur.cleanup_rules);
  await db`update locations set cleanup_rules = ${db.json(blob as never)} where installation_id = ${installationId} and location_id = ${scope}`;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, 'cleanup.rules_saved', ${db.json({ scope: "account", locationId: scope, preset: blob.match.preset } as never)})`;
  return "ok";
}

/** Back to "follow the company default" for one account. */
export async function clearAccountConfig(installationId: string, allowed: string[] | null, actor: string | null, locationId: string): Promise<"ok" | "not_found" | "unavailable"> {
  const r = await schemaReady();
  if (!r.rules) return "unavailable";
  if (allowed && !allowed.includes(locationId)) return "not_found";
  const db = sql();
  const done = await db`update locations set cleanup_rules = null where installation_id = ${installationId} and location_id = ${locationId} returning location_id`;
  if (done.length === 0) return "not_found";
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, 'cleanup.rules_cleared', ${db.json({ locationId } as never)})`;
  return "ok";
}

/** The per-account opt-in for changing contacts. Recorded in the audit log with who and when. */
export async function setWriteEnabled(installationId: string, allowed: string[] | null, actor: string | null, locationId: string, enabled: boolean): Promise<"ok" | "not_found" | "unavailable"> {
  const r = await schemaReady();
  if (!r.rules) return "unavailable";
  if (allowed && !allowed.includes(locationId)) return "not_found";
  const db = sql();
  const done = await db`update locations set cleanup_write_enabled = ${enabled} where installation_id = ${installationId} and location_id = ${locationId} and not ignored returning location_id`;
  if (done.length === 0) return "not_found";
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, ${enabled ? "cleanup.write_enabled" : "cleanup.write_disabled"}, ${db.json({ locationId } as never)})`;
  return "ok";
}

/** Whether changing contacts is switched on for one account (the opt-in). Always false before the migration. */
export async function writeEnabledFor(installationId: string, locationId: string): Promise<boolean> {
  if (!(await schemaReady()).rules) return false;
  const [r] = await sql()`select cleanup_write_enabled from locations where installation_id = ${installationId} and location_id = ${locationId}`;
  return r?.cleanup_write_enabled === true;
}
