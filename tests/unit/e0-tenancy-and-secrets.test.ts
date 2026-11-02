import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_FOR } from "@/lib/access";
import { deleteMyDataText, deletion, INVENTORY, removalAnswer, storeLines, uninstallText } from "@/lib/data-inventory";
import { SAFE_COLUMNS } from "@/lib/connections/personal";
import { CONFIG_DELETE_ON_UNINSTALL, KEEP_ON_UNINSTALL, LOCATION_DELETE, SYNCED_DELETE, UNINSTALL_DELETE } from "@/lib/tenant-tables";
import { schemaFromMigrations } from "../fixtures/schema-from-migrations";

// Stage E0, items 1 and 7: the five new tables are classified (what uninstall and "Delete my data" remove), described in "What we store", protected
// (row level security, tokens encrypted, never selected for a screen), and the endpoints take the person from the signed session only.

const NEW = ["user_connections", "meeting_note_settings", "meeting_policies", "meetings", "crm_writes"] as const;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("the new tables are classified for deletion", () => {
  it("every new table is removed by an uninstall, and none is on the kept list", () => {
    for (const t of NEW) { expect(UNINSTALL_DELETE, t).toContain(t); expect(KEEP_ON_UNINSTALL, t).not.toContain(t); }
  });
  it("what a person's meetings hold and what we wrote is copied customer data: 'Delete my data' removes meetings and the write log, and keeps the connections and rules so the app keeps working", () => {
    expect(SYNCED_DELETE).toContain("meetings");
    expect(SYNCED_DELETE).toContain("crm_writes");
    for (const t of ["user_connections", "meeting_note_settings", "meeting_policies"]) { expect(CONFIG_DELETE_ON_UNINSTALL, t).toContain(t); expect(SYNCED_DELETE, t).not.toContain(t); }
  });
  it("the tables with an account column are in the per-account purge, so removing a client account removes its write log and its rule", () => {
    expect(LOCATION_DELETE).toContain("crm_writes");
    expect(LOCATION_DELETE).toContain("meeting_policies");
    for (const t of ["user_connections", "meetings", "meeting_note_settings"]) expect(LOCATION_DELETE, `${t} has no account column`).not.toContain(t);
  });
  it("the write log is deleted before the meetings it points to", () => {
    expect(SYNCED_DELETE.indexOf("crm_writes")).toBeLessThan(SYNCED_DELETE.indexOf("meetings"));
    expect(SYNCED_DELETE.indexOf("meetings")).toBeLessThan(SYNCED_DELETE.indexOf("locations"));
  });
});

describe("What we store names the new data, and every new column is accounted for", () => {
  const schema = schemaFromMigrations();
  it("every new table is in the schema the migration files describe, and in the inventory", () => {
    for (const t of NEW) { expect(schema.has(t), `${t} in the migration`).toBe(true); expect(INVENTORY[t], `${t} in the inventory`).toBeTruthy(); }
  });
  it("the tokens and the webhook secret are declared as encrypted, and the encrypted columns are named *_enc", () => {
    expect(INVENTORY.user_connections.secrets).toEqual({ access_token_enc: "encrypted", refresh_token_enc: "encrypted", webhook_secret_enc: "encrypted" });
    for (const col of Object.keys(INVENTORY.user_connections.secrets ?? {})) expect(schema.get("user_connections")!.has(col)).toBe(true);
  });
  it("the list a person reads says whose meetings these are, that attendee emails and summaries are kept, and what happens to a meeting nobody matches", () => {
    const lines = storeLines({ meetings: true }).map((l) => `${l.title}: ${l.text}`).join("\n").toLowerCase();
    for (const needle of ["which team member recorded it", "who attended (email addresses)", "which team member a note or comment was written as", "the name of the person who connected a tool", "the email of the account a person connected", "private to the person who recorded it", "meeting inbox", "up to 14 days", "never counts as a reply"]) expect(lines, needle).toContain(needle);
    expect(storeLines({ meetings: false }).map((l) => l.text).join(" ")).not.toMatch(/Meeting inbox/);
  });
  it("what the two deletion buttons say names the new data", () => {
    const d = deletion();
    expect(d.synced).toEqual(expect.arrayContaining(["meetings from connected tools", "a log of what SubSync wrote to your CRM"]));
    expect(d.kept).toEqual(expect.arrayContaining(["each person's connected tools", "each person's meeting-note choices", "the rules for meeting notes"]));
    for (const s of [deleteMyDataText(), uninstallText(), removalAnswer()]) expect(s).not.toMatch(/gohighlevel|highlevel|leadconnector|\bghl\b|zoom|google meet|\bagenc/i);
  });
});

describe("the migration is safe by construction", () => {
  const sql = read("supabase/migrations/20261102070000_user_connections.sql");
  it("is additive and idempotent: only create table / index if not exists, no drop, delete or truncate of data", () => {
    const code = sql.replace(/--[^\n]*/g, "");
    expect(code).not.toMatch(/\b(drop|truncate)\b/i);
    expect(code.replace(/on delete (cascade|set null)/gi, "")).not.toMatch(/\bdelete\b/i);
    for (const m of code.matchAll(/create\s+(unique\s+)?(table|index)\s+(?!if not exists)/gi)) throw new Error(`not idempotent: ${m[0]}`);
    expect(code).not.toMatch(/\balter\s+table\s+public\.(?!user_connections|meeting_note_settings|meeting_policies|meetings|crm_writes)/i);
  });
  it("turns row level security on for every new table, creates no policy, and takes the public roles' privileges away", () => {
    for (const t of NEW) expect(sql, t).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).toMatch(/revoke all on table[^;]*from anon/);
    expect(sql).toMatch(/revoke all on table[^;]*from authenticated/);
  });
  it("enforces the rules in the database itself: one connection per person and provider, one meeting per person, provider and meeting, one write log row per part", () => {
    expect(sql).toMatch(/unique index if not exists user_connections_person_provider_idx on public\.user_connections \(ghl_user_id, provider\)/);
    expect(sql).toMatch(/unique index if not exists meetings_one_per_person_idx on public\.meetings \(owner_ghl_user_id, provider, provider_meeting_id\)/);
    expect(sql).toMatch(/unique index if not exists crm_writes_one_per_part_idx on public\.crm_writes \(meeting_id, contact_id, kind, part_no\)/);
  });
});

describe("nothing that feeds a screen can read a token", () => {
  it("the columns a screen may read name no encrypted column, secret or delivery key", () => {
    expect(SAFE_COLUMNS.filter((c) => /_enc$|secret|public_key|token/.test(c))).toEqual([]);
    for (const c of SAFE_COLUMNS) expect(schemaFromMigrations().get("user_connections")!.has(c), c).toBe(true);
  });
  it("the list and status queries select only those columns (no select *, no encrypted column)", () => {
    const personal = read("src/lib/connections/personal.ts");
    const listMine = personal.slice(personal.indexOf("export async function listMine"), personal.indexOf("export type SaveArgs"));
    expect(listMine).toMatch(/db\(SAFE_COLUMNS as never\)/);
    expect(listMine).not.toMatch(/select \*|u\.\*|_enc|public_key|webhook_secret/);
  });
  it("the endpoint file never touches an encrypted column, and never takes who the person is from the request", () => {
    const api = read("src/lib/api/connections-api.ts");
    expect(api).not.toMatch(/_enc|public_key|webhook_secret|decryptSecret/);
    expect(api).not.toMatch(/searchParams/);
    expect(api).not.toMatch(/body\.(userId|companyId|role|kind|installationId|personRole)/);
    expect(api.match(/personFromSession\(/g)!.length, "every endpoint starts from the signed session").toBeGreaterThanOrEqual(1);
    for (const fn of ["myConnectionsView", "myConnectionStart", "myConnectionTest", "myConnectionRemove", "teamConnectionsView", "teamConnectionRevoke", "policySave"]) {
      const start = api.indexOf(`export async function ${fn}`);
      expect(start, fn).toBeGreaterThan(-1);
      expect(api.slice(start, start + 600), `${fn} reads the person from the session first`).toMatch(/personOf\(ctx\)/);
    }
  });
  it("only the code that must use a token reads the encrypted columns", () => {
    const readers: string[] = [];
    const walk = (rel: string) => { for (const n of readdirSync(join(process.cwd(), rel))) { const p = `${rel}/${n}`; if (statSync(join(process.cwd(), p)).isDirectory()) { if (n !== "__tests__") walk(p); } else if (/\.(ts|tsx)$/.test(n) && /access_token_enc|refresh_token_enc|webhook_secret_enc/.test(read(p))) readers.push(p); } };
    walk("src");
    // The first six are the connection code and its inventory; the last three are the older code that reads the INSTALL tokens (not a person's tool tokens).
    expect(readers.sort()).toEqual([
      "src/lib/connections/cleanup.ts", "src/lib/connections/ingest-store.ts", "src/lib/connections/personal.ts", "src/lib/connections/queries.ts", "src/lib/data-inventory.ts", "src/lib/ghl/capabilities-run.ts", "src/lib/ghl/installations.ts", "src/lib/notifications/service.ts", "src/lib/sync/engine.ts", "src/lib/sync/watchdog.ts",
    ]);
    // notifications/service.ts (stage F9) only asks whether an install still has a refresh token (`is not null`, to skip fixture installs) like the watchdog; it never selects the value.
    expect(read("src/lib/notifications/service.ts").match(/refresh_token_enc[^`\n]*/g)).toEqual(["refresh_token_enc is not null order by created_at"]);
  });
});

describe("the menu and the people", () => {
  it("Connections is in every kind's menu: every role connects its own tools", () => {
    for (const kind of ["agency", "business", "client"] as const) expect(NAV_FOR[kind].has("connections"), kind).toBe(true);
  });
  it("the session carries the person's role from the verified sign-in, set in one place", () => {
    expect(read("src/app/api/sso/route.ts")).toMatch(/personRole: identity\.role/);
    expect(read("src/lib/session.ts")).toMatch(/personRole\?: Role/);
  });
});
