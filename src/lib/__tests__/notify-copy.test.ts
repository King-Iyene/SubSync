import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOG, NOTIFICATION_TYPES } from "../notifications/catalog.ts";
import { BODY_MAX, checkTemplate, cleanValue, previewCopy, renderCopy, renderTemplate, resolveCopy, sampleValues, TITLE_MAX, VALUE_MAX } from "../notifications/copy.ts";

// The wording editor (N79): live preview, reset to default, and safe variable handling.

test("every default wording is valid for its own kind (a default can never be refused by its own editor)", () => {
  for (const t of NOTIFICATION_TYPES) {
    const info = CATALOG[t];
    assert.deepEqual(checkTemplate(t, "title", info.defaultTitle), { ok: true }, `${t} title`);
    assert.deepEqual(checkTemplate(t, "body", info.defaultBody), { ok: true }, `${t} body`);
  }
});

test("other-alert wording points to the page the notification actually links to", () => {
  assert.match(CATALOG.other_alerts.defaultBody, /linked page/i);
  assert.doesNotMatch(CATALOG.other_alerts.defaultBody, /open alerts/i);
});

test("an unknown variable is rejected, and the answer lists the names that do work", () => {
  const r = checkTemplate("speed_breach", "title", "{account}: {leads} waiting");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /\{leads\} is not a name you can use here/);
  assert.match((r as { error: string }).error, /\{account\}, \{count\}, \{target\}, \{longest\}/);
  // A name that belongs to another kind of message is unknown here too.
  assert.equal(checkTemplate("speed_breach", "title", "{attention_count}").ok, false);
  assert.equal(checkTemplate("daily_brief", "title", "{attention_count} need you").ok, true);
});

test("an unknown variable cannot sneak in through spacing, case or an empty name", () => {
  for (const bad of ["{ account }", "{Account}", "{}", "{account }", "{ACCOUNT}"]) assert.equal(checkTemplate("speed_breach", "title", bad).ok, false, bad);
});

test("a stray brace is refused instead of being shown", () => {
  for (const bad of ["{account", "account}", "{{account}}", "{account}{", "a } b"]) assert.equal(checkTemplate("speed_breach", "title", bad).ok, false, bad);
});

test("plain text only: angle brackets are refused, so no HTML and no Slack mention can be written", () => {
  for (const bad of ["<b>{account}</b>", "{account} <!channel>", "a > b", "<script>alert(1)</script>", "<@U123> {account}", "x <https://evil.example|click>"]) {
    const r = checkTemplate("speed_breach", "title", bad);
    assert.equal(r.ok, false, bad);
    assert.match((r as { error: string }).error, /Plain text only/);
  }
});

test("control characters are refused, a body may have line breaks but a title may not", () => {
  assert.equal(checkTemplate("speed_breach", "title", "line one\nline two").ok, false);
  assert.equal(checkTemplate("speed_breach", "body", "line one\nline two").ok, true);
  assert.equal(checkTemplate("speed_breach", "title", "bell\u0007").ok, false);
  assert.equal(checkTemplate("speed_breach", "body", "null\u0000byte").ok, false);
});

test("length limits and empty values", () => {
  assert.equal(checkTemplate("speed_breach", "title", "x".repeat(TITLE_MAX)).ok, true);
  assert.equal(checkTemplate("speed_breach", "title", "x".repeat(TITLE_MAX + 1)).ok, false);
  assert.equal(checkTemplate("speed_breach", "body", "x".repeat(BODY_MAX + 1)).ok, false);
  assert.equal(checkTemplate("speed_breach", "title", "   ").ok, false, "a title cannot be empty");
  assert.equal(checkTemplate("speed_breach", "body", "").ok, true, "the second line is optional");
  assert.equal(checkTemplate("speed_breach", "title", 42 as unknown as string).ok, false);
});

test("rendering puts the values in, in one pass: a value that looks like a variable is not expanded", () => {
  assert.equal(renderTemplate("{account}: {count} waiting", { account: "Sample Dental", count: 9 }), "Sample Dental: 9 waiting");
  // A customer account called "{count}" or "{account}" stays literal text.
  assert.equal(renderTemplate("{account}: {count} waiting", { account: "{count}", count: 9 }), "{count}: 9 waiting");
  assert.equal(renderTemplate("{account}", { account: "{account}" }), "{account}");
  // A value cannot bring a variable name of another place along either.
  assert.equal(renderTemplate("{a}{b}", { a: "{b", b: "}" }), "{b}");
});

test("values are cleaned: no angle brackets, no line breaks, no control characters, a length limit", () => {
  assert.equal(cleanValue("<b>Dental</b>"), "bDental/b");
  assert.equal(cleanValue("Line\r\nbreak\nhere"), "Line break here");
  assert.equal(cleanValue("a\u0000b\u0007c"), "abc");
  assert.equal(cleanValue(null), "");
  assert.equal(cleanValue(undefined), "");
  assert.equal(cleanValue(12), "12");
  const long = cleanValue("y".repeat(VALUE_MAX * 3));
  assert.ok(long.length <= VALUE_MAX);
  assert.ok(long.endsWith("…"));
  assert.equal(renderTemplate("{account}", { account: "Evil <!channel> Clinic" }), "Evil !channel Clinic");
});

test("a name with no value becomes empty text, and never a leftover {name}", () => {
  assert.equal(renderTemplate("{account}: {longest}", { account: "A" }), "A:");
  assert.equal(renderTemplate("Hello {nobody}", {}), "Hello");
});

test("the live preview shows sample details, and says why an edit cannot be used", () => {
  const ok = previewCopy("speed_breach", { title: "{account} needs a call: {count} leads", body: "Call them." });
  assert.deepEqual(ok, { ok: true, title: "Sample Dental needs a call: 9 leads", body: "Call them." });
  const bad = previewCopy("speed_breach", { title: "{nope}", body: "<i>x</i>" });
  assert.equal(bad.ok, false);
  const errors = (bad as { errors: { title?: string; body?: string } }).errors;
  assert.match(errors.title ?? "", /\{nope\}/);
  assert.match(errors.body ?? "", /Plain text only/);
  assert.deepEqual(sampleValues("speed_breach"), { account: "Sample Dental", count: "9", target: "15", longest: "2 h 10 min" });
});

test("reset to default: no override, or an override that is no longer valid, gives the default wording", () => {
  const d = CATALOG.speed_breach;
  assert.deepEqual(resolveCopy("speed_breach", null), { title: d.defaultTitle, body: d.defaultBody });
  assert.deepEqual(resolveCopy("speed_breach", { title: null, body: null }), { title: d.defaultTitle, body: d.defaultBody });
  // Saved earlier, but the text now has a name that is not allowed (or markup): ignored rather than sent.
  assert.deepEqual(resolveCopy("speed_breach", { title: "{gone}", body: "<b>x</b>" }), { title: d.defaultTitle, body: d.defaultBody });
  assert.deepEqual(resolveCopy("speed_breach", { title: "{account} custom", body: "Own body" }), { title: "{account} custom", body: "Own body" });
  // An empty second line is a choice (no second line), not a missing value.
  assert.equal(resolveCopy("speed_breach", { title: "{account} custom", body: "" }).body, "");
});

test("rendered wording for a real message uses the person's wording and the real values", () => {
  const out = renderCopy("speed_breach", resolveCopy("speed_breach", { title: "CALL NOW: {account} ({count})", body: null }), { account: "Acme Dental", count: 4, target: 15, longest: "40 min" });
  assert.equal(out.title, "CALL NOW: Acme Dental (4)");
  assert.equal(out.body, CATALOG.speed_breach.defaultBody);
});
