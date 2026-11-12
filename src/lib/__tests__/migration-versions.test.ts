import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// Two migration files with the same leading number make the production apply fail
// (schema_migrations primary key), so the second one never reaches the live database.
test("every migration file has its own version number", () => {
  const dir = join(process.cwd(), "supabase", "migrations");
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
    const v = f.split("_")[0];
    const other = seen.get(v);
    if (other) clashes.push(`${other} and ${f}`);
    else seen.set(v, f);
  }
  assert.deepEqual(clashes, []);
});
