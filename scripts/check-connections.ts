import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { encryptSecret } from "../src/lib/crypto";
import { closeDb, sql } from "../src/lib/db";

// Checks connections end to end against a running dev server in demo mode, with a pretend Fathom and a
// pretend Zoom that sign their deliveries the way the real ones do. It touches the demo copy only.
// Usage: BASE_URL=http://localhost:3100 node --env-file=.env.local --import tsx scripts/check-connections.ts
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const ZOOM_SECRET = process.env.ZOOM_WEBHOOK_SECRET_TOKEN ?? "demo-zoom-secret-token";

async function main() {
  const call = async (path: string, init: RequestInit & { token?: string | null } = {}) => {
    const { token, ...rest } = init;
    const res = await fetch(`${BASE}${path}`, { ...rest, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}) } });
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, body: type.includes("json") ? await res.json() : await res.text() };
  };
  const signIn = async (as?: string) => (await call("/api/sso", { method: "POST", body: JSON.stringify({ demo: true, ...(as ? { as } : {}) }) })).body;
  const token = (await signIn()).session as string;
  const biz = await signIn("business");
  const bt = biz.session as string;
  const own = biz.user.activeLocation as string;
  const ct = (await signIn("client")).session as string;

  const [inst] = await sql()`select id from installations where is_demo`;
  const accounts = (await call("/api/app/accounts", { token })).body.accounts as Array<{ locationId: string; name: string; ignored: boolean }>;
  const live = accounts.filter((a) => !a.ignored);
  const A = live[0].locationId;
  const B = live.find((a) => a.locationId !== A)!.locationId;
  const clean = async () => {
    await sql()`delete from meeting_notes where installation_id = ${inst.id} and (source in ('zoom', 'fathom') or title like 'CONN-%')`;
    await sql()`delete from connections where installation_id = ${inst.id}`;
    await sql()`delete from cached_contacts where installation_id = ${inst.id} and contact_id like 'conn-t%'`;
  };
  await clean();

  // --- the screen's data: nothing switched on, nothing connected, no secrets
  const list0 = await call("/api/app/connections", { token });
  assert.equal(list0.status, 200);
  assert.deepEqual(list0.body.connections, []);
  assert.equal(typeof list0.body.available.slack, "boolean");
  assert.equal(typeof list0.body.available.zoom, "boolean", "this server has every switch on, so Zoom is listed (the switch-off case is in check-flags)");
  assert.equal("accounts" in list0.body, false, "no list of accounts to save meetings in: that choice is gone (N93)");
  assert.equal((await call("/api/app/connections", { token: ct })).status, 403, "a client view has no connections");
  assert.equal((await call("/api/app/connections/slack/start", { token: ct, method: "POST", body: "{}" })).status, 403);
  assert.equal((await call("/api/app/connections", { token: bt })).status, 200, "a business can connect its own tools");
  assert.equal((await call("/api/app/connections/nope/start", { token, method: "POST", body: "{}" })).status, 404, "unknown app");
  assert.equal((await call("/api/app/connections/slack/start", { token, method: "POST", body: "{}" })).status, 400, "the demo cannot start a real sign-in");
  assert.equal((await call("/api/integrations/slack/callback?code=x&state=forged")).status, 400, "a forged return is refused");
  assert.equal((await call("/api/integrations/nope/callback")).status, 404);

  // --- stage E0: personal connections. Every kind of session may list and start ITS OWN connections; the status table and the rules are for administrators.
  for (const [name, tk] of [["agency", token], ["business", bt], ["client", ct]] as const) {
    const mine = await call("/api/app/my-connections", { token: tk });
    assert.equal(mine.status, 200, `${name}: my connections`);
    assert.deepEqual(mine.body.connections, [], `${name}: nothing connected yet`);
    assert.ok(mine.body.cards.some((c: { provider: string }) => c.provider === "fathom"), `${name}: Fathom is offered`);
    assert.equal(JSON.stringify(mine.body).includes("zoom"), mine.body.cards.some((c: { provider: string }) => c.provider === "zoom"), `${name}: this server has every switch on`);
    assert.equal((await call("/api/app/my-connections/fathom/start", { token: tk, method: "POST", body: "{}" })).status, 400, `${name}: the demo cannot start a real sign-in`);
    assert.equal((await call("/api/app/my-connections/nope/start", { token: tk, method: "POST", body: "{}" })).status, 404, `${name}: unknown tool`);
    assert.equal((await call("/api/app/my-connections/not-an-id", { token: tk, method: "DELETE" })).status, 404, `${name}: a made-up id`);
  }
  const teamView = await call("/api/app/team-connections", { token });
  assert.equal(teamView.status, 200, "an administrator sees the team page");
  assert.deepEqual(teamView.body.team, []);
  assert.equal(JSON.stringify(teamView.body).match(/_enc|webhook_secret|public_key/), null, "no secret column name in the answer");
  assert.equal((await call("/api/app/meeting-policy", { token, method: "PUT", body: JSON.stringify({ scope: "agency", flags: {} }) })).status, 403, "only the company owner saves the company rule (the demo person is an administrator)");
  assert.equal((await call("/api/app/meeting-policy", { token, method: "PUT", body: "not json" })).status, 400);
  assert.equal((await call("/api/app/team-connections/not-an-id/revoke", { token, method: "POST", body: "{}" })).status, 404);
  assert.equal((await call("/api/app/my-connections")).status, 401, "no session, no answer");

  // --- a person who knows a contact in account A
  await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, tags, date_added)
    values (${inst.id}, ${A}, 'conn-t1', 'Dana', 'Lee', 'dana.conn@x.test', '{}', now())`;

  // --- Fathom: a connection with a known secret, and signed deliveries
  const secretRaw = Buffer.from("fathom-test-signing-secret-0123456789").toString("base64");
  const key = "fathomkey" + "A".repeat(20);
  await sql()`insert into connections (installation_id, provider, label, external_id, access_token_enc, refresh_token_enc, token_expires_at, webhook_secret_enc, public_key, connected_by)
    values (${inst.id}, 'fathom', 'Fathom', 'wh_test', ${encryptSecret("at")}, ${encryptSecret("rt")}, now() + interval '1 hour', ${encryptSecret("whsec_" + secretRaw)}, ${key}, 'check')`;
  const deliver = (payload: unknown, o: { id?: string; ts?: number; sign?: boolean; path?: string } = {}) => {
    const body = JSON.stringify(payload);
    const id = o.id ?? "msg_" + Math.random().toString(36).slice(2);
    const ts = String(o.ts ?? Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", Buffer.from(secretRaw, "base64")).update(`${id}.${ts}.${body}`).digest("base64");
    return call(o.path ?? `/api/hooks/fathom/${key}`, { method: "POST", body, headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": o.sign === false ? "v1,AAAA" : `v1,${sig}` } });
  };
  const meeting = (extra: Record<string, unknown> = {}) => ({
    title: "CONN-QBR", meeting_title: "CONN-QBR", recording_id: "rec-1", share_url: "https://fathom.video/share/abc", created_at: "2026-10-30T10:00:00Z",
    default_summary: { template_name: "general", markdown_formatted: "## Summary\nDana wants a quote by Friday." },
    action_items: [{ description: "Send the quote" }, { description: "Book a site visit" }],
    calendar_invitees: [{ name: "Dana Lee", email: "Dana.Conn@X.test", is_external: true }],
    transcript: [{ speaker: { display_name: "Dana" }, text: "Hello there", timestamp: "00:00:01" }], ...extra,
  });

  const first = await deliver(meeting());
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.saved, true);
  const [note] = await sql()`select location_id, contact_id, source, summary, action_items, transcript from meeting_notes where installation_id = ${inst.id} and title = 'CONN-QBR'`;
  assert.equal(note.location_id, A, "filed in the account that knows the attendee");
  assert.equal(note.contact_id, "conn-t1", "and matched to that contact");
  assert.equal(note.source, "fathom");
  assert.match(note.summary, /quote by Friday/);
  assert.equal(note.transcript, null, "no transcript is kept unless the account chose to keep them");
  assert.equal((note.action_items as string[]).length, 2);

  const again = await deliver(meeting(), { id: "msg_retry" });
  assert.equal(again.status, 200);
  assert.equal(again.body.saved, false);
  assert.equal(again.body.reason, "duplicate", "Fathom retries do not create a second note");
  assert.equal((await sql()`select count(*)::int n from meeting_notes where installation_id = ${inst.id} and title = 'CONN-QBR'`)[0].n, 1);

  assert.equal((await deliver(meeting({ recording_id: "rec-2" }), { sign: false })).status, 401, "a wrong signature is refused");
  assert.equal((await deliver(meeting({ recording_id: "rec-3" }), { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401, "a signed but old delivery is refused");
  assert.equal((await deliver(meeting({ recording_id: "rec-4" }), { path: `/api/hooks/fathom/${"B".repeat(30)}` })).status, 404, "a wrong address");
  assert.equal((await call("/api/hooks/fathom/short", { method: "POST", body: "{}" })).status, 404);
  assert.equal((await deliver({ nothing: "useful" })).body.ignored, true, "something that is not a meeting is acknowledged and dropped");

  // nobody known in the meeting: counted, never saved. There is no setting that could change that (N93).
  const stranger = meeting({ recording_id: "rec-5", title: "CONN-STRANGER", calendar_invitees: [{ name: "Nobody", email: "nobody@nowhere.test" }] });
  const skipped = await deliver(stranger);
  assert.equal(skipped.body.saved, false);
  assert.equal(skipped.body.reason, "no_account", "never a guessed account");
  assert.equal((await sql()`select count(*)::int n from meeting_notes where installation_id = ${inst.id} and title = 'CONN-STRANGER'`)[0].n, 0);
  const conn = (await call("/api/app/connections", { token })).body.connections[0];
  assert.equal(conn.provider, "fathom");
  assert.equal(conn.saved, 1);
  assert.equal(conn.skipped, 1);
  assert.equal(JSON.stringify(conn).includes("whsec"), false, "no secret ever reaches the browser");
  assert.equal(Object.keys(conn).some((k) => /token|secret|enc/i.test(k)), false);

  // The old "save it in this account" setting is gone from the API, from the list the screen gets, and from the database column's use.
  for (const body of [{ defaultLocationId: B }, { defaultLocationId: null }, {}]) {
    const r = await call(`/api/app/connections/${conn.id}`, { token, method: "PUT", body: JSON.stringify(body) });
    assert.ok(r.status === 404 || r.status === 405, `no route can set a default account, got ${r.status}`);
  }
  assert.equal("defaultLocationId" in conn, false, "and the connection list has no such field");
  const again2 = await deliver({ ...stranger, recording_id: "rec-6" });
  assert.equal(again2.body.saved, false);
  assert.equal(again2.body.reason, "no_account", "a stranger is still not saved, however often it arrives");
  assert.equal((await sql()`select count(*)::int n from meeting_notes where installation_id = ${inst.id} and title = 'CONN-STRANGER'`)[0].n, 0);
  // Even a leftover value in the column (an old row, or someone writing it by hand) changes nothing: the code does not read it.
  await sql()`update connections set default_location_id = ${B} where installation_id = ${inst.id} and provider = 'fathom'`;
  assert.equal((await deliver({ ...stranger, recording_id: "rec-6b" })).body.saved, false, "a stored default account is never read");
  await sql()`update connections set default_location_id = null where installation_id = ${inst.id} and provider = 'fathom'`;

  // A single business never leaves its own account, and never guesses: Dana is known in A only, so a connection limited to B finds nobody.
  await sql()`update connections set only_location_id = ${B} where installation_id = ${inst.id} and provider = 'fathom'`;
  const onlyB = await deliver(meeting({ recording_id: "rec-7", title: "CONN-ONLY-B" }));
  assert.equal(onlyB.body.saved, false);
  assert.equal((await sql()`select count(*)::int n from meeting_notes where installation_id = ${inst.id} and title = 'CONN-ONLY-B'`)[0].n, 0, "not saved in B (nobody there is known) and not in A (it is not this business's account)");
  // The same email in both accounts: inside B alone it is one record, so it matches B. For a connection that sees both it is not certain, so nothing is saved.
  await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, tags, date_added)
    values (${inst.id}, ${B}, 'conn-t2', 'Dana', 'Lee', 'dana.conn@x.test', '{}', now())`;
  const bothB = await deliver(meeting({ recording_id: "rec-8", title: "CONN-SHARED-B" }));
  assert.equal(bothB.body.saved, true, "a connection limited to B matches the one record in B");
  const [sharedB] = await sql()`select location_id, contact_id from meeting_notes where installation_id = ${inst.id} and title = 'CONN-SHARED-B'`;
  assert.deepEqual([sharedB.location_id, sharedB.contact_id], [B, "conn-t2"]);
  await sql()`update connections set only_location_id = null where installation_id = ${inst.id} and provider = 'fathom'`;
  const shared = await deliver(meeting({ recording_id: "rec-9", title: "CONN-SHARED-BOTH" }));
  assert.equal(shared.body.saved, false);
  assert.equal(shared.body.reason, "no_account", "the same email in two clients is never auto-picked (N48, N93)");
  assert.equal((await sql()`select count(*)::int n from meeting_notes where installation_id = ${inst.id} and title = 'CONN-SHARED-BOTH'`)[0].n, 0);
  await sql()`delete from cached_contacts where installation_id = ${inst.id} and contact_id = 'conn-t2'`;

  const mv = await call("/api/app/meetings", { token });
  assert.ok(mv.body.meetings.some((m: { title: string; source: string }) => m.title === "CONN-QBR" && m.source === "fathom"), "it shows in Meeting notes");
  const bm = await call("/api/app/meetings", { token: bt });
  assert.ok(bm.body.meetings.every((m: { locationId: string }) => m.locationId === own), "a business sees only its own account's notes");

  // --- Zoom: the address check, signed summaries, removal
  const zoomPost = (payload: unknown, o: { sign?: boolean; ts?: number } = {}) => {
    const body = JSON.stringify(payload);
    const ts = String(o.ts ?? Math.floor(Date.now() / 1000));
    const sig = "v0=" + createHmac("sha256", ZOOM_SECRET).update(`v0:${ts}:${body}`).digest("hex");
    return call("/api/hooks/zoom", { method: "POST", body, headers: { "x-zm-request-timestamp": ts, "x-zm-signature": o.sign === false ? "v0=bad" : sig } });
  };
  const challenge = await call("/api/hooks/zoom", { method: "POST", body: JSON.stringify({ event: "endpoint.url_validation", payload: { plainToken: "abc123" } }) });
  assert.equal(challenge.status, 200);
  assert.equal(challenge.body.plainToken, "abc123");
  assert.equal(challenge.body.encryptedToken, createHmac("sha256", ZOOM_SECRET).update("abc123").digest("hex"), "answers Zoom's address check");

  await sql()`insert into connections (installation_id, provider, label, external_id, access_token_enc, refresh_token_enc, token_expires_at, connected_by)
    values (${inst.id}, 'zoom', 'host@agency.test', 'zoomhost-1', ${encryptSecret("at")}, ${encryptSecret("rt")}, now() + interval '1 hour', 'check')`;
  const summary = (uuid: string, host = "zoomhost-1") => ({
    event: "meeting.summary_completed", event_ts: Date.now(),
    payload: { account_id: "acct", object: { meeting_host_id: host, meeting_host_email: "host@agency.test", meeting_uuid: uuid, meeting_id: 1, meeting_topic: "CONN-ZOOM-CALL", meeting_start_time: "2026-10-30T09:00:00Z",
      summary_content: "## Overview\nAgreed on a $500 plan.", summary_doc_url: "https://docs.zoom.us/doc/xyz", next_steps: ["Send the contract"] } },
  });
  assert.equal((await zoomPost(summary("u-1"), { sign: false })).status, 401, "an unsigned Zoom event is refused");
  assert.equal((await zoomPost(summary("u-1"), { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401, "an old one too");
  const z1 = await zoomPost(summary("u-1"));
  assert.equal(z1.status, 200, JSON.stringify(z1.body));
  assert.equal(z1.body.saved, 0, "Zoom's summary names nobody who is a contact, so there is no account to put it in: it is counted, not saved (N93)");
  assert.equal((await sql()`select count(*)::int n from meeting_notes where installation_id = ${inst.id} and title = 'CONN-ZOOM-CALL'`)[0].n, 0);
  assert.equal((await zoomPost(summary("u-9", "someone-else"))).body.saved, 0, "a host nobody connected is ignored");
  assert.equal((await zoomPost({ event: "meeting.started", payload: {} })).body.ignored, true);
  const zc = (await call("/api/app/connections", { token })).body.connections.find((c: { provider: string }) => c.provider === "zoom");
  assert.equal(zc.saved, 0);
  assert.equal(zc.skipped, 1, "and it is counted");
  assert.equal((await zoomPost({ event: "app_deauthorized", payload: { user_id: "zoomhost-1", account_id: "acct" } })).status, 200);
  assert.equal((await sql()`select count(*)::int n from connections where installation_id = ${inst.id} and provider = 'zoom'`)[0].n, 0, "removing the app in Zoom removes the connection here");

  // --- disconnecting
  const fcon = (await call("/api/app/connections", { token })).body.connections.find((c: { provider: string }) => c.provider === "fathom");
  assert.equal((await call(`/api/app/connections/${fcon.id}`, { token: ct, method: "DELETE" })).status, 403);
  assert.equal((await call(`/api/app/connections/not-an-id`, { token, method: "DELETE" })).status, 404);
  assert.equal((await call(`/api/app/connections/${fcon.id}`, { token, method: "DELETE" })).status, 200);
  assert.deepEqual((await call("/api/app/connections", { token })).body.connections, []);
  assert.equal((await deliver(meeting({ recording_id: "rec-8" }))).status, 404, "after disconnecting, the address stops working");
  const [audit] = await sql()`select count(*)::int n from audit_log where installation_id = ${inst.id} and action like 'connections.%'`;
  assert.ok(audit.n >= 1, "disconnecting is logged");

  await clean();
  await sql()`delete from audit_log where installation_id = ${inst.id} and action like 'connections.%'`;
  await closeDb();
  console.log("connections: sign-in guards, Fathom and Zoom signed deliveries, routing, duplicates, isolation, disconnect: ok");
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
