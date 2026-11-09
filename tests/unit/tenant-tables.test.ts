import { describe, expect, it, vi } from "vitest";

// Every table that holds tenant data must be classified: deleted on uninstall, or kept on purpose with a reason.
// Two guards: a schema-drift test against the real database, and tests that run each purge function against a recording
// stand-in for the database and compare the tables it deletes from with the lists.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);

const executed: string[] = [];
const ident = (name: string) => ({ __ident: name });
vi.mock("@/lib/db", () => {
  const tag = (first: unknown, ...values: unknown[]) => {
    if (typeof first === "string") return ident(first); // tx("table") used as an identifier
    const strings = first as TemplateStringsArray;
    const query = strings.reduce((acc, s, i) => acc + s + (i < values.length ? ((values[i] as { __ident?: string })?.__ident ?? "?") : ""), "").replace(/\s+/g, " ").trim();
    if (query.includes("information_schema.tables")) {
      const tables = values.find(Array.isArray) as string[] | undefined;
      return Promise.resolve((tables ?? []).map((table_name) => ({ table_name })));
    }
    executed.push(query);
    return Promise.resolve([{ id: "inst-1" }]);
  };
  return { sql: () => ({ begin: async (fn: (tx: unknown) => unknown) => fn(tag), json: (x: unknown) => x }), closeDb: async () => undefined };
});

const deletedFrom = () => executed.filter((q) => /^delete from /.test(q)).map((q) => q.split(" ")[2]);

describe("purge functions use the lists", async () => {
  const lists = await import("@/lib/tenant-tables");
  const inst = await import("@/lib/ghl/installations");

  it("uninstall deletes exactly the uninstall list", async () => {
    executed.length = 0;
    await inst.purgeInstallation("some-company");
    expect(new Set(deletedFrom())).toEqual(new Set(lists.UNINSTALL_DELETE));
    expect(deletedFrom()).toHaveLength(lists.UNINSTALL_DELETE.length);
  });
  it("uninstall also empties the stored tokens, and never deletes the kept tables", async () => {
    executed.length = 0;
    await inst.purgeInstallation("some-company");
    expect(executed.some((q) => /update installations set access_token_enc = null, refresh_token_enc = null/.test(q))).toBe(true);
    for (const kept of lists.KEEP_ON_UNINSTALL) expect(deletedFrom()).not.toContain(kept);
  });
  it("'delete my data' deletes exactly the synced-data list, and keeps credentials and settings", async () => {
    executed.length = 0;
    await inst.purgeSyncedData("inst-1");
    expect(new Set(deletedFrom())).toEqual(new Set(lists.SYNCED_DELETE));
    for (const keep of ["settings", "api_keys", "connections", "installations"]) expect(deletedFrom()).not.toContain(keep);
  });
  it("removing one account deletes that account's rows from every location table", async () => {
    executed.length = 0;
    await inst.purgeLocationData("inst-1", "L1");
    expect(new Set(deletedFrom())).toEqual(new Set(lists.LOCATION_DELETE));
  });
  it("children are deleted before the tables they point to", () => {
    const o = lists.UNINSTALL_DELETE;
    expect(o.indexOf("cleanup_changes")).toBeLessThan(o.indexOf("cleanup_runs"));
    expect(o[o.length - 1] === "settings" || o.indexOf("locations") > o.indexOf("cached_contacts")).toBe(true);
  });
  it("what must be gone after uninstall includes the data that was missing before", () => {
    for (const t of ["meeting_notes", "connections", "api_keys", "cleanup_runs", "cleanup_changes", "lead_touches", "appointment_events", "shared_audits", "meeting_hooks", "duplicate_reviews", "roadmap_votes"]) {
      expect(lists.UNINSTALL_DELETE, t).toContain(t);
    }
  });
});

describe.skipIf(!HAS_DB)("schema drift", () => {
  it("every table with an installation_id is classified", async () => {
    vi.doUnmock("@/lib/db");
    vi.resetModules();
    const { sql, closeDb } = await import("@/lib/db");
    const lists = await import("@/lib/tenant-tables");
    const rows = await sql()`select distinct table_name from information_schema.columns where table_schema = 'public' and column_name = 'installation_id'`;
    const known = new Set<string>([...lists.UNINSTALL_DELETE, ...lists.KEEP_ON_UNINSTALL]);
    const unclassified = rows.map((r) => r.table_name as string).filter((t) => !known.has(t));
    const locRows = await sql()`select distinct table_name from information_schema.columns where table_schema = 'public' and column_name = 'location_id' and table_name <> 'installations'`;
    const knownLoc = new Set<string>([...lists.LOCATION_DELETE, ...lists.LOCATION_KEEP]);
    const unclassifiedLoc = locRows.map((r) => r.table_name as string).filter((t) => !knownLoc.has(t));
    await closeDb();
    expect(unclassified, `Tables with tenant data that no purge list mentions: ${unclassified.join(", ")}. Add each to src/lib/tenant-tables.ts.`).toEqual([]);
    expect(unclassifiedLoc, `Tables with a location_id that the per-account purge does not mention: ${unclassifiedLoc.join(", ")}.`).toEqual([]);
  });
});
