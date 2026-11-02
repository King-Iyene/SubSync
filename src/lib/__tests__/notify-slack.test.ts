import assert from "node:assert/strict";
import { test } from "node:test";
import { exchangeSlack, authorizeUrl } from "../connections/oauth.ts";
import { PENDING_MS, shownStatus } from "../connections/messages.ts";
import { signState, verifyState } from "../connections/state.ts";
import { classifySlackPost, destinationLabel, eligibleDestinations, postSlackWebhook, shownDestination } from "../notifications/slack.ts";

// The Slack flow against a fake Slack: sign-in result, failures, the 2-minute wait, posting, and which channel may receive what.

process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const KEYS = { clientId: "cid", clientSecret: "csecret" };
const HOOK = "https://hooks.slack.com/services/T000/B000/XXXXXXXX";
const reply = (status: number, body: unknown) => (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

test("'Add to Slack' asks for the smallest scope (one incoming webhook) and says where Slack should return", () => {
  const url = new URL(authorizeUrl("slack", { clientId: "cid", redirectUri: "https://app.example.test/api/integrations/slack/callback", state: "STATE" }));
  assert.equal(url.origin + url.pathname, "https://slack.com/oauth/v2/authorize");
  assert.equal(url.searchParams.get("scope"), "incoming-webhook");
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.example.test/api/integrations/slack/callback");
  assert.equal(url.searchParams.get("state"), "STATE");
});

test("sign-in works: the person picks a channel on Slack's page and Slack hands back its address, which only a Slack address can be", async () => {
  const f = reply(200, { ok: true, team: { name: "Acme" }, incoming_webhook: { url: HOOK, channel: "#sales" } });
  const got = await exchangeSlack("code", KEYS, "https://app.example.test/cb", f);
  assert.deepEqual(got, { ok: true, webhookUrl: HOOK, team: "Acme", channel: "#sales" });
  assert.equal(destinationLabel("Acme", "#sales"), "Acme · #sales");
  assert.equal(destinationLabel(null, null), "Slack channel");
  // An address that is not a Slack address is refused, whatever Slack's answer says.
  const bad = await exchangeSlack("code", KEYS, "https://app.example.test/cb", reply(200, { ok: true, incoming_webhook: { url: "https://evil.example/hook", channel: "#x" } }));
  assert.equal(bad.ok, false);
});

test("sign-in failures become plain words with a code: return address not saved (S-REDIRECT), missing permission (S-SCOPE), anything else (P-AUTH)", async () => {
  const redirect = await exchangeSlack("c", KEYS, "https://app.example.test/cb", reply(200, { ok: false, error: "bad_redirect_uri" }));
  assert.equal(redirect.ok === false && redirect.code, "S-REDIRECT");
  assert.match(redirect.ok === false ? redirect.error : "", /Slack refused the connection\. This is a setup problem on our side, not yours\. Contact us and we will fix it within 24 hours\. Code: S-REDIRECT\./);
  const scope = await exchangeSlack("c", KEYS, "https://app.example.test/cb", reply(200, { ok: false, error: "missing_scope" }));
  assert.equal(scope.ok === false && scope.code, "S-SCOPE");
  assert.match(scope.ok === false ? scope.error : "", /Needs permission: reconnect\./);
  assert.match(scope.ok === false ? scope.error : "", /Code: S-SCOPE|code: S-SCOPE/);
  const other = await exchangeSlack("c", KEYS, "https://app.example.test/cb", reply(200, { ok: false, error: "invalid_code" }));
  assert.equal(other.ok === false && other.code, "P-AUTH");
  assert.equal(other.ok === false && other.providerCode, "invalid_code", "Slack's own code is kept for the log only");
  const down = await exchangeSlack("c", KEYS, "https://app.example.test/cb", (async () => { throw new Error("network"); }) as unknown as typeof fetch);
  assert.equal(down.ok === false && down.code, "P-NET");
});

test("a connect attempt that does not finish gives up after 2 minutes (N92)", () => {
  const since = 1_000_000;
  assert.equal(PENDING_MS, 120_000);
  assert.equal(shownDestination({ status: "pending", pendingSince: since }, since + 119_999), "waiting");
  assert.equal(shownDestination({ status: "pending", pendingSince: since }, since + 120_000), "expired");
  assert.equal(shownDestination({ status: "pending", pendingSince: null }, since), "expired", "a waiting row with no start time never waits forever");
  assert.equal(shownDestination({ status: "connected", pendingSince: null }, since), "connected");
  assert.equal(shownDestination({ status: "needs_reconnect", pendingSince: null }, since), "needs_reconnect");
  assert.equal(shownStatus("pending", since, since + 5_000), "waiting");
});

test("the sign-in's signed state carries the waiting channel, refuses a forged one, and expires", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const token = signState({ provider: "slack", installationId: "inst-1", onlyLocationId: "L1", actor: "Ann", destinationId: id }, 1_000_000);
  const ok = verifyState(token, "slack", 1_000_000 + 60_000);
  assert.equal(ok?.destinationId, id);
  assert.equal(ok?.installationId, "inst-1");
  assert.equal(ok?.onlyLocationId, "L1");
  assert.equal(verifyState(token, "fathom", 1_000_000), null, "not valid for another provider");
  assert.equal(verifyState(token, "slack", 1_000_000 + 11 * 60_000), null, "expired");
  const [body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), installationId: "someone-else" })).toString("base64url");
  assert.equal(verifyState(`${forged}.${sig}`, "slack", 1_000_000), null, "a changed installation breaks the signature");
  // A destination id that is not a uuid is dropped, not trusted.
  const odd = signState({ provider: "slack", installationId: "inst-1", onlyLocationId: null, actor: null, destinationId: "1; drop table" }, 1_000_000);
  assert.equal(verifyState(odd, "slack", 1_000_000)?.destinationId, undefined);
});

test("what Slack's answer to a post means", () => {
  assert.equal(classifySlackPost(200, "ok"), null);
  assert.equal(classifySlackPost(200, " OK \n"), null);
  const gone = classifySlackPost(404, "no_service");
  assert.deepEqual([gone?.code, gone?.permanent, gone?.needsReconnect], ["no_service", true, true]);
  assert.match(gone?.message ?? "", /Connect it again/);
  for (const code of ["channel_is_archived", "channel_not_found", "invalid_token", "token_revoked", "action_prohibited"]) assert.equal(classifySlackPost(400, code)?.needsReconnect, true, code);
  const scope = classifySlackPost(403, "missing_scope");
  assert.deepEqual([scope?.code, scope?.permanent, scope?.needsReconnect, scope?.message], ["missing_scope", true, true, "Needs permission: reconnect."]);
  const rate = classifySlackPost(429, "rate_limited");
  assert.deepEqual([rate?.code, rate?.permanent], ["rate_limited", false]);
  const down = classifySlackPost(503, "<html>");
  assert.deepEqual([down?.permanent, down?.needsReconnect], [false, false]);
  const ours = classifySlackPost(400, "invalid_payload");
  assert.deepEqual([ours?.permanent, ours?.needsReconnect], [true, false]);
  assert.match(ours?.message ?? "", /send us this code: invalid_payload/);
  const weird = classifySlackPost(400, "<script>alert(1)</script> not a code");
  assert.equal(weird?.code, "http_400", "free text from Slack is never shown or stored as a code");
});

test("posting: a good post, a removed channel, a missing permission, Slack down, and an address that is not Slack's (never called)", async () => {
  const seen: Array<{ url: string; body: string }> = [];
  const spy = (status: number, text: string) => (async (url: string, init: RequestInit) => { seen.push({ url, body: String(init.body) }); return new Response(text, { status }); }) as unknown as typeof fetch;
  assert.deepEqual(await postSlackWebhook(HOOK, "hello", spy(200, "ok")), { ok: true });
  assert.deepEqual(seen, [{ url: HOOK, body: JSON.stringify({ text: "hello" }) }]);
  const gone = await postSlackWebhook(HOOK, "hello", spy(404, "no_service"));
  assert.equal(gone.ok === false && gone.needsReconnect, true);
  const scope = await postSlackWebhook(HOOK, "hello", spy(403, "missing_scope"));
  assert.equal(scope.ok === false && scope.message, "Needs permission: reconnect.");
  const down = await postSlackWebhook(HOOK, "hello", (async () => { throw new Error("boom"); }) as unknown as typeof fetch);
  assert.equal(down.ok === false && down.permanent, false);
  seen.length = 0;
  for (const bad of ["https://evil.example/services/x", "http://hooks.slack.com/services/x", "https://hooks.slack.com.evil.example/services/x", "https://hooks.slack.com/other/x", "not a url"]) {
    const r = await postSlackWebhook(bad, "hello", spy(200, "ok"));
    assert.equal(r.ok, false, bad);
  }
  assert.equal(seen.length, 0, "no request was made to any address that is not a Slack channel address");
});

test("which channels may receive a message: connected, chosen, and inside their own account's scope", () => {
  const d = (id: string, locationId: string | null, status = "connected") => ({ id, label: id, locationId, status, pendingSince: null });
  const all = [d("company", null), d("one", "L1"), d("two", "L2"), d("waiting", null, "pending"), d("broken", null, "needs_reconnect")];
  const ids = (x: ReturnType<typeof eligibleDestinations>) => x.map((y) => y.id).sort();
  const chosen = ["company", "one", "two", "waiting", "broken"];
  assert.deepEqual(ids(eligibleDestinations(all, chosen, { locationId: "L1" }, "agency")), ["company", "one"]);
  assert.deepEqual(ids(eligibleDestinations(all, chosen, { locationId: "L2" }, "agency")), ["company", "two"]);
  assert.deepEqual(ids(eligibleDestinations(all, chosen, { locationId: null }, "agency")), ["company"], "a message about no one account never reaches an account's own channel");
  assert.deepEqual(ids(eligibleDestinations(all, chosen, { locationId: "L3" }, "agency")), ["company"], "an account with no channel of its own reaches no other account's channel");
  assert.deepEqual(ids(eligibleDestinations(all, ["one"], { locationId: "L1" }, "agency")), ["one"], "only what was chosen");
  assert.deepEqual(ids(eligibleDestinations(all, [], { locationId: "L1" }, "agency")), []);
  assert.deepEqual(ids(eligibleDestinations(all, chosen, { locationId: null }, "business")), ["company", "one", "two"], "a single business is one account: nothing is limited");
});
