import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { encryptSecret } from "../src/lib/crypto";
import { closeDb, sql } from "../src/lib/db";
import { DEFAULT_OFF } from "../src/lib/flags-core";

// Feature switches end to end: turning a feature off in the database makes it vanish (API, sign-in
// response, public addresses) while everything else keeps working, and turning it back on restores it.
// The dev server runs with FLAGS_ALL_ON so the checks can see every feature; database rows still win.
// Usage: BASE_URL=http://localhost:3100 node --env-file=.env.local --import tsx scripts/check-flags.ts
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const KEYS = ["meetings", "connections", "reports", "ai", "setup_compare", "playbooks", "cleanup", "duplicates", "clients", "team", "activity", "zoom_meet"];
const ZOOM_SECRET = process.env.ZOOM_WEBHOOK_SECRET_TOKEN ?? "demo-zoom-secret-token";

// Every string VALUE in a JSON answer (keys are code, not text a person reads).
const textOf = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => textOf(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => textOf(x, out));
  return out;
};

async function main() {
  const call = async (path: string, token?: string, init: RequestInit = {}) => {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
  };
  const set = async (key: string, enabled: boolean) => { await sql()`insert into feature_flags (key, enabled, note) values (${key}, ${enabled}, 'check-flags') on conflict (key) do update set enabled = excluded.enabled`; };
  const clear = async () => { await sql()`delete from feature_flags where key = any(${KEYS}::text[])`; };
  // The harness starts its server with every default-off feature on (FLAGS_ALL_ON). A server started any other way (the browser tests' server,
  // or one left running) has the real defaults, so the starting state is made explicit: a row of "on" for each feature that is off by default.
  // A row beats a default, so this is the same state on both kinds of server. Only the rows this script writes are ever removed.
  const allOn = async () => { await clear(); for (const f of DEFAULT_OFF) await set(f, true); };
  await allOn();
  const sso = (await (await fetch(`${BASE}/api/sso`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demo: true }) })).json()) as { session: string; entitlements: { features: Record<string, boolean>; off: string[] } };
  const token = sso.session;

  try {
    // everything on to start with
    assert.deepEqual(sso.entitlements.off, [], "with the all-on setting nothing is off");
    for (const p of ["/api/app/meetings", "/api/app/connections", "/api/app/cleanup", "/api/app/api-keys", "/api/app/playbooks", "/api/app/clients", "/api/app/duplicates", "/api/app/team", "/api/app/contact-intel"]) assert.equal((await call(p, token)).status, 200, p);
    assert.notEqual((await call("/api/app/clients/compare", token)).status, 404, "compare exists while reports are on");

    // Zoom and Google Meet (stage S0.2b, King's decision of 1 Nov 2026). A database row turns just this one off (every switch is on at this point):
    // that is the real default state of production. Nothing a person reads may name them, a stored Zoom connection is hidden, a Zoom sign-in cannot
    // start, and the two addresses Zoom's app registration points at keep answering.
    {
      const [demo] = await sql()`select id from installations where is_demo`;
      await sql()`delete from connections where installation_id = ${demo.id} and provider = 'zoom'`;
      await sql()`insert into connections (installation_id, provider, label, external_id, access_token_enc, refresh_token_enc, token_expires_at, connected_by)
        values (${demo.id}, 'zoom', 'flag-check@x.test', 'zoomhost-flag-check', ${encryptSecret("a")}, ${encryptSecret("b")}, now() + interval '1 hour', 'check-flags')`;
      try {
        const named = /zoom|google meet/i;
        const answers = async () => ({
          connections: await call("/api/app/connections", token), start: await call("/api/app/start", token), settings: await call("/api/app/settings", token), meetings: await call("/api/app/meetings", token),
        });
        const on = await answers();
        assert.equal(typeof (on.connections.body.available as Record<string, unknown>).zoom, "boolean", "switch on: Zoom is listed");
        assert.ok((on.connections.body.connections as Array<{ provider: string }>).some((c) => c.provider === "zoom"), "switch on: the stored Zoom connection is listed");
        assert.ok(textOf(on.start.body).some((t) => named.test(t)), "switch on: Getting started names Zoom (so the next assertion is not passing on an empty page)");

        await set("zoom_meet", false);
        const off = await answers();
        for (const [name, r] of Object.entries(off)) {
          assert.equal(r.status, 200, name);
          const hit = textOf(r.body).find((t) => named.test(t));
          assert.equal(hit, undefined, `switch off: ${name} still says "${hit}"`);
        }
        assert.equal("zoom" in (off.connections.body.available as object), false, "switch off: Zoom is not offered");
        assert.equal((off.connections.body.connections as Array<{ provider: string }>).some((c) => c.provider === "zoom"), false, "switch off: a stored Zoom connection is hidden");
        assert.equal((await call("/api/app/connections/zoom/start", token, { method: "POST", body: "{}" })).status, 404, "switch off: a Zoom sign-in cannot be started");
        assert.equal((await call("/api/app/connections/slack/start", token, { method: "POST", body: "{}" })).status, 400, "Slack is untouched (the demo cannot start a real sign-in)");
        assert.equal((await call("/api/app/connections/fathom/start", token, { method: "POST", body: "{}" })).status, 400, "and so is Fathom");
        assert.ok((off.connections.body.connections as Array<{ provider: string }>).every((c) => c.provider !== "zoom"));
        // The addresses the Zoom app registration points at still answer.
        assert.equal((await call("/api/integrations/zoom/callback?state=forged")).status, 400, "the Zoom return address still answers (a forged return gets its usual refusal, not a 404)");
        const challenge = await call("/api/hooks/zoom", undefined, { method: "POST", body: JSON.stringify({ event: "endpoint.url_validation", payload: { plainToken: "abc123" } }) });
        // The harness gives its server a made-up Zoom secret, so the check is answered in full. A server started without one answers 503 "not switched
        // on" (the secret is an environment variable), which still proves the address exists: what must never happen is a 404 because of the switch.
        assert.ok(challenge.status === 200 || challenge.status === 503, `Zoom's address check still answers (got ${challenge.status}; 404 would mean the switch took the address away)`);
        if (challenge.status === 200) assert.equal(challenge.body.encryptedToken, createHmac("sha256", ZOOM_SECRET).update("abc123").digest("hex"));
      } finally {
        await sql()`delete from connections where installation_id = ${demo.id} and provider = 'zoom' and external_id = 'zoomhost-flag-check'`;
        await allOn();
      }
    }

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
    await allOn();
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
