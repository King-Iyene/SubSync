import { describe, expect, it, vi } from "vitest";

// DB test for Find a lead: the keyset search returns every matching person exactly once, never a person of another company or of an account the caller may not see.
// Fixtures are tiny and all named xtest-, removed afterwards. Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describe.skipIf(!HAS_DB)("Find a lead keyset search", () => it("is complete, ordered and tenant-safe", async () => {
  const { sql, closeDb } = await import("@/lib/db");
  const { findPeople } = await import("@/lib/analytics/people-find-queries");
  const { decodeCursor } = await import("@/lib/people/find");
  const db = sql();
  const A = "xtest-find-a", B = "xtest-find-b";
  await db`delete from installations where company_id in (${A}, ${B})`;
  const [ia] = await db`insert into installations (company_id) values (${A}) returning id`;
  const [ib] = await db`insert into installations (company_id) values (${B}) returning id`;
  for (const [i, l] of [[ia.id, "xtest-loc-a1"], [ia.id, "xtest-loc-a2"], [ib.id, "xtest-loc-b1"]] as const) await db`insert into locations (installation_id, location_id, name) values (${i}, ${l}, ${l})`;
  const day = 86_400_000;
  const rows: Array<Record<string, unknown>> = [];
  // 120 people in a1 and 30 in a2 for company A: many share the same last-activity moment (ties), some have no activity and no date at all, one is an exact email match.
  for (let n = 0; n < 150; n++) {
    const loc = n < 120 ? "xtest-loc-a1" : "xtest-loc-a2";
    rows.push({ installation_id: ia.id, location_id: loc, contact_id: `xtest-c-${String(n).padStart(4, "0")}`, first_name: "Casey", last_name: `Tester${n}`, email: n === 77 ? "exact@xtest.example" : `casey${n}@xtest.example`,
      last_activity_at: n % 9 === 0 ? null : new Date(Date.UTC(2026, 10, 1) - Math.floor(n / 4) * day), date_added: n % 17 === 0 ? null : new Date(Date.UTC(2026, 9, 1) - n * 1000) });
  }
  for (let n = 0; n < 10; n++) rows.push({ installation_id: ib.id, location_id: "xtest-loc-b1", contact_id: `xtest-c-b${n}`, first_name: "Casey", last_name: `Other${n}`, email: `casey-b${n}@xtest.example`, last_activity_at: new Date(Date.UTC(2026, 10, 2)), date_added: new Date(Date.UTC(2026, 9, 2)) });
  for (const r of rows) await db`insert into cached_contacts ${db(r as never, "installation_id", "location_id", "contact_id", "first_name", "last_name", "email", "last_activity_at", "date_added")}`;
  try {
    const walk = async (allowed: string[] | null, f: { q?: string }, size: number) => {
      const seen: Array<{ locationId: string; contactId: string }> = [];
      let after = null as ReturnType<typeof decodeCursor>;
      let first = true;
      for (let guard = 0; guard < 100; guard++) {
        const p = await findPeople(ia.id as string, allowed, f, after, [], size);
        if (first) { expect(p.total !== null, "the first page carries the count").toBeTruthy(); first = false; } else expect(p.total, "later pages do not count again").toBe(null);
        seen.push(...p.rows.map((r) => ({ locationId: r.locationId, contactId: r.contactId })));
        after = p.next ? decodeCursor(p.next) : null;
        if (p.next) expect(after, "every cursor we hand out we accept back").toBeTruthy();
        if (!after) break;
      }
      return seen;
    };
    // everyone in company A: each once, none of B
    const all = await walk(null, { q: "casey" }, 7);
    const ids = all.map((r) => r.contactId);
    expect(ids.length, "every person found").toBe(150);
    expect(new Set(ids).size, "nobody twice").toBe(150);
    expect(ids.every((i) => !i.startsWith("xtest-c-b")), "nothing of the other company").toBeTruthy();
    // the exact email match comes first
    const top = await findPeople(ia.id as string, null, { q: "exact@xtest.example" }, null, [], 5);
    expect(top.rows[0]?.contactId).toBe("xtest-c-0077");
    // no search words at all (the Browse case): the order has no rank term, and it must still run
    const browse = await findPeople(ia.id as string, null, {}, null, [], 20);
    expect(browse.rows.length, "browse with no words").toBe(20);
    // limited to one account: only that account, even when the search words match the other
    const only = await walk(["xtest-loc-a2"], { q: "casey" }, 8);
    expect(only.length).toBe(30);
    expect(only.every((r) => r.locationId === "xtest-loc-a2")).toBeTruthy();
    // a cursor that names the other company's person changes nothing: the read is still limited to company A
    const forged = decodeCursor(Buffer.from(JSON.stringify([0, "-infinity", "-infinity", "xtest-loc-b1", "xtest-c-b9"])).toString("base64url"));
    const f = await findPeople(ia.id as string, null, { q: "casey" }, forged, [], 500);
    expect(f.rows.every((r) => !r.contactId.startsWith("xtest-c-b")), "a forged cursor cannot reach the other company").toBeTruthy();
    // company B asking for casey sees only its own
    const b = await findPeople(ib.id as string, null, { q: "casey" }, null, [], 50);
    expect(b.rows.length).toBe(10);
    expect(b.rows.every((r) => r.contactId.startsWith("xtest-c-b"))).toBeTruthy();
  } finally {
    await db`delete from installations where company_id in (${A}, ${B})`;
    await closeDb();
  }
}));
