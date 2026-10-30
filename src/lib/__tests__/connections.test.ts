import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  attendeesFromZoom, authorizeUrl, createFathomWebhook, deleteFathomWebhook, exchangeCode, exchangeSlack, fetchZoomParticipants, fetchZoomUser, keysFor, redirectUri,
  refreshTokens, zoomUuidPath,
} from "../connections/oauth.ts";
import { chooseAccount } from "../connections/routing.ts";
import { verifyFathom, verifyZoom, zoomChallenge } from "../connections/signatures.ts";
import { signState, verifyState } from "../connections/state.ts";
import { parseZoomSummary } from "../connections/zoom-summary.ts";

process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const NOW = Date.parse("2026-10-30T12:00:00Z");
const nowS = String(Math.floor(NOW / 1000));

// A pretend provider: records what was sent and answers with a canned reply.
const fake = (status: number, body: unknown, seen: Array<{ url: string; init: RequestInit }> = []) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return new Response(body === "" ? null : typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;

test("Fathom signatures: valid, tampered, stale, and a rotated list", () => {
  const raw = Buffer.from("a-very-secret-key-value-1234567890").toString("base64");
  const secret = `whsec_${raw}`;
  const body = '{"title":"QBR"}';
  const sig = (id: string, ts: string, b: string) => createHmac("sha256", Buffer.from(raw, "base64")).update(`${id}.${ts}.${b}`).digest("base64");
  const ok = { secret, id: "msg_1", timestamp: nowS, signature: `v1,${sig("msg_1", nowS, body)}`, body, now: NOW };
  assert.equal(verifyFathom(ok), true);
  assert.equal(verifyFathom({ ...ok, body: '{"title":"changed"}' }), false, "a changed body fails");
  assert.equal(verifyFathom({ ...ok, id: "msg_2" }), false, "a different message id fails");
  assert.equal(verifyFathom({ ...ok, secret: `whsec_${Buffer.from("another-secret").toString("base64")}` }), false);
  assert.equal(verifyFathom({ ...ok, now: NOW + 6 * 60_000 }), false, "older than five minutes is refused even when signed");
  assert.equal(verifyFathom({ ...ok, signature: `v1,AAAA v2,${sig("msg_1", nowS, body)}` }), true, "any entry in the list may match");
  assert.equal(verifyFathom({ ...ok, signature: null }), false);
  assert.equal(verifyFathom({ ...ok, timestamp: "abc" }), false);
  assert.equal(verifyFathom({ ...ok, secret: "" }), false);
});

test("Zoom signatures and the notification-address challenge", () => {
  const secret = "zoom-secret-token";
  const body = '{"event":"meeting.summary_completed"}';
  const sig = "v0=" + createHmac("sha256", secret).update(`v0:${nowS}:${body}`).digest("hex");
  assert.equal(verifyZoom({ secretToken: secret, timestamp: nowS, signature: sig, body, now: NOW }), true);
  assert.equal(verifyZoom({ secretToken: secret, timestamp: nowS, signature: sig, body: body + " ", now: NOW }), false);
  assert.equal(verifyZoom({ secretToken: "other", timestamp: nowS, signature: sig, body, now: NOW }), false);
  assert.equal(verifyZoom({ secretToken: secret, timestamp: nowS, signature: sig, body, now: NOW + 10 * 60_000 }), false);
  assert.equal(verifyZoom({ secretToken: secret, timestamp: nowS, signature: "v0=short", body, now: NOW }), false);
  const c = zoomChallenge("abc123", secret);
  assert.equal(c.plainToken, "abc123");
  assert.equal(c.encryptedToken, createHmac("sha256", secret).update("abc123").digest("hex"));
});

test("the sign-in state is signed, expires, and only works for its own provider", () => {
  const s = { provider: "fathom" as const, installationId: "inst-1", onlyLocationId: "loc-1", actor: "Sam" };
  const token = signState(s, NOW);
  assert.deepEqual(verifyState(token, "fathom", NOW + 60_000), s);
  assert.equal(verifyState(token, "zoom", NOW + 60_000), null, "a Fathom state cannot finish a Zoom sign-in");
  assert.equal(verifyState(token, "fathom", NOW + 11 * 60_000), null, "ten minutes is the limit");
  const [body, mac] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...s, installationId: "inst-2", exp: Math.floor(NOW / 1000) + 600 })).toString("base64url");
  assert.equal(verifyState(`${forged}.${mac}`, "fathom", NOW), null, "changing the install breaks the signature");
  assert.equal(verifyState(`${body}.`, "fathom", NOW), null);
  assert.equal(verifyState(null, "fathom", NOW), null);
});

test("a provider is only on when its keys are set", () => {
  assert.equal(keysFor("slack", {}), null);
  assert.deepEqual(keysFor("slack", { SLACK_CLIENT_ID: "a", SLACK_CLIENT_SECRET: "b" }), { clientId: "a", clientSecret: "b" });
  assert.equal(keysFor("zoom", { ZOOM_CLIENT_ID: "a", ZOOM_CLIENT_SECRET: "b" }), null, "Zoom also needs its secret token for notifications");
  assert.ok(keysFor("zoom", { ZOOM_CLIENT_ID: "a", ZOOM_CLIENT_SECRET: "b", ZOOM_WEBHOOK_SECRET_TOKEN: "c" }));
});

test("sign-in links go to the right provider with the state attached", () => {
  const r = redirectUri("https://subsync.example.com/", "slack");
  assert.equal(r, "https://subsync.example.com/api/integrations/slack/callback");
  const slack = new URL(authorizeUrl("slack", { clientId: "cid", redirectUri: r, state: "st" }));
  assert.equal(slack.origin + slack.pathname, "https://slack.com/oauth/v2/authorize");
  assert.equal(slack.searchParams.get("scope"), "incoming-webhook");
  assert.equal(slack.searchParams.get("state"), "st");
  const fathom = new URL(authorizeUrl("fathom", { clientId: "cid", redirectUri: r, state: "st" }));
  assert.equal(fathom.origin + fathom.pathname, "https://fathom.video/external/v1/oauth2/authorize");
  assert.equal(fathom.searchParams.get("scope"), "public_api");
  assert.equal(fathom.searchParams.get("response_type"), "code");
  const zoom = new URL(authorizeUrl("zoom", { clientId: "cid", redirectUri: r, state: "st" }));
  assert.equal(zoom.origin + zoom.pathname, "https://zoom.us/oauth/authorize");
  assert.equal(zoom.searchParams.get("response_type"), "code");
});

test("Slack hands back a channel address; anything else is refused", async () => {
  const keys = { clientId: "cid", clientSecret: "sec" };
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const good = await exchangeSlack("code1", keys, "https://x/cb", fake(200, { ok: true, team: { name: "Acme" }, incoming_webhook: { url: "https://hooks.slack.com/services/T0/B0/xyz", channel: "#reports" } }, seen));
  assert.deepEqual(good, { ok: true, webhookUrl: "https://hooks.slack.com/services/T0/B0/xyz", team: "Acme", channel: "#reports" });
  assert.match(String(seen[0].init.body), /code=code1/);
  assert.equal((await exchangeSlack("c", keys, "https://x/cb", fake(200, { ok: false, error: "invalid_code" }))).ok, false);
  assert.equal((await exchangeSlack("c", keys, "https://x/cb", fake(200, { ok: true, incoming_webhook: { url: "https://evil.example.com/hook" } }))).ok, false, "only a Slack address is accepted");
  assert.equal((await exchangeSlack("c", keys, "https://x/cb", fake(200, { ok: true }))).ok, false, "no channel chosen");
  const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  assert.equal((await exchangeSlack("c", keys, "https://x/cb", down)).ok, false);
});

test("Fathom and Zoom token exchange and refresh send the right things", async () => {
  const keys = { clientId: "cid", clientSecret: "sec" };
  const reply = { access_token: "AT", refresh_token: "RT", expires_in: 3600 };
  const f1: Array<{ url: string; init: RequestInit }> = [];
  const fathom = await exchangeCode("fathom", "code9", keys, "https://x/cb", fake(200, reply, f1), NOW);
  assert.deepEqual(fathom, { ok: true, tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: NOW + 3_600_000 } });
  assert.equal(f1[0].url, "https://fathom.video/external/v1/oauth2/token");
  const fb = new URLSearchParams(String(f1[0].init.body));
  assert.equal(fb.get("grant_type"), "authorization_code");
  assert.equal(fb.get("client_secret"), "sec", "Fathom takes the keys in the form");

  const f2: Array<{ url: string; init: RequestInit }> = [];
  const zoom = await refreshTokens("zoom", "OLD", keys, fake(200, reply, f2), NOW);
  assert.equal(zoom.ok, true);
  assert.equal(f2[0].url, "https://zoom.us/oauth/token");
  const headers = f2[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Basic " + Buffer.from("cid:sec").toString("base64"), "Zoom takes the keys in a Basic header");
  const zb = new URLSearchParams(String(f2[0].init.body));
  assert.equal(zb.get("grant_type"), "refresh_token");
  assert.equal(zb.get("refresh_token"), "OLD");
  assert.equal(zb.get("client_secret"), null, "never in the body for Zoom");

  assert.equal((await exchangeCode("zoom", "c", keys, "https://x/cb", fake(400, { error: "invalid_grant" }))).ok, false);
  assert.equal((await exchangeCode("fathom", "c", keys, "https://x/cb", fake(200, { access_token: "only" }))).ok, false, "both tokens are needed");
  const refused = await exchangeCode("zoom", "c", keys, "https://x/cb", fake(400, { error: "bad", access_token: "SHOULD-NOT-LEAK" }));
  assert.ok(!JSON.stringify(refused).includes("SHOULD-NOT-LEAK"));
});

test("SubSync registers its own Fathom webhook, asking for the summary but not the transcript", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const made = await createFathomWebhook("AT", "https://subsync.example.com/api/hooks/fathom/key1", fake(201, { id: "wh_1", secret: "whsec_abc" }, seen));
  assert.deepEqual(made, { ok: true, id: "wh_1", secret: "whsec_abc" });
  assert.equal(seen[0].url, "https://api.fathom.ai/external/v1/webhooks");
  assert.equal((seen[0].init.headers as Record<string, string>).authorization, "Bearer AT");
  const sent = JSON.parse(String(seen[0].init.body));
  assert.equal(sent.destination_url, "https://subsync.example.com/api/hooks/fathom/key1");
  assert.equal(sent.include_summary, true);
  assert.equal(sent.include_action_items, true);
  assert.equal(sent.include_transcript, false);
  assert.ok(sent.triggered_for.length >= 1);
  assert.equal((await createFathomWebhook("AT", "https://x", fake(401, {}))).ok, false);
  assert.equal(await deleteFathomWebhook("AT", "wh 1", fake(204, "", seen)), true);
  assert.equal(seen[1].url, "https://api.fathom.ai/external/v1/webhooks/wh%201");
});

test("Zoom: who signed in, and who joined (the host and blank emails are left out)", async () => {
  const me = await fetchZoomUser("AT", fake(200, { id: "u123", email: "Host@Agency.com" }));
  assert.deepEqual(me, { ok: true, id: "u123", email: "host@agency.com" });
  assert.equal((await fetchZoomUser("AT", fake(401, {}))).ok, false);
  const roster = { participants: [{ name: "Host", user_email: "host@agency.com" }, { name: "Dana Lee", user_email: "Dana@Client.com" }, { name: "Dana Lee", user_email: "dana@client.com" }, { name: "Guest", user_email: "" }] };
  assert.deepEqual(attendeesFromZoom(roster, "host@agency.com"), [{ name: "Dana Lee", email: "dana@client.com" }, { name: "Guest", email: null }]);
  const seen: Array<{ url: string; init: RequestInit }> = [];
  assert.equal((await fetchZoomParticipants("AT", "/ab//cd==", "host@agency.com", fake(200, roster, seen))).length, 2);
  assert.match(seen[0].url, /past_meetings\/%252Fab%252F%252Fcd%253D%253D\/participants/, "a meeting id with slashes is encoded twice");
  assert.deepEqual(await fetchZoomParticipants("AT", "plain", null, fake(403, {})), [], "when Zoom refuses, there are simply no attendees");
  assert.equal(zoomUuidPath("abc=="), "abc%3D%3D");
});

test("a Zoom AI summary becomes a meeting note", () => {
  const body = {
    event: "meeting.summary_completed", event_ts: 1,
    payload: { account_id: "A1", object: {
      meeting_host_id: "u123", meeting_host_email: "Host@Agency.com", meeting_uuid: "uuid-1", meeting_topic: "Kitchen consult", meeting_start_time: "2026-10-30T10:00:00Z",
      summary_content: "## Overview\nDana wants a quote by Friday.", summary_doc_url: "https://docs.zoom.us/doc/abc", next_steps: ["Send the quote", "  ", "Book a site visit"],
    } },
  };
  const parsed = parseZoomSummary(body, [{ name: "Dana", email: "dana@client.com" }]);
  assert.equal(parsed?.hostId, "u123");
  assert.equal(parsed?.hostEmail, "host@agency.com");
  assert.equal(parsed?.uuid, "uuid-1");
  assert.equal(parsed?.meeting.source, "zoom");
  assert.equal(parsed?.meeting.title, "Kitchen consult");
  assert.match(parsed?.meeting.summary ?? "", /quote by Friday/);
  assert.deepEqual(parsed?.meeting.actionItems, ["Send the quote", "Book a site visit"]);
  assert.equal(parsed?.meeting.transcript, null);
  assert.equal(parsed?.meeting.recordingUrl, "https://docs.zoom.us/doc/abc");
  // older shape: overview + sections
  const legacy = parseZoomSummary({ event: "meeting.summary_completed", payload: { object: { meeting_host_id: "u1", meeting_uuid: "x", summary_overview: "Quick call.", summary_details: [{ label: "Pricing", summary: "Agreed on $500." }] } } });
  assert.match(legacy?.meeting.summary ?? "", /Quick call\.\n\nPricing: Agreed on \$500\./);
  // other events and empty summaries are ignored
  assert.equal(parseZoomSummary({ event: "meeting.started", payload: {} }), null);
  assert.equal(parseZoomSummary({ event: "meeting.summary_completed", payload: { object: { meeting_host_id: "u1", meeting_uuid: "x" } } }), null);
  assert.equal(parseZoomSummary("nope"), null);
});

test("a meeting goes to the account that knows the most attendees, never a guess", () => {
  const known = [
    { locationId: "B", email: "dana@client.com" }, { locationId: "A", email: "dana@client.com" }, { locationId: "A", email: "lee@client.com" }, { locationId: "C", email: "other@x.com" },
  ];
  const at = [{ name: null, email: "Dana@Client.com" }, { name: null, email: "lee@client.com" }];
  assert.deepEqual(chooseAccount(at, known, null), { locationId: "A", how: "matched" }, "A knows both attendees");
  assert.deepEqual(chooseAccount([at[0]], known, null), { locationId: "A", how: "matched" }, "a tie goes to the same account every time");
  assert.deepEqual(chooseAccount([{ name: "Stranger", email: "x@nowhere.com" }], known, "C"), { locationId: "C", how: "chosen" }, "no match: the account the person chose");
  assert.equal(chooseAccount([{ name: "Stranger", email: null }], known, null), null, "no match and no choice: not saved");
  assert.deepEqual(chooseAccount(at, known, null, "C"), { locationId: "C", how: "chosen" }, "a single business never leaves its own account");
  assert.deepEqual(chooseAccount(at, known, null, "B"), { locationId: "B", how: "matched" });
});
