import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { purgeInstallation, purgeLocationData, purgeSyncedData } from "@/lib/ghl/installations";
import { CONFIG_DELETE_ON_UNINSTALL, KEEP_ON_UNINSTALL, LOCATION_DELETE, SYNCED_DELETE, UNINSTALL_DELETE } from "@/lib/tenant-tables";

// The real purge functions against the real database, with a fixture company that has one row in every tenant table.
// Skipped when no database is configured. Everything created here is removed again.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO = "xtest-purge-co";

type Col = { column_name: string; data_type: string; udt_name: string };
let required: Record<string, Col[]> = {};

// Values that satisfy the database's allowed-value rules (read from pg_constraint).
const ALLOWED: Record<string, string> = {
  "alerts.severity": "'info'", "appointment_events.kind": "'created'", "call_outcomes.outcome": "'answered'", "cleanup_changes.status": "'pending'",
  "cleanup_runs.status": "'previewed'", "connections.status": "'connected'", "connections.provider": "'slack'", "deal_events.kind": "'created'",
  "domain_checks.status": "'ok'", "duplicate_reviews.decision": "'keep'", "meeting_notes.status": "'new'", "sync_jobs.type": "'locations'", "sync_jobs.status": "'pending'",
};

const literal = (table: string, c: Col, inst: string, loc: string, runId: string | null): string => {
  if (ALLOWED[table + "." + c.column_name]) return ALLOWED[table + "." + c.column_name];
  if (c.column_name === "installation_id") return `'${inst}'::uuid`;
  if (c.column_name === "location_id") return `'${loc}'`;
  if (c.column_name === "run_id") return `'${runId}'::uuid`;
  switch (c.data_type) {
    case "uuid": return "gen_random_uuid()";
    case "text": case "character varying": return `'x-${loc}'`; // unique per account, so two accounts can both be filled
    case "jsonb": case "json": return "'{}'::jsonb";
    case "boolean": return "false";
    case "integer": case "bigint": case "smallint": case "numeric": case "double precision": return "0";
    case "date": return "current_date";
    case "ARRAY": return "'{}'";
    default: return "now()"; // timestamps
  }
};

async function fixture(): Promise<string> {
  await sql()`delete from installations where company_id = ${CO}`;
  const tok = encryptSecret("not-a-real-token");
  const [inst] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${CO}, 'zzPurge', 'pro', ${tok}, ${tok}, now() + interval '1 hour') returning id`;
  return inst.id as string;
}

async function fill(inst: string, loc: string, tables: readonly string[]) {
  let runId: string | null = null;
  const order = [...tables].sort((a, b) => (a === "cleanup_runs" ? -1 : b === "cleanup_runs" ? 1 : 0)); // parent first
  for (const t of order) {
    const cols = required[t] ?? [];
    if (!cols.some((c) => c.column_name === "installation_id")) continue;
    const names = cols.map((c) => `"${c.column_name}"`).join(", ");
    const vals = cols.map((c) => literal(t, c, inst, loc, runId)).join(", ");
    const rows = await sql().unsafe(`insert into "${t}" (${names}) values (${vals}) returning *`);
    if (t === "cleanup_runs") runId = (rows[0] as unknown as { id: string }).id;
  }
}
// One round trip for all tables: this link to the database is slow, and ~35 separate queries would not fit the time limit.
const countAll = async (tables: readonly string[], inst: string, loc?: string): Promise<Record<string, number>> => {
  const where = loc ? `installation_id = '${inst}' and location_id = '${loc}'` : `installation_id = '${inst}'`;
  const q = tables.map((t) => `select '${t}' as t, count(*)::int as n from "${t}" where ${where}`).join(" union all ");
  const rows = await sql().unsafe(q);
  return Object.fromEntries((rows as unknown as Array<{ t: string; n: number }>).map((r) => [r.t, r.n]));
};

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describe.skipIf(!HAS_DB)("uninstall and deletion against the real database", () => {
  beforeAll(async () => {
    const all = [...new Set([...UNINSTALL_DELETE, ...KEEP_ON_UNINSTALL, ...LOCATION_DELETE])];
    const rows = await sql()`select table_name, column_name, data_type, udt_name from information_schema.columns where table_schema = 'public' and table_name = any(${all}::text[]) and is_nullable = 'NO' and column_default is null and is_identity = 'NO' order by table_name, ordinal_position`;
    required = {};
    for (const r of rows) (required[r.table_name as string] ??= []).push(r as unknown as Col);
    for (const t of all) required[t] ??= []; // a table with no required columns still gets an insert of just installation_id below
    for (const t of all) if (!required[t].some((c) => c.column_name === "installation_id")) required[t].unshift({ column_name: "installation_id", data_type: "uuid", udt_name: "uuid" });
    // A nullable location column is still filled, so two accounts never collide on a unique rule (for example sync_jobs).
    const withLoc = await sql()`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'location_id' and table_name = any(${all}::text[])`;
    for (const r of withLoc) { const t = r.table_name as string; if (!required[t].some((c) => c.column_name === "location_id")) required[t].push({ column_name: "location_id", data_type: "text", udt_name: "text" }); }
  });
  afterEach(async () => { vi.unstubAllEnvs(); await sql()`delete from installations where company_id = ${CO}`; });

  it("uninstall leaves no row in any deleted table, empties the tokens, and keeps only the documented audit tables", async () => {
    const inst = await fixture();
    await fill(inst, "xtestPurgeLoc1", [...UNINSTALL_DELETE, ...KEEP_ON_UNINSTALL]);
    const before = await countAll(UNINSTALL_DELETE, inst);
    for (const t of UNINSTALL_DELETE) expect(before[t], `${t} should have its fixture row before`).toBeGreaterThan(0);
    await purgeInstallation(CO);
    const after = await countAll([...UNINSTALL_DELETE, ...KEEP_ON_UNINSTALL], inst);
    for (const t of UNINSTALL_DELETE) expect(after[t], `${t} must be empty after uninstall`).toBe(0);
    for (const t of KEEP_ON_UNINSTALL) expect(after[t], `${t} is kept on purpose`).toBeGreaterThan(0);
    const [row] = await sql()`select access_token_enc, refresh_token_enc, token_expires_at, uninstalled_at from installations where id = ${inst}`;
    expect(row.access_token_enc).toBeNull();
    expect(row.refresh_token_enc).toBeNull();
    expect(row.uninstalled_at).not.toBeNull();
  });

  it("uninstall still deletes while the kill switch is on", async () => {
    vi.stubEnv("APP_MODE", "maintenance");
    const inst = await fixture();
    await fill(inst, "xtestPurgeLoc1", UNINSTALL_DELETE);
    await purgeInstallation(CO);
    const after = await countAll(UNINSTALL_DELETE, inst);
    for (const t of UNINSTALL_DELETE) expect(after[t], t).toBe(0);
  });

  it("'delete my data' removes copied customer data but keeps settings, keys and connections", async () => {
    const inst = await fixture();
    await fill(inst, "xtestPurgeLoc1", UNINSTALL_DELETE);
    await purgeSyncedData(inst);
    const after = await countAll([...SYNCED_DELETE, ...CONFIG_DELETE_ON_UNINSTALL], inst);
    for (const t of SYNCED_DELETE) expect(after[t], `${t} must be empty`).toBe(0);
    for (const t of CONFIG_DELETE_ON_UNINSTALL) expect(after[t], `${t} is configuration and stays`).toBeGreaterThan(0);
  });

  it("removing one client account deletes that account's rows and leaves the other account's", async () => {
    const inst = await fixture();
    await fill(inst, "xtestPurgeLoc1", LOCATION_DELETE);
    await fill(inst, "xtestPurgeLoc2", LOCATION_DELETE);
    await purgeLocationData(inst, "xtestPurgeLoc1");
    const one = await countAll(LOCATION_DELETE, inst, "xtestPurgeLoc1");
    const two = await countAll(LOCATION_DELETE, inst, "xtestPurgeLoc2");
    for (const t of LOCATION_DELETE) {
      expect(one[t], `${t}: removed account must be gone`).toBe(0);
      expect(two[t], `${t}: the other account must remain`).toBeGreaterThan(0);
    }
  });

  it("closes the connection", async () => { await closeDb(); });
});
