import assert from "node:assert/strict";
import { closeDb, sql } from "../src/lib/db";

// Feature switches end to end: turning a feature off in the database makes it vanish (API, sign-in
// response, public addresses) while everything else keeps working, and turning it back on restores it.
// The dev server runs with FLAGS_ALL_ON so the checks can see every feature; database rows still win.
// Usage: BASE_URL=http://localhost:3100 node --env-file=.env.local --import tsx scripts/check-flags.ts
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const KEYS = ["meetings", "connections", "reports", "ai", "setup_compare", "playbooks", "cleanup", "duplicates", "clients", "team", "activity"];

async function main() {
  const call = async (path: string, token?: string, init: RequestInit = {}) => {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
  };
  const sso = (await (await fetch(`${BASE}/api/sso`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demo: true }) })).json()) as { session: string; entitlements: { features: Record<string, boolean>; off: string[] } };
  const token = sso.session;
  const set = async (key: string, enabled: boolean) => { await sql()`insert into feature_flags (key, enabled, note) values (${key}, ${enabled}, 'check-flags') on conflict (key) do update set enabled = excluded.enabled`; };
  const clear = async () => { await sql()`delete from feature_flags where key = any(${KEYS}::text[])`; };
  await clear();

  try {
    // everything on to start with
    assert.deepEqual(sso.entitlements.off, [], "with the all-on setting nothing is off");
    for (const p of ["/api/app/meetings", "/api/app/connections", "/api/app/cleanup", "/api/app/api-keys", "/api/app/playbooks", "/api/app/clients", "/api/app/duplicates", "/api/app/team", "/api/app/contact-intel"]) assert.equal((await call(p, token)).status, 200, p);
    assert.notEqual((await call("/api/app/clients/compare", token)).status, 404, "compare exists while reports are on");

    // meetings off: the page, the private address and the sign-in response all agree
    await set("meetings", false);
    const m = await call("/api/app/meetings", token);
    assert.equal(m.status, 404);
    assert.equal(m.body.off, true);
    assert.equal((await call("/api/hooks/meeting/mh_" + "Z".repeat(43), undefined, { method: "POST", body: "{}" })).status, 404);
    const again = (await (await fetch(`${BASE}/api/sso`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demo: true }) })).json()) as { entitlements: { features: Record<string, boolean>; off: string[] } };
    assert.equal(again.entitlements.features.meetings, false);
    assert.ok(again.entitlements.off.includes("meetings"));
    assert.equal(again.entitlements.features.inbox, true, "other features are untouched");
    assert.equal(((await call("/api/app/settings", token)).body.features as Record<string, boolean>).meetings, false, "Settings knows to hide its card");
    assert.equal((await call("/api/app/inbox", token)).status, 200);

    // connections off: the page, the sign-in return and both provider addresses go dead
    await set("connections", false);
    assert.equal((await call("/api/app/connections", token)).status, 404);
    assert.equal((await call("/api/integrations/slack/callback?state=x")).status, 404);
    assert.equal((await call("/api/hooks/zoom", undefined, { method: "POST", body: "{}" })).status, 404);
    assert.equal((await call("/api/hooks/fathom/" + "A".repeat(28), undefined, { method: "POST", body: "{}" })).status, 404);

    // reports off: the review and compare tabs go, the client list itself stays
    await set("reports", false);
    assert.equal((await call("/api/app/clients/compare", token)).status, 404);
    assert.equal((await call("/api/app/clients", token)).status, 200, "the client list is a separate switch");
    const accounts = (await call("/api/app/accounts", token)).body.accounts as Array<{ locationId: string }>;
    assert.equal((await call(`/api/app/qbr/${accounts[0].locationId}`, token)).status, 404);

    // the rest of the deferred set
    for (const [key, path] of [["ai", "/api/app/api-keys"], ["setup_compare", "/api/app/setup-compare"], ["playbooks", "/api/app/playbooks"], ["cleanup", "/api/app/cleanup"], ["duplicates", "/api/app/duplicates"], ["clients", "/api/app/clients"], ["team", "/api/app/team"], ["activity", "/api/app/contact-intel"]] as const) {
      await set(key, false);
      assert.equal((await call(path, token)).status, 404, `${key} off`);
    }

    // and back on
    await clear();
    for (const p of ["/api/app/meetings", "/api/app/connections", "/api/app/cleanup", "/api/app/api-keys", "/api/app/playbooks", "/api/app/duplicates", "/api/app/clients", "/api/app/team", "/api/app/contact-intel"]) assert.equal((await call(p, token)).status, 200, `${p} is back`);
    console.log("feature switches: off hides the page, API and public addresses; others untouched; back on restores: ok");
  } finally {
    await clear();
    await closeDb();
  }
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
