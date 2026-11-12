import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deltaTone, deltaWords, heatLevel, heatSentence, HEAT_LEGEND, rateLine, relativeTone, SCALES, scaleWords, toneOf, wordOf } from "../design/status-tone.ts";
import { countsMatch, ladderRows, todoFor, type LadderStep } from "../design/leak-ladder.ts";
import { fetchFathomTranscript, shapeTranscript, transcriptView, unavailable } from "../connections/transcript.ts";

// ---- colour thresholds: green good, ochre watch, red bad, grey no data ----
test("show rate: 80% and up is good, 60 to 79 is watch, under 60 is bad, no data is neutral", () => {
  assert.equal(toneOf(0.8, SCALES.show), "good");
  assert.equal(toneOf(0.95, SCALES.show), "good");
  assert.equal(toneOf(0.79, SCALES.show), "caution");
  assert.equal(toneOf(0.6, SCALES.show), "caution");
  assert.equal(toneOf(0.59, SCALES.show), "bad");
  assert.equal(toneOf(0, SCALES.show), "bad");
  assert.equal(toneOf(null, SCALES.show), "neutral");
  assert.equal(toneOf(Number.NaN, SCALES.show), "neutral");
});
test("no-show and cancel rates read the other way: lower is better", () => {
  assert.equal(toneOf(0.1, SCALES.noShow), "good");
  assert.equal(toneOf(0.2, SCALES.noShow), "caution");
  assert.equal(toneOf(0.31, SCALES.noShow), "bad");
  assert.equal(toneOf(0.05, SCALES.cancel), "good");
  assert.equal(toneOf(0.25, SCALES.cancel), "bad");
  assert.equal(wordOf("bad", SCALES.noShow), "High");
  assert.equal(wordOf("bad", SCALES.show), "Low");
});
test("the legend quotes the same thresholds the colours use, with a word for every tone", () => {
  const w = scaleWords(SCALES.show);
  assert.deepEqual(w.map((x) => x.tone), ["good", "caution", "bad"]);
  assert.equal(w[0].text, "80% and up");
  assert.equal(w[2].text, "under 60%");
  for (const s of Object.values(SCALES)) for (const r of scaleWords(s)) assert.ok(wordOf(r.tone, s).length > 0 && r.text.length > 0);
  assert.equal(rateLine("Show rate", 0.72, SCALES.show), "Show rate 72%: watch");
  assert.equal(rateLine("Show rate", null, SCALES.show), "Show rate: not enough data yet");
});
test("every heat step has a label, the scale only gets greener as the rate rises, and no data has no level", () => {
  assert.equal(HEAT_LEGEND.length, 7);
  assert.ok(HEAT_LEGEND.every((l) => l.label.length > 0));
  const order = { bad: 0, caution: 1, good: 2, neutral: -1 } as const;
  let last = -1;
  for (let r = 0; r <= 100; r += 5) {
    const lv = heatLevel(r / 100);
    assert.ok(lv);
    assert.ok(order[lv.tone] >= last, `rate ${r} must not be redder than the one below it`);
    last = order[lv.tone];
  }
  assert.equal(heatLevel(0.3)?.tone, "bad");
  assert.equal(heatLevel(0.65)?.tone, "caution");
  assert.equal(heatLevel(0.85)?.tone, "good");
  assert.equal(heatLevel(null), null);
  // The heat map and the badge agree on where the colours change.
  for (const r of [0.55, 0.6, 0.75, 0.8, 0.95]) assert.equal(heatLevel(r)?.tone, toneOf(r, SCALES.show));
});
test("the heat map says in plain words which part of the day does better", () => {
  const cells = [
    ...[9, 10, 11].map((hour) => ({ weekday: 1, hour, held: 18, noShow: 2 })), // mornings 90%
    ...[13, 14, 15].map((hour) => ({ weekday: 1, hour, held: 12, noShow: 8 })), // afternoons 60%
  ];
  const s = heatSentence(cells);
  assert.ok(s);
  assert.equal(s.best, "Mornings");
  assert.match(s.text, /^Mornings show up 30 points better than afternoons\.$/);
  assert.equal(heatSentence([{ weekday: 1, hour: 9, held: 3, noShow: 1 }]), null, "too few outcomes: no sentence");
  assert.equal(heatSentence([...[9, 10].map((hour) => ({ weekday: 1, hour, held: 10, noShow: 5 })), ...[14, 15].map((hour) => ({ weekday: 1, hour, held: 10, noShow: 5 }))]), null, "no real gap: no sentence");
});
test("changes are coloured by whether up is good for that rate", () => {
  assert.equal(deltaTone(0.08, true), "good");
  assert.equal(deltaTone(-0.08, true), "bad");
  assert.equal(deltaTone(0.08, false), "bad");
  assert.equal(deltaTone(0.001, true), "neutral");
  assert.equal(deltaTone(null, true), "neutral");
  assert.equal(deltaWords(0.12), "up 12 points");
  assert.equal(deltaWords(-0.01), "down 1 point");
  assert.equal(relativeTone(0.4, 0.3), "good");
  assert.equal(relativeTone(0.2, 0.3), "bad");
  assert.equal(relativeTone(0.32, 0.3), "neutral");
});

// ---- the leak ladder: row maths and count == rows ----
const STEPS: LadderStep[] = [
  { key: "lead", label: "Lead came in", count: 200, passPct: null, lost: 0, dropPct: null, enough: true },
  { key: "answered", label: "First reply", count: 124, passPct: 62, lost: 76, dropPct: 38, enough: true },
  { key: "booked", label: "Booked", count: 50, passPct: 40, lost: 74, dropPct: 60, enough: true },
  { key: "showed", label: "Showed up", count: 35, passPct: 70, lost: 15, dropPct: 30, enough: true },
  { key: "deal", label: "Deal opened", count: 8, passPct: 23, lost: 27, dropPct: 77, enough: true },
  { key: "won", label: "Won", count: 3, passPct: 38, lost: 5, dropPct: 62, enough: false },
];
test("ladder rows keep the server's counts and size each bar against the leads that came in", () => {
  const rows = ladderRows(STEPS, "booked", null);
  assert.ok(countsMatch(rows, STEPS), "the number on a row and the list it opens come from the same step row");
  assert.equal(rows[0].widthPct, 100);
  assert.equal(rows[1].widthPct, 62);
  assert.ok(rows[5].widthPct >= 1.5, "a tiny but real step still shows a sliver");
  assert.equal(rows.filter((r) => r.biggest).length, 1);
  assert.equal(rows[2].biggest, true);
});
test("ladder rows colour the pass rate by the step's own range and grey out a step with too few leads", () => {
  const rows = ladderRows(STEPS, null, null);
  assert.equal(rows[0].tone, "neutral");
  assert.equal(rows[1].tone, "bad", "62% first reply is under 70%");
  assert.equal(rows[2].tone, "good", "40% booked is over 35%");
  assert.equal(rows[3].tone, "caution", "70% showed is between 60 and 79");
  assert.equal(rows[5].tone, "neutral", "not enough leads before the step: grey, never a guess");
  assert.equal(rows[1].lostTone, "bad");
  assert.equal(rows[2].lostTone, "caution", "a good step that still loses leads is a watch, not an alarm");
});
test("each leak has one plain thing to do, with the real count", () => {
  assert.match(todoFor("answered", 76), /^76 leads never got a first reply: open the list/);
  assert.match(todoFor("showed", 1), /^1 lead booked but did not show/);
  assert.equal(todoFor("won", 0), "Nothing lost here.");
  const rows = ladderRows(STEPS, null, null);
  assert.ok(rows[1].todo.includes("76"));
});
test("a step is compared with the period before only when both periods have enough leads", () => {
  const prev: LadderStep[] = STEPS.map((s) => ({ ...s, passPct: s.passPct === null ? null : Math.max(0, s.passPct - 10) }));
  const rows = ladderRows(STEPS, null, prev);
  assert.equal(rows[1].deltaPoints, 10);
  assert.equal(rows[1].deltaTone, "good");
  assert.equal(rows[5].deltaPoints, null, "this step has too few leads to compare");
  assert.equal(ladderRows(STEPS, null, null)[1].deltaPoints, null);
});

// ---- meetings: transcript states and privacy ----
test("a transcript is shaped from the provider's turns and never invented", () => {
  const a = shapeTranscript({ transcript: [{ speaker: { display_name: "Ada" }, text: "  Hello  ", timestamp: "00:01:02" }, { speaker: {}, text: "" }, { text: "Yes" }] });
  assert.equal(a.state, "available");
  if (a.state === "available") { assert.equal(a.lines.length, 2); assert.equal(a.lines[0].speaker, "Ada"); assert.equal(a.lines[0].text, "Hello"); assert.equal(a.lines[1].speaker, "Speaker"); }
  for (const bad of [null, {}, { transcript: "x" }, { transcript: [] }, { transcript: [{ text: "" }] }]) {
    const r = shapeTranscript(bad);
    assert.equal(r.state, "unavailable");
    if (r.state === "unavailable") assert.equal(r.message, "Transcript not available from your meeting tool. It may still be processing, or the recording has none.");
  }
});
test("panel states: loading, lines, plain message when the tool gives none, and an administrator sees no words", () => {
  assert.equal(transcriptView(null, true).kind, "loading");
  const ok = transcriptView({ state: "available", lines: [{ speaker: "Ada", text: "Hi", at: null }], truncated: false }, true);
  assert.equal(ok.kind, "lines"); assert.equal(ok.lines.length, 1);
  const none = transcriptView(unavailable("not_supported"), true);
  assert.equal(none.kind, "message"); assert.equal(none.text, "Transcript not available from your meeting tool.");
  const reconnect = transcriptView(unavailable("reconnect"), true);
  assert.match(reconnect.text ?? "", /^Needs permission: reconnect/);
  const admin = transcriptView({ state: "available", lines: [{ speaker: "Ada", text: "secret words", at: null }], truncated: false }, false);
  assert.equal(admin.kind, "hidden"); assert.deepEqual(admin.lines, []);
  assert.ok(!JSON.stringify(admin).includes("secret words"));
});
test("the transcript is asked for with the person's own token, and a refusal means reconnect", async () => {
  const seen: Array<{ url: string; auth: string | null }> = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") }); return new Response(JSON.stringify({ transcript: [{ speaker: { display_name: "A" }, text: "x" }] }), { status: 200 }); }) as typeof fetch;
  const r = await fetchFathomTranscript("tok", "rec_1", f);
  assert.equal(r.state, "available");
  assert.equal(seen[0].url, "https://api.fathom.ai/external/v1/recordings/rec_1/transcript");
  assert.equal(seen[0].auth, "Bearer tok");
  const refused = (async () => new Response("{}", { status: 403 })) as typeof fetch;
  const d = await fetchFathomTranscript("tok", "rec_1", refused);
  assert.equal(d.state === "unavailable" && d.reason, "reconnect");
  const odd = await fetchFathomTranscript("tok", "../evil", f);
  assert.equal(odd.state, "unavailable");
  assert.equal(seen.length, 1, "a malformed recording id never reaches the provider");
});
test("the transcript route reads only the signed-in person's own call, is not stored and is not an admin route", () => {
  const src = readFileSync(new URL("../api/mn2-routes.ts", import.meta.url), "utf8");
  const at = src.indexOf("async function transcript(");
  assert.ok(at > 0);
  const body = src.slice(at, src.indexOf("async function follow(", at));
  assert.match(body, /owner_ghl_user_id = \$\{person\.userId\}/);
  assert.match(body, /secretRowOf\(person,/, "the person's own connection, never an administrator's");
  assert.ok(!/insert|update meetings|secretRowForAdmin/i.test(body), "nothing is written and no admin lookup is used");
  const detail = readFileSync(new URL("../analytics/mn2-queries.ts", import.meta.url), "utf8");
  assert.ok(!/transcript\s*[,=]/i.test(detail.slice(detail.indexOf("export async function callDetail"), detail.indexOf("export async function exactContacts"))), "the call detail never carries transcript words");
});
