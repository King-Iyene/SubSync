// Applies the SQL files in supabase/migrations to the database named by MIGRATE_DATABASE_URL (or DATABASE_URL), once each, in file order.
//
//   node --import tsx scripts/migrate.ts                  apply every migration not yet recorded
//   node --import tsx scripts/migrate.ts --dry-run        only list what would run
//   node --import tsx scripts/migrate.ts --baseline <file-name>
//        record every migration up to and including <file-name> as already applied WITHOUT running it (use once, on a database that already has them)
//
// Safety: additive only. A file that drops, truncates or deletes is refused (same rule as apply-migration.ts) and nothing after it runs. Each file runs in
// one transaction together with its record, so a failed file leaves nothing half-applied. A database lock stops two runs from racing.
// Use the DIRECT connection string (port 5432) or the session pooler, not the transaction pooler: the lock needs a session.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const DIR = "supabase/migrations";
const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) { console.error("Set MIGRATE_DATABASE_URL (the direct Supabase connection string)."); process.exit(2); }
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const baselineAt = args.includes("--baseline") ? args[args.indexOf("--baseline") + 1] : null;

/** True when the file would remove data or structure. Same rule as scripts/apply-migration.ts. */
export function isDestructive(text: string): boolean {
  const code = text.replace(/--.*$/gm, "").replace(/on delete (cascade|set null)/gi, "").replace(/drop constraint if exists [a-z_0-9]+/gi, "");
  return /\b(drop|truncate|delete)\b/i.test(code);
}

async function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const sqlc = postgres(url!.split("?")[0], { prepare: false, max: 1, onnotice: () => {}, ssl: process.env.MIGRATE_SSL === "off" ? false : "require" });
  try {
    await sqlc`select pg_advisory_lock(727274)`;
    await sqlc`create table if not exists public.subsync_migrations (name text primary key, applied_at timestamptz not null default now())`;
    await sqlc`alter table public.subsync_migrations enable row level security`; // closed to the public roles; the server key and this script bypass it
    const done = new Set((await sqlc`select name from public.subsync_migrations`).map((r) => r.name as string));

    if (baselineAt) {
      const upto = files.indexOf(baselineAt);
      if (upto < 0) throw new Error(`--baseline: no such file ${baselineAt}`);
      const rows = files.slice(0, upto + 1).filter((f) => !done.has(f)).map((name) => ({ name }));
      if (rows.length) await sqlc`insert into public.subsync_migrations ${sqlc(rows)} on conflict do nothing`;
      console.log(`Recorded ${rows.length} migration(s) as already applied, through ${baselineAt}. Nothing was run.`);
      return;
    }

    const pending = files.filter((f) => !done.has(f));
    console.log(`${files.length} migration files, ${done.size} recorded, ${pending.length} to apply.`);
    for (const f of pending) {
      const text = readFileSync(join(DIR, f), "utf8");
      if (isDestructive(text)) throw new Error(`${f} drops, truncates or deletes. Refused: review it and run it by hand, then --baseline it.`);
      if (dryRun) { console.log("would apply", f); continue; }
      await sqlc.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into public.subsync_migrations (name) values (${f})`;
      });
      console.log("applied", f);
    }
    console.log(dryRun ? "Dry run: nothing changed." : "Done.");
  } finally {
    await sqlc`select pg_advisory_unlock(727274)`.catch(() => undefined);
    await sqlc.end();
  }
}

main().catch((e) => { console.error("MIGRATION FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
