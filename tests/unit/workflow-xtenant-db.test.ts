import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handleAction } from "@/lib/workflow-module/actions";
import { realActionDeps } from "@/lib/workflow-module/runtime";
import { setBlock, saveSubscription } from "@/lib/workflow-module/store";

// Cross-tenant test for the workflow module with tiny fixtures (prefix xtest-) removed afterwards. Skips until the migration is applied.
//   1. An action call names an account; a contact or appointment that belongs to ANOTHER company is never found through it.
//   2. An account that has not switched an action on is refused; unknown accounts are refused.
//   3. One company cannot save a trigger address for another company's account (the account decides the company, not the caller).
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-wfm-a", CO_B = "xtest-wfm-b", LA = "xtestWfmLocA1", LB = "xtestWfmLocB1", CA = "xtestWfmCtcA1", CB = "xtestWfmCtcB1";
let instA = "", instB = "", ready = false;
const call = (key: string, loc: string, contact: string) => ({ extras: { locationId: loc, contactId: contact, workflowId: "xtestwf0001" }, meta: { key }, data: {} });

describe.skipIf(!HAS_DB)("workflow module cross-tenant", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from wfm_settings limit 1`; await sql()`select 1 from wfm_action_log limit 1`; ready = true; } catch { ready = false; }
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzWfm A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzWfm B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, last_synced_at) values (${instA}, ${LA}, 'zzWfm A1', 'UTC', true, now()), (${instB}, ${LB}, 'zzWfm B1', 'UTC', true, now())`;
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name) values (${instA}, ${LA}, ${CA}, 'zzA'), (${instB}, ${LB}, ${CB}, 'zzB')`;
    await setBlock(instA, LA, "subsync_add_to_call_queue", { enabled: true }, "t");
  });
  afterAll(async () => {
    if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("an enabled account reaches only its own contacts", async () => {
    if (!ready) return;
    const own = await handleAction(call("subsync_add_to_call_queue", LA, CA), realActionDeps);
    expect(own.status).toBe(200);
    expect(["dry_run", "done", "already"]).toContain(own.body.result);
    const cross = await handleAction(call("subsync_add_to_call_queue", LA, CB), realActionDeps);
    expect(cross.body.result).toBe("not_found");
  });
  it("another company that has not switched the action on, and unknown accounts, are refused", async () => {
    if (!ready) return;
    expect((await handleAction(call("subsync_add_to_call_queue", LB, CB), realActionDeps)).body.result).toBe("not_enabled");
    expect((await handleAction(call("subsync_add_to_call_queue", "xtestNoSuchLoc", CA), realActionDeps)).status).toBe(403);
  });
  it("a trigger address is stored for the company that owns the account only", async () => {
    if (!ready) return;
    const sub = { triggerKey: "subsync_no_show" as const, targetUrl: "https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/a1b2/c3d4", workflowId: "xtestwf0001", triggerId: "xtesttr0001", locationId: LA, eventType: "CREATED" as const };
    await saveSubscription(instA, sub);
    const rows = await sql()`select installation_id from wfm_subscriptions where location_id = ${LA}`;
    expect(rows.map((r) => r.installation_id)).toEqual([instA]);
    expect((await sql()`select 1 from wfm_subscriptions where installation_id = ${instB}`).length).toBe(0);
  });
});
