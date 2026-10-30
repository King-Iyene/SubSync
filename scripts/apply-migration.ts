// Runs one migration file against the database named in .env.local. Our migrations are additive
// and idempotent (create/alter ... if not exists), so running one twice is safe.
//   node --env-file=.env.local --import tsx scripts/apply-migration.ts supabase/migrations/<file>.sql
import { readFileSync } from "node:fs";
import { closeDb, sql } from "../src/lib/db";

const file = process.argv[2];
if (!file) {
  console.error("Usage: apply-migration.ts <path to .sql file>");
  process.exit(1);
}
const text = readFileSync(file, "utf8");
if (/\b(drop|truncate|delete)\b/i.test(text.replace(/--.*$/gm, "").replace(/on delete (cascade|set null)/gi, "").replace(/drop constraint if exists [a-z_0-9]+/gi, ""))) {
  console.error("Refusing to run a migration that drops, truncates or deletes. Review it and run it by hand.");
  process.exit(1);
}
async function main() {
  try {
    await sql().unsafe(text);
    console.log("Applied", file);
  } finally {
    await closeDb();
  }
}
void main();
