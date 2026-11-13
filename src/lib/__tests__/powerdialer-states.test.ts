import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ACCOUNTS_ERROR_TEXT, CALL_MODE_BUTTON, CHECKING_TEXT, NO_ACCOUNTS_TEXT, emptyBatchText } from "../dial/powerdialer.ts";

// "Start calling" never ends in a silent click: every state it can reach (checking, no accounts, accounts failed, setup needed, nobody to call, preview, result, error) renders words.
const ui = readFileSync(new URL("../../app/app/views/power-dialer.tsx", import.meta.url), "utf8");

test("the empty batch says so, and points to Call mode when there is one", () => {
  assert.equal(emptyBatchText(true), "Nobody to call right now: no lead is waiting. Pick a list in Call mode.");
  assert.match(emptyBatchText(false), /^Nobody to call right now/);
  for (const t of [CHECKING_TEXT, NO_ACCOUNTS_TEXT, ACCOUNTS_ERROR_TEXT, CALL_MODE_BUTTON, emptyBatchText(true), emptyBatchText(false)]) assert.ok(t.trim().length > 8);
});

test("source guard: each result state of the power-dialer path has a rendered text", () => {
  for (const id of ["pd-checking", "pd-msg", "pd-setup", "pd-preview", "pd-none", "pd-empty", "pd-empty-text", "pd-empty-callmode", "pd-result", "pd-undo-msg", "start-calling-note"]) assert.ok(ui.includes(`data-testid="${id}"`), id);
  assert.match(ui, /\{emptyBatchText\(!!o\.onCallMode\)\}/);
  assert.match(ui, /\{CHECKING_TEXT\}/);
  assert.match(ui, /setMsg\(NO_ACCOUNTS_TEXT\)/, "no accounts at all is said after the click");
  assert.match(ui, /\{note && <p[^>]*data-testid="start-calling-note"/);
  assert.match(ui, /setReview\(nobody \? null : out\)/, "an all-empty batch is shown as the empty message, not a blank preview");
  // the failure paths of start() and confirm() set a message
  assert.match(ui, /catch \{ setMsg\("Could not check the call queue right now\. Nothing was sent\."\); \}/);
  assert.match(ui, /setMsg\("Could not add to the call queue\. Nothing more was sent\."\)/);
  // the hook's own panel is what the button renders next to itself
  assert.match(ui, /\{pd\.panel\}/);
  // the button is only ever disabled while something is loading or running (which has its own words), never for lack of accounts
  assert.match(ui, /disabled=\{pd\.busy \|\| loaded === "loading"\}/);
  assert.doesNotMatch(ui, /disabled=\{pd\.busy \|\| accounts\.length === 0\}/);
});
