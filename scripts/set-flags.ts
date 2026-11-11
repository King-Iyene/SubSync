import { closeDb, sql } from "../src/lib/db";
import { DEFAULT_OFF } from "../src/lib/flags-core";

// Switch feature flags on or off in the database (global, all installs).
// Usage: node --env-file=.env.local --import tsx scripts/set-flags.ts on|off <prefix,prefix,...> [--dry]
// Example: ... set-flags.ts on inbox_,moat_      ... set-flags.ts off inbox_,moat_
async function main() {
  const [mode, list, flag] = process.argv.slice(2);
  if ((mode !== "on" && mode !== "off") || !list) {
    console.error("Usage: set-flags.ts on|off <prefix,prefix,...> [--dry]");
    process.exit(1);
  }
  const prefixes = list.split(",").map((s) => s.trim()).filter(Boolean);
  const keys = [...DEFAULT_OFF].filter((k) => prefixes.some((p) => k === p || k.startsWith(p))).sort();
  if (!keys.length) { console.error("No known flag matches", prefixes); process.exit(1); }
  console.log(`${mode.toUpperCase()} ${keys.length} flags: ${keys.join(", ")}`);
  if (flag === "--dry") { console.log("(dry run, nothing written)"); return; }
  for (const key of keys) {
    await sql()`insert into feature_flags (key, enabled) values (${key}, ${mode === "on"})
      on conflict (key) do update set enabled = excluded.enabled, updated_at = now()`;
  }
  const rows = await sql()`select key, enabled from feature_flags where key = any(${keys}) order by key`;
  console.log(rows.map((r) => `${r.key}=${r.enabled}`).join(" "));
}
main().finally(() => closeDb());
