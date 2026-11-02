// The Supabase proof (INTEGRATIONS_SPEC section 11.1, note N103). Read only: it changes nothing in the database. Run it any time:
//   node --env-file=.env.local --import tsx scripts/supabase-proof.ts
// It prints names, counts and yes/no answers. It never prints a value of any variable, a token, a row's contents or a connection string.
//
// What it proves against the LIVE project (not a mock):
//   1. the repo's migration files match the live schema (every table and column), and says whether the platform's own migration list is in use
//   2. each new table exists, has row level security ON, has NO policy, and the public (anon) and signed-in roles can read and write nothing
//      (a real `set local role anon` attempt inside a transaction that is always rolled back)
//   3. every token column in the new and older tables holds app-encrypted text (the "v1." format), counted, never printed
//   4. the NAMES of the database and encryption variables this process can see (values never)
//   5. the source: no service-role key anywhere, no NEXT_PUBLIC_ variable that looks secret, no client file reads a private variable
//   6. the built browser files hold no secret value (node scripts/check-bundle.mjs), when a build exists
// What needs a real webhook and is therefore NOT VERIFIED LIVE here: a delivered Fathom webhook writing a meetings row, two simultaneous retries
// producing exactly one note, a forced and a concurrent token refresh against the provider, a note id that matches a note in the CRM.
// Those are listed at the end with the morning test.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { closeDb, sql } from "../src/lib/db";
import { schemaFromMigrations } from "../tests/fixtures/schema-from-migrations";

const NEW_TABLES = ["user_connections", "meeting_note_settings", "meeting_policies", "meetings", "crm_writes", "meeting_deliveries", "meeting_ignored_emails"];
const TOKEN_COLUMNS: Array<[string, string]> = [
  ["user_connections", "access_token_enc"], ["user_connections", "refresh_token_enc"], ["user_connections", "webhook_secret_enc"],
  ["connections", "access_token_enc"], ["connections", "refresh_token_enc"], ["connections", "webhook_secret_enc"],
  ["installations", "access_token_enc"], ["installations", "refresh_token_enc"],
];
const results: Array<{ item: string; ok: boolean | "NOT VERIFIED LIVE"; detail: string }> = [];
const record = (item: string, ok: boolean | "NOT VERIFIED LIVE", detail: string) => { results.push({ item, ok, detail }); console.log(`${ok === true ? "PASS" : ok === false ? "FAIL" : "----"}  ${item}: ${detail}`); };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

async function main() {
  const db = sql();

  // 1. migrations
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  const live = new Map<string, Set<string>>();
  for (const r of await db`select table_name, column_name from information_schema.columns where table_schema = 'public'`) {
    if (!live.has(r.table_name as string)) live.set(r.table_name as string, new Set());
    live.get(r.table_name as string)!.add(r.column_name as string);
  }
  const fromFiles = schemaFromMigrations();
  const missingTables = [...fromFiles.keys()].filter((t) => !live.has(t));
  const extraTables = [...live.keys()].filter((t) => !fromFiles.has(t));
  const columnDiffs: string[] = [];
  for (const [t, cols] of fromFiles) for (const c of cols) if (live.get(t) && !live.get(t)!.has(c)) columnDiffs.push(`${t}.${c}`);
  record("migration files match the live schema", missingTables.length === 0 && extraTables.length === 0 && columnDiffs.length === 0,
    `${files.length} files, ${fromFiles.size} tables in the files, ${live.size} tables live; missing live: [${missingTables.join(", ")}]; only live: [${extraTables.join(", ")}]; missing columns: [${columnDiffs.join(", ")}]`);
  const [hasLedger] = await db`select to_regclass('supabase_migrations.schema_migrations') as t`;
  if (hasLedger?.t) {
    const applied = (await db`select version from supabase_migrations.schema_migrations`).map((r) => String(r.version));
    const prefixes = files.map((f) => f.split("_")[0]);
    // Informational: the ledger only holds the migrations applied through the platform's own tool. Later files were applied by scripts/apply-migration.ts, so the
    // schema comparison above (every table and column) is the real check, and this line only reports how far the ledger is behind.
    record("platform migration ledger (informational)", true, `${applied.length} of ${prefixes.length} repo files are recorded in it; the rest were applied by scripts/apply-migration.ts and are proven by the schema comparison above. Not recorded: ${prefixes.filter((p) => !applied.includes(p)).length}`);
  } else {
    record("platform migration ledger", true, "not in use: migrations are applied by scripts/apply-migration.ts, so the schema comparison above is the check");
  }

  // 2. the new tables
  const rows = await db`select c.relname, c.relrowsecurity rls, c.relforcerowsecurity forced from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any(${NEW_TABLES}::text[])`;
  record("every new table exists", rows.length === NEW_TABLES.length, `${rows.map((r) => r.relname).sort().join(", ")}`);
  record("row level security is on for every new table", rows.every((r) => r.rls === true), rows.map((r) => `${r.relname}=${r.rls}`).join(", "));
  const policies = await db`select tablename, count(*)::int n from pg_policies where schemaname = 'public' and tablename = any(${NEW_TABLES}::text[]) group by 1`;
  record("no policy exists on a new table (so nothing is open to the public role)", policies.length === 0, `${policies.length} tables with a policy`);
  for (const t of NEW_TABLES) {
    const [p] = await db`select has_table_privilege('anon', ${"public." + t}, 'select, insert, update, delete') as anon, has_table_privilege('authenticated', ${"public." + t}, 'select, insert, update, delete') as authed`;
    record(`${t}: public and signed-in roles hold no privilege`, p.anon === false && p.authed === false, `anon=${p.anon} authenticated=${p.authed}`);
  }
  // A real attempt as the public role. The transaction is read only and always rolled back.
  for (const role of ["anon", "authenticated"]) {
    let denied = 0;
    for (const t of NEW_TABLES) {
      try {
        await db.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx.unsafe(`select count(*) from public.${t}`);
          throw new Error("ROLLBACK_ON_PURPOSE");
        });
      } catch (e) {
        const msg = String((e as Error).message);
        if (/permission denied|row-level security/i.test(msg)) denied++;
      }
    }
    record(`a real read as the ${role} role is refused on every new table`, denied === NEW_TABLES.length, `${denied} of ${NEW_TABLES.length} refused`);
  }
  // The whole schema, not only the new tables: the public (anon) key is public by design, so every table must refuse it.
  const all = await db`select c.relname, c.relrowsecurity rls, has_table_privilege('anon', c.oid, 'select') anon_read from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`;
  const open = all.filter((r) => r.rls !== true).map((r) => r.relname);
  record("row level security is on for EVERY table in the project", open.length === 0, `${all.length} tables; without RLS: [${open.join(", ")}]`);
  const anonRead = all.filter((r) => r.anon_read === true).map((r) => r.relname);
  record("the public (anon) role has read privilege on no table (RLS then returns nothing)", anonRead.length === 0, `tables granting select to anon: [${anonRead.join(", ")}] (with RLS on and no policy these still return no rows; listed so a later policy cannot open them unnoticed)`);
  const allPolicies = await db`select tablename, policyname from pg_policies where schemaname = 'public'`;
  record("no row level security policy exists on any table", allPolicies.length === 0, `${allPolicies.length} policies: [${allPolicies.map((p) => p.tablename).join(", ")}]`);
  const counts: string[] = [];
  for (const t of NEW_TABLES) { const [r] = await db.unsafe(`select count(*)::int n from public.${t}`); counts.push(`${t}=${(r as unknown as { n: number }).n}`); }
  record("live row counts of the new tables", true, counts.join(", "));

  // 3. tokens are app-encrypted
  for (const [t, c] of TOKEN_COLUMNS) {
    if (!live.get(t)?.has(c)) continue;
    const [r] = await db.unsafe(`select count(*) filter (where ${c} is not null)::int stored, count(*) filter (where ${c} is not null and ${c} not like 'v1.%')::int plain from public.${t}`) as unknown as Array<{ stored: number; plain: number }>;
    record(`${t}.${c} holds only encrypted text`, r.plain === 0, `${r.stored} stored, ${r.plain} not in the encrypted format`);
  }

  // 4. variable NAMES (never values)
  const names = Object.keys(process.env).filter((k) => /(SUPABASE|POSTGRES|DATABASE|TOKEN_ENCRYPTION|SERVICE_ROLE|JWT)/i.test(k)).sort();
  record("database and encryption variable names this process sees (values never printed)", names.length > 0, names.join(", ") || "none");
  record("names of variables in the Vercel Production environment", "NOT VERIFIED LIVE", "reading them needs the Vercel account; the lead or King runs `vercel env ls production` and compares the names printed above");

  // 5. source scan
  const src = walk("src");
  const serviceRole = src.filter((f) => /service[_-]?role/i.test(readFileSync(f, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")));
  record("no service-role key is used anywhere in the code (the app connects with a server-side Postgres connection)", serviceRole.length === 0, serviceRole.length ? serviceRole.join(", ") : "no file mentions it");
  const publicVars = new Set<string>();
  for (const f of src) for (const m of readFileSync(f, "utf8").matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) publicVars.add(m[1]);
  const secretLooking = [...publicVars].filter((v) => /(SECRET|PASSWORD|TOKEN|PRIVATE|SERVICE|ENCRYPTION|API_KEY|KEY$|DB|POSTGRES)/i.test(v));
  record("no NEXT_PUBLIC_ variable looks secret", secretLooking.length === 0, `public variables in use: ${[...publicVars].join(", ") || "none"}`);
  const dbFiles = src.filter((f) => /from "(@\/lib\/db|\.\.?\/(\.\.\/)*db)"/.test(readFileSync(f, "utf8")));
  const clientDb = dbFiles.filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8").replace(/^(\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/\s*)*/, "")));
  record("no browser (use client) file imports the database layer", clientDb.length === 0, `${dbFiles.length} server files import it, ${clientDb.length} client files`);

  // 6. the built bundle
  if (existsSync(".next/static")) {
    try {
      const out = execFileSync(process.execPath, ["scripts/check-bundle.mjs"], { encoding: "utf8" });
      record("the built browser files hold no secret value", /failed|appears in/i.test(out) ? false : true, out.split("\n").filter((l) => l.startsWith("bundle:")).join(" | "));
    } catch (e) {
      record("the built browser files hold no secret value", false, String((e as Error).message).split("\n")[0]);
    }
  } else {
    record("the built browser files hold no secret value", "NOT VERIFIED LIVE", "no build in this folder; run `next build` then `node scripts/check-bundle.mjs`");
  }

  // The parts that need a real provider.
  for (const item of [
    "a delivered Fathom webhook writes a meetings row (show it)",
    "two simultaneous retries of one webhook leave exactly one meetings row and one note",
    "a forced and a concurrent token refresh against the provider both work",
    "one crm_writes row whose note id matches a note visible in the CRM",
  ]) record(item, "NOT VERIFIED LIVE", "needs a real Fathom connection and WRITE_GHL_LIVE on; see docs/features/E0.md, the morning test");
}

main().then(async () => {
  await closeDb();
  const failed = results.filter((r) => r.ok === false);
  console.log(`\nSupabase proof: ${results.filter((r) => r.ok === true).length} passed, ${failed.length} failed, ${results.filter((r) => r.ok === "NOT VERIFIED LIVE").length} not verified live`);
  process.exit(failed.length ? 1 : 0);
}, async (e) => { console.error("proof failed to run:", (e as Error).message.slice(0, 200)); await closeDb(); process.exit(2); });
