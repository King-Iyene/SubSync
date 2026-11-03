// Saves whole tables to backups/ (never committed) and prints the row counts, before a live migration touches them.
//   node --env-file=.env.local --import tsx scripts/backup-tables.ts connections settings
// Writes backups/<table>-<timestamp>.json and prints "<table>: <rows> rows -> <file>". The values are what the database holds (tokens stay
// encrypted). Only plain table names are accepted.
import { mkdirSync, writeFileSync } from "node:fs";
import { closeDb, sql } from "../src/lib/db";

const tables = process.argv.slice(2);
if (tables.length === 0 || tables.some((t) => !/^[a-z_]+$/.test(t))) {
  console.error("Usage: backup-tables.ts <table> [<table> ...]");
  process.exit(1);
}

async function main() {
  mkdirSync("backups", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    for (const t of tables) {
      const rows = await sql().unsafe(`select * from public."${t}"`);
      const file = `backups/${t}-${stamp}.json`;
      writeFileSync(file, JSON.stringify(rows));
      console.log(`${t}: ${rows.length} rows -> ${file}`);
    }
  } finally {
    await closeDb();
  }
}
void main();
