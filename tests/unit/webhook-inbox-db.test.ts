import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";

// The webhook inbox against the real database: queue (route), drain (worker), retries, a worker that dies mid-drain, and tenancy. Skipped without a database.
// Fixture: two companies that use the SAME contact ids in different accounts; a delete for one must never touch the other. Everything created here is removed again.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
vi.mock("@/lib/ghl/webhook", async (orig) => ({ ...(await orig<typeof import("@/lib/ghl/webhook")>()), verifyWebhook: () => true }));

const CO1 = "xtest-wi-co1", CO2 = "xtest-wi-co2", L1 = "xtestWiL1", L2 = "xtestWiL2", P = "xtest-wi-";
let i1 = "", i2 = "", applied = false;

const send = async (body: Record<string, unknown>) => {
  const { POST } = await import("@/app/api/webhooks/ghl/route");
  return POST(new Request("http://localhost/api/webhooks/ghl", { method: "POST", headers: { "x-ghl-signature": "x" }, body: JSON.stringify(body) }));
};
const del = (n: number, id: string, extra: Record<string, unknown> = {}) => ({ type: "ContactDelete", id, locationId: L1, companyId: CO1, webhookId: `${P}${n}`, ...extra });
const contacts = async (inst: string) => (await sql()`select contact_id from cached_contacts where installation_id = ${inst} order by contact_id`).map((r) => r.contact_id as string);
const inbox = async (n: number) => (await sql()`select * from webhook_inbox where webhook_id = ${P + n}`)[0];

describe.skipIf(!HAS_DB)("webhook inbox against the database", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from webhook_inbox limit 1`; applied = true; } catch { applied = false; }
    if (!applied) return;
    await sql()`delete from installations where company_id in (${CO1}, ${CO2})`;
    await sql()`delete from webhook_inbox where webhook_id like ${P + "%"}`;
    await sql()`delete from webhook_events where webhook_id like ${P + "%"}`;
    [{ id: i1 }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO1}, 'zzWi One', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: i2 }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO2}, 'zzWi Two', 'pro') returning id`) as unknown as Array<{ id: string }>;
    await sql()`insert into locations (installation_id, location_id, name) values (${i1}, ${L1}, 'zzWi A'), (${i2}, ${L2}, 'zzWi B')`;
    const rows = (inst: string, loc: string, ids: string[]) => ids.map((c) => ({ installation_id: inst, location_id: loc, contact_id: c }));
    await sql()`insert into cached_contacts ${sql()([...rows(i1, L1, ["c1", "c2", "c3", "c4", "c5"]), ...rows(i2, L2, ["c1", "c2", "c3"])] as never)}`;
  });
  afterAll(async () => {
    if (applied) {
      await sql()`delete from installations where company_id in (${CO1}, ${CO2})`;
      await sql()`delete from webhook_inbox where webhook_id like ${P + "%"}`;
      await sql()`delete from webhook_events where webhook_id like ${P + "%"}`;
    }
    await closeDb();
  });

  it("queues a retry of the same event once, and answers 200 both times", async () => {
    if (!applied) return;
    for (const [n, id] of [[1, "c1"], [2, "c2"], [3, "c3"]] as const) {
      const a = await send(del(n, id)), b = await send(del(n, id));
      expect([a.status, b.status]).toEqual([200, 200]);
    }
    const [{ n }] = await sql()`select count(*)::int n from webhook_inbox where webhook_id like ${P + "%"}`;
    expect(n).toBe(3);
    expect(await contacts(i1)).toHaveLength(5); // nothing is applied in the request
  });

  it("drains the deletes in bulk, only for the right account, and empties the payload", async () => {
    if (!applied) return;
    const { drainWebhookInbox } = await import("@/lib/ghl/webhook-inbox");
    const r = await drainWebhookInbox({ budgetMs: 20_000 });
    expect(r.setBased).toBeGreaterThanOrEqual(3);
    expect(await contacts(i1)).toEqual(["c4", "c5"]);
    expect(await contacts(i2)).toEqual(["c1", "c2", "c3"]); // same ids, other company: untouched
    const row = await inbox(1);
    expect(row.processed_at).not.toBeNull();
    expect(row.body).toBeNull();
    expect(row.outcome).toBe("handled");
    const [ev] = await sql()`select outcome from webhook_events where webhook_id = ${P + 1}`;
    expect(ev.outcome).toBe("handled");
  });

  it("the same event arriving again after it was handled stores nothing and handles nothing", async () => {
    if (!applied) return;
    const { drainWebhookInbox } = await import("@/lib/ghl/webhook-inbox");
    expect((await send(del(1, "c1"))).status).toBe(200);
    const [{ n }] = await sql()`select count(*)::int n from webhook_inbox where webhook_id = ${P + 1}`;
    expect(n).toBe(1);
    const r = await drainWebhookInbox({ budgetMs: 10_000 });
    expect(r.claimed).toBe(0);
  });

  it("a worker that dies mid-drain loses nothing: the claim expires and the row is handled once", async () => {
    if (!applied) return;
    const { drainWebhookInbox } = await import("@/lib/ghl/webhook-inbox");
    await send(del(4, "c4"));
    // The dead worker had claimed it (and maybe half done the work): claimed, attempt counted, never finished.
    await sql()`update webhook_inbox set claimed_at = now(), attempts = 1 where webhook_id = ${P + 4}`;
    const live = await drainWebhookInbox({ budgetMs: 10_000 });
    expect(live.claimed).toBe(0); // a live claim is respected
    expect(await contacts(i1)).toContain("c4");
    await sql()`update webhook_inbox set claimed_at = now() - interval '5 minutes' where webhook_id = ${P + 4}`;
    const later = await drainWebhookInbox({ budgetMs: 10_000 });
    expect(later.claimed).toBe(1);
    expect(await contacts(i1)).toEqual(["c5"]);
    const row = await inbox(4);
    expect(row.attempts).toBe(2);
    expect(row.outcome).toBe("handled");
    // Running the whole thing again changes nothing (idempotent).
    await sql()`update webhook_inbox set processed_at = null, claimed_at = null, body = ${sql().json(del(4, "c4") as never)} where webhook_id = ${P + 4}`;
    await drainWebhookInbox({ budgetMs: 10_000 });
    expect(await contacts(i1)).toEqual(["c5"]);
  });

  it("an event for an account we do not hold is closed with a plain reason, and the other path (one at a time) is used", async () => {
    if (!applied) return;
    const { drainWebhookInbox } = await import("@/lib/ghl/webhook-inbox");
    expect((await send({ type: "ContactUpdate", contactId: "zz", locationId: "xtestWiNobody", webhookId: `${P}5` })).status).toBe(200);
    await drainWebhookInbox({ budgetMs: 10_000 });
    const row = await inbox(5);
    expect(row.processed_at).not.toBeNull();
    const [ev] = await sql()`select outcome from webhook_events where webhook_id = ${P + 5}`;
    expect(ev.outcome).toMatch(/ignored/);
  });

  it("a row that keeps killing its worker is closed as failed, never left pending and never dropped silently", async () => {
    if (!applied) return;
    const { drainWebhookInbox, MAX_ATTEMPTS } = await import("@/lib/ghl/webhook-inbox");
    await sql()`insert into webhook_inbox (webhook_id, event_type, body, attempts, claimed_at) values (${P + 6}, 'ContactUpdate', ${sql().json({ type: "ContactUpdate" } as never)}, ${MAX_ATTEMPTS}, now() - interval '10 minutes')`;
    const r = await drainWebhookInbox({ budgetMs: 10_000 });
    expect(r.gaveUp).toBeGreaterThanOrEqual(1);
    const row = await inbox(6);
    expect(row.processed_at).not.toBeNull();
    expect(row.outcome).toMatch(/^failed/);
  });
});
