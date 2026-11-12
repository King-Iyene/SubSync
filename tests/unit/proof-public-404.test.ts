import { NextRequest } from "next/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { proxy } from "@/proxy";
import { gateHash, notFoundPage, proofGate, sameText } from "@/lib/proof-gate";
import { TOKEN_SHAPE } from "@/lib/analytics/proof-core";
import { tokenHash } from "@/lib/analytics/proof-queries";

// The client's public report must answer a wrong link with a REAL 404 status (the page streams, so it could only say 200), with the same body every time, nothing echoed, and never indexed.
// A well-formed but unknown token needs the database to be told apart from a real one, so that case runs only where a database is configured; the others need none.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 60_000 });
// Skips until the migration that creates the link table is applied.
const READY = HAS_DB ? await sql()`select to_regclass('public.pr_links') is not null as ok`.then((r) => r[0].ok === true, () => false) : false;
afterAll(async () => { if (HAS_DB) await closeDb(); });
let n = 0;
const ask = (path: string) => proxy(new NextRequest(`http://localhost${path}`, { headers: { "x-forwarded-for": `10.9.${Math.floor(++n / 200)}.${n % 200}` } }));
const passedOn = (r: Response) => r.headers.get("x-middleware-next") === "1";

describe("public report: a bad link is a true 404", () => {
  const SHAPE_BAD = ["short", "x".repeat(44), "A".repeat(42) + "!", "%27%20or%201%3D1--", "..%2F..%2Fetc", "%3Cscript%3Ealert(1)%3C%2Fscript%3E", "%E0%A4%A"];

  it("answers 404 with one identical generic body and safe headers", async () => {
    const ref = await notFoundPage().text();
    for (const id of SHAPE_BAD) {
      const r = await ask(`/proof/${id}`);
      expect(r.status, id).toBe(404);
      expect(await r.text(), id).toBe(ref);
      expect(r.headers.get("cache-control")).toContain("no-store");
      expect(r.headers.get("x-robots-tag")).toContain("noindex");
      expect(r.headers.get("referrer-policy")).toBe("no-referrer");
      expect(r.headers.get("content-type")).toContain("text/html");
    }
  });

  it("a deeper or bare address is the same 404", async () => {
    const ref = await notFoundPage().text();
    for (const p of ["/proof", "/proof/", "/proof/a/b", `/proof/${"A".repeat(43)}/extra`]) {
      const r = await ask(p);
      expect(r.status, p).toBe(404);
      expect(await r.text(), p).toBe(ref);
    }
  });

  it("never repeats the address, names no company, product or platform, and carries the neutral tab icon", async () => {
    const body = await (await ask("/proof/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).text();
    expect(body).not.toContain("zzzzzzzz");
    expect(body).not.toMatch(/subsync|gohighlevel|highlevel|leadconnector|sub-?account|agency/i);
    expect(body).toContain('rel="icon"');
    expect(body).toContain("noindex");
  });

  it("the sample link and a query string pass on to the page", async () => {
    expect(passedOn(await ask("/proof/sample"))).toBe(true);
    expect(passedOn(await ask("/proof/sample?m=2026-01"))).toBe(true);
  });

  it("a month in the query does not change the answer for a bad link", async () => {
    const a = await (await ask("/proof/short?m=2026-01")).text(), b = await (await ask("/proof/short")).text();
    expect(a).toBe(b);
  });

  it("too many lookups from one address are turned away with the same 404", async () => {
    const ref = await notFoundPage().text();
    let last: Response | null = null;
    for (let i = 0; i < 40; i++) last = await proofGate("/proof/sample", "203.0.113.77");
    expect(last!.status).toBe(404);
    expect(await last!.text()).toBe(ref);
  });

  it("compares in constant time and still answers correctly", () => {
    expect(sameText("sample", "sample")).toBe(true);
    expect(sameText("sample", "sampl")).toBe(false);
    expect(sameText("sample", "Sample")).toBe(false);
  });

  it("uses the same token shape and the same hash as the report code", () => {
    expect(TOKEN_SHAPE.source).toBe(/^[A-Za-z0-9_-]{43}$/.source);
    expect(gateHash("abc")).toBe(tokenHash("abc"));
  });

  it.skipIf(!READY)("a well-formed token that no link holds is a 404 as well", async () => {
    const ref = await notFoundPage().text();
    for (const id of ["A".repeat(43), "Z".repeat(42) + "_"]) {
      const r = await ask(`/proof/${id}`);
      expect(r.status, id).toBe(404);
      expect(await r.text()).toBe(ref);
    }
  });
});
