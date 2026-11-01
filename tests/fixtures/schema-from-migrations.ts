import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The database schema as the migration files describe it: table name -> column names. Read with plain text rules (create table and
// alter table add column are the only statements the migrations use to shape tables), so a test can compare it with the
// inventory of what we store without a database. A second test compares the same inventory with the live database.
// A table is dropped from the result by a "drop table" statement, and a column by "drop column" (none exist today).

const DIR = join(process.cwd(), "supabase", "migrations");
const NOT_A_COLUMN = /^(primary|unique|foreign|check|constraint|exclude|like)\b/i;

function splitTop(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  let quote = false;
  for (const ch of body) {
    if (ch === "'") quote = !quote;
    if (!quote) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

export function schemaFromMigrations(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = readFileSync(join(DIR, f), "utf8").replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(/gi)) {
      let depth = 1;
      let i = (m.index ?? 0) + m[0].length;
      const start = i;
      for (; i < sql.length && depth > 0; i++) { if (sql[i] === "(") depth++; else if (sql[i] === ")") depth--; }
      const cols = tables.get(m[1]) ?? new Set<string>();
      for (const part of splitTop(sql.slice(start, i - 1))) {
        const t = part.trim();
        if (!t || NOT_A_COLUMN.test(t)) continue;
        const name = /^"?(\w+)"?/.exec(t)?.[1];
        if (name) cols.add(name);
      }
      tables.set(m[1], cols);
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?(\w+)"?\s+([^;]*);/gi)) {
      const cols = tables.get(m[1]);
      if (!cols) continue;
      for (const a of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi)) cols.add(a[1]);
      for (const d of m[2].matchAll(/drop\s+column\s+(?:if\s+exists\s+)?"?(\w+)"?/gi)) cols.delete(d[1]);
    }
    for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi)) tables.delete(m[1]);
  }
  return tables;
}
