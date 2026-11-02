import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CHANGELOG, PARKED_KEYS, ROADMAP, STATUS_LABEL, STATUS_MEANING, type RoadmapStatus } from "../roadmap.ts";

// N86: the roadmap page must not over-promise. The items match the real roadmap (docs/ROADMAP_V2.md), parked work is only ever "considering", the old promise is gone,
// and one vote per person per item is enforced by the database key.
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const V2 = read("docs/ROADMAP_V2.md");
const STATUSES: RoadmapStatus[] = ["planned", "building", "considering", "shipped"];

test("every item is a real stage of the roadmap, with a status word and a meaning", () => {
  const keys = ROADMAP.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length, "unique keys");
  for (const i of ROADMAP) {
    assert.ok(STATUSES.includes(i.status), i.key);
    assert.match(V2, new RegExp(`\\b${i.stage}\\b`), `${i.key}: stage ${i.stage} is in docs/ROADMAP_V2.md`);
    assert.ok(i.title.length > 8 && i.body.length > 30, i.key);
  }
  for (const s of STATUSES) { assert.ok(STATUS_LABEL[s]); assert.ok(STATUS_MEANING[s].length > 8); }
  assert.deepEqual(STATUSES.map((s) => STATUS_LABEL[s]), ["Planned", "In progress", "Considering", "Shipped"]);
});

test("work the roadmap parks until evidence or cash can only be Considering (or Shipped), never Planned or In progress", () => {
  assert.ok(PARKED_KEYS.length >= 2);
  assert.match(V2, /Parked until evidence or cash/);
  for (const key of PARKED_KEYS) {
    const item = ROADMAP.find((i) => i.key === key);
    assert.ok(item, `${key} is on the page`);
    assert.ok(item.status === "considering" || item.status === "shipped", `${key} is parked: ${item.status}`);
  }
  // The two the note names: benchmarks need many installs, the AI brief is parked.
  assert.equal(ROADMAP.find((i) => i.key === "benchmarks")!.status, "considering");
  assert.equal(ROADMAP.find((i) => i.key === "ai-brief")!.status, "considering");
  assert.match(ROADMAP.find((i) => i.key === "benchmarks")!.body, /many installs/);
});

test("nothing is called In progress unless it is being built, and Shipped items are in the change log", () => {
  assert.equal(ROADMAP.filter((i) => i.status === "building").length, 0, "no item is claimed as being built (update when someone is)");
  const log = CHANGELOG.map((c) => `${c.title} ${c.items.join(" ")}`).join(" ").toLowerCase();
  for (const i of ROADMAP.filter((x) => x.status === "shipped")) assert.ok(log.includes(i.title.toLowerCase().split(" ")[0]) || log.includes(i.key.replace(/-/g, " ")), `${i.key} appears in the change log`);
});

test("the old promise is gone and the new line is on the page", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(join(process.cwd(), dir))) { const rel = `${dir}/${name}`; if (statSync(join(process.cwd(), rel)).isDirectory()) { if (name !== "__tests__") walk(rel, out); } else if (/\.tsx?$/.test(name)) out.push(rel); }
    return out;
  }
  for (const f of walk("src")) assert.doesNotMatch(read(f), /We build in the order people ask/, `${f}: the old promise`);
  assert.match(read("src/app/app/views/roadmap.tsx"), /Votes help us decide what to build next/);
  assert.match(read("src/app/app/views/roadmap.tsx"), /Suggest something/);
});

test("the change log is newest first and says what changed in plain words", () => {
  const dates = CHANGELOG.map((c) => c.date);
  assert.deepEqual([...dates].sort().reverse(), dates);
  assert.match(CHANGELOG[0].date, /^2026-11-0\d$/);
  for (const c of CHANGELOG) { assert.ok(c.items.length > 0); for (const t of c.items) assert.ok(t.length > 20, t); }
});

test("one vote per person per item is the database's own rule, a shipped item cannot be voted for, and a vote can be taken back", () => {
  assert.match(read("supabase/migrations/20261031110000_roadmap_votes.sql"), /primary key \(installation_id, item_key, voter\)/);
  const router = read("src/lib/api/router.ts");
  assert.match(router, /item\.status === "shipped"\) return json\(\{ error: "That one is already live/);
  assert.match(router, /delete from roadmap_votes where installation_id = \$\{ctx\.installationId\} and item_key = \$\{item\.key\} and voter = \$\{voter\}/);
  assert.match(router, /on conflict do nothing/);
});

test("suggestions: stored per company, only the person's own are read back in the app, and King reads them through the secret-only admin address", () => {
  const q = read("src/lib/feedback-queries.ts");
  assert.match(q, /from roadmap_suggestions where installation_id = \$\{installationId\} and who = \$\{who\}/);
  assert.match(read("src/app/api/admin/feedback/route.ts"), /Bearer \$\{secret\}/);
  assert.match(read("supabase/migrations/20261102090000_f8_feedback.sql"), /enable row level security/);
});
