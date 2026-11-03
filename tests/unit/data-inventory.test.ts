import { describe, expect, it } from "vitest";
import { schemaFromMigrations } from "../fixtures/schema-from-migrations";
import {
  deleteMyDataText, deletion, INVENTORY, labelsFor, LINES, looksPersonal, NEVER_STORED, removalAnswer, SHARE_LINK_DAYS, storeLines, uninstallText, type LineId,
} from "@/lib/data-inventory";
import { CONFIG_DELETE_ON_UNINSTALL, KEEP_ON_UNINSTALL, SYNCED_DELETE } from "@/lib/tenant-tables";

// N83: "What we store" is produced from an inventory that is checked against the real schema. A table that holds personal data and is not in
// the inventory fails here, so the Settings card, the privacy page and the help text cannot name less than the database holds.
// Two schemas are compared: the migration files (always, no database needed) and the live database (when one is configured). A third test
// proves the migration reader itself matches the live database.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);

type Schema = Map<string, Set<string>>;

function problems(schema: Schema): string[] {
  const out: string[] = [];
  for (const [table, cols] of schema) {
    const info = INVENTORY[table];
    if (!info) { out.push(`${table}: a table with no entry in src/lib/data-inventory.ts (columns: ${[...cols].join(", ")}). Say what it holds.`); continue; }
    const personal = new Set(Object.keys(info.personal ?? {}));
    const notPersonal = new Set(info.notPersonal ?? []);
    const secrets = new Set(Object.keys(info.secrets ?? {}));
    for (const c of cols) {
      if (personal.has(c) || notPersonal.has(c) || secrets.has(c)) continue;
      if (looksPersonal(c)) out.push(`${table}.${c}: looks like it holds personal data but is not declared. Add it to "personal" with a plain-words label, or to "notPersonal" on purpose.`);
    }
    for (const c of [...personal, ...notPersonal, ...secrets]) if (!cols.has(c)) out.push(`${table}.${c}: declared in the inventory but not in the schema (a stale entry).`);
    for (const c of personal) if (notPersonal.has(c) || secrets.has(c)) out.push(`${table}.${c}: declared twice.`);
  }
  for (const table of Object.keys(INVENTORY)) if (!schema.has(table)) out.push(`${table}: in the inventory but not in the schema (a stale entry).`);
  for (const n of NEVER_STORED) {
    const cols = schema.get(n.table);
    const bad = cols ? [...cols].filter((c) => n.columns.test(c)) : ["(table missing)"];
    if (bad.length) out.push(`${n.table}: the page promises "${n.claim}" but the table has ${bad.join(", ")}.`);
  }
  for (const [table, info] of Object.entries(INVENTORY)) {
    for (const [col, how] of Object.entries(info.secrets ?? {})) {
      if (how === "encrypted" && !col.endsWith("_enc")) out.push(`${table}.${col}: said to be encrypted but is not named *_enc.`);
      if (how === "hashed" && !col.endsWith("_hash")) out.push(`${table}.${col}: said to be hashed but is not named *_hash.`);
    }
  }
  return out;
}

describe("what we store matches the schema", () => {
  it("every table and every personal-looking column in the migrations is in the inventory, and nothing in the inventory is stale", () => {
    expect(problems(schemaFromMigrations())).toEqual([]);
  });

  it.skipIf(!HAS_DB)("the same holds for the live database, and the migration reader matches it exactly", async () => {
    const { sql, closeDb } = await import("@/lib/db");
    const rows = await sql()`select table_name, column_name from information_schema.columns where table_schema = 'public'`;
    await closeDb();
    const live: Schema = new Map();
    for (const r of rows) { if (!live.has(r.table_name as string)) live.set(r.table_name as string, new Set()); live.get(r.table_name as string)!.add(r.column_name as string); }
    expect(problems(live)).toEqual([]);
    const fromFiles = schemaFromMigrations();
    expect([...fromFiles.keys()].sort()).toEqual([...live.keys()].sort());
    for (const [t, cols] of live) expect([...(fromFiles.get(t) ?? [])].sort(), `${t} columns: migration files against the live database`).toEqual([...cols].sort());
  });

  it("the check really fails for an undeclared table and for a new personal-looking column (so it cannot pass by checking nothing)", () => {
    const schema = schemaFromMigrations();
    const withTable = new Map(schema).set("customer_notes", new Set(["id", "installation_id", "note"]));
    expect(problems(withTable).join("\n")).toMatch(/customer_notes: a table with no entry/);
    const withColumn = new Map([...schema].map(([t, c]) => [t, new Set(c)] as const));
    withColumn.get("cached_contacts")!.add("home_address");
    expect(problems(withColumn).join("\n")).toMatch(/cached_contacts\.home_address: looks like it holds personal data/);
    const withNote = new Map([...schema].map(([t, c]) => [t, new Set(c)] as const));
    withNote.get("cached_contacts")!.add("private_note");
    expect(problems(withNote).join("\n")).toMatch(/promises "No notes, files or custom fields\."/);
    const withText = new Map([...schema].map(([t, c]) => [t, new Set(c)] as const));
    withText.get("cached_conversations")!.add("message_body");
    expect(problems(withText).join("\n")).toMatch(/The text of a message is never copied/);
    const stale = new Map([...schema].map(([t, c]) => [t, new Set(c)] as const));
    stale.get("cached_contacts")!.delete("birth_date");
    expect(problems(stale).join("\n")).toMatch(/cached_contacts\.birth_date: declared in the inventory but not in the schema/);
  });
});

describe("the list a person reads is produced from the inventory", () => {
  const text = (meetings = true) => storeLines({ meetings }).map((l) => `${l.title}: ${l.text}`).join("\n");

  it("every personal column's label is on the list, so a column cannot be stored without being named", () => {
    const list = text();
    for (const [table, info] of Object.entries(INVENTORY)) for (const [col, label] of Object.entries(info.personal ?? {})) expect(list.toLowerCase(), `${table}.${col} ("${label}")`).toContain(label.toLowerCase());
  });

  it("every line has text, every table sits on a real line, and the list names what the old hand-written card left out", () => {
    for (const info of Object.values(INVENTORY)) expect(Object.keys(LINES)).toContain(info.line);
    for (const l of storeLines()) expect(l.text.length, l.id).toBeGreaterThan(20);
    const list = text();
    for (const needle of ["birth date", "appointment title", "the client business's address", "what you charge a client", "your notes about a client", "who attended", "team member names you type", "the email address that receives alerts"]) expect(list.toLowerCase()).toContain(needle);
    expect(list).toContain("No notes, files or custom fields.");
    expect(list).toContain("The text of a message is never copied.");
    expect(list).toContain(`${SHARE_LINK_DAYS} days`);
    expect(storeLines({ meetings: false }).some((l) => l.id === "meetings")).toBe(false);
    expect(storeLines().some((l) => l.id === "meetings")).toBe(true);
  });

  it("the words follow the white-label rules: no platform name and none of our internal words", () => {
    for (const s of [text(), deleteMyDataText(), uninstallText(), removalAnswer()]) {
      expect(s).not.toMatch(/gohighlevel|highlevel|leadconnector|\bghl\b/i);
      expect(s).not.toMatch(/\b(agenc(y|ies)|sub-?accounts?|locations?)\b/i);
      expect(s).not.toMatch(/zoom|google meet/i);
    }
  });

  it("each line lists labels from its own tables and no table is on two lines", () => {
    const lines = new Map<LineId, string[]>();
    for (const [t, info] of Object.entries(INVENTORY)) lines.set(info.line, [...(lines.get(info.line) ?? []), t]);
    for (const [id, tables] of lines) expect(labelsFor(id).length > 0 || tables.every((t) => !INVENTORY[t].personal), id).toBe(true);
  });
});

describe("what each button removes is read from the lists the purge code runs", () => {
  it("Delete my data names every table it empties, and keeps what the app needs to keep working", () => {
    const d = deletion();
    for (const t of SYNCED_DELETE) expect(INVENTORY[t], `${t} has a noun`).toBeTruthy();
    for (const t of SYNCED_DELETE) expect(deleteMyDataText().includes(INVENTORY[t].noun), `${t}: "${INVENTORY[t].noun}" is in the Delete my data text`).toBe(true);
    for (const t of CONFIG_DELETE_ON_UNINSTALL) expect(uninstallText().includes(INVENTORY[t].noun), `${t} is named in the uninstall text`).toBe(true);
    for (const t of CONFIG_DELETE_ON_UNINSTALL) expect(d.synced.includes(INVENTORY[t].noun) && !SYNCED_DELETE.some((s) => INVENTORY[s].noun === INVENTORY[t].noun), `${t} is not claimed as deleted by Delete my data`).toBe(false);
    for (const t of KEEP_ON_UNINSTALL) expect(uninstallText().includes(INVENTORY[t].noun), `${t} is named as kept`).toBe(true);
  });
});
