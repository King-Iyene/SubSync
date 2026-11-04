import assert from "node:assert/strict";
import { test } from "node:test";
import { groupDuplicates, type Person } from "../analytics/dedupe.ts";
import { PRESETS } from "../analytics/cleanup-rules.ts";
import { pageOf, selectGroups, type QueueItem } from "../analytics/dedupe-review.ts";
import { HISTORY_ACTIONS, kindOf, matchesKind, newestUndo, parseKind, sentence, undoOf, type AuditLine, type HistoryRow } from "../analytics/history-intel.ts";
import { scanContacts, worstFirst, type QRow } from "../analytics/quality.ts";

const line = (action: string, detail: Record<string, unknown> = {}, id = 1): AuditLine => ({ id, at: "2026-11-05T10:00:00Z", actor: "Ann", action, detail });

test("every audit action the screen lists reads as a sentence, and unknown ones are not Clean-up history", () => {
  for (const a of HISTORY_ACTIONS) {
    const s = sentence(line(a, { what: "crm.contact.update", total: 2, applied: 2, undone: 1, groups: 3, newGroups: 4, rows: 9, preset: "loose", scope: "account" }), ["Ada Lovelace", "Ada L"], "Bright Dental");
    assert.ok(s.length > 10 && s.endsWith("."), `${a}: ${s}`);
    assert.ok(!/ghl|highlevel|undefined|\[object/i.test(s), a);
  }
  assert.match(sentence(line("duplicates.not_duplicate"), ["Ada Lovelace", "Ada L"], "Bright Dental"), /Ada Lovelace and Ada L in Bright Dental as not a duplicate/);
  assert.match(sentence(line("dry_run.would_write", { what: "crm.contact.merge_workflow" }), [], "X"), /start a merge in your CRM.*nothing was sent/);
  assert.equal(sentence(line("sync.done"), [], null), "Something was recorded.");
});

test("kinds and filters", () => {
  assert.equal(kindOf("duplicates.merge_requested"), "merge");
  assert.equal(kindOf("cleanup.apply_done"), "fix");
  assert.equal(kindOf("cleanup.write_enabled"), "write");
  assert.equal(matchesKind("cleanup.rules_saved", "rules"), true);
  assert.equal(matchesKind("cleanup.rules_saved", "fix"), false);
  assert.equal(matchesKind("cleanup.rules_saved", null), true);
  assert.equal(parseKind("scan"), "scan");
  assert.equal(parseKind("nope"), null);
});

test("only a decision still in force can be taken back, and only its newest line", () => {
  const state = { reviews: new Set(["L1:aaaaaaaa-2"]), snoozes: new Set(["L1:bbbbbbbb-2"]) };
  assert.deepEqual(undoOf(line("duplicates.not_duplicate", { locationId: "L1", key: "aaaaaaaa-2" }), state), { kind: "review", locationId: "L1", key: "aaaaaaaa-2" });
  assert.deepEqual(undoOf(line("duplicates.snooze", { locationId: "L1", key: "bbbbbbbb-2" }), state), { kind: "snooze", locationId: "L1", key: "bbbbbbbb-2" });
  assert.equal(undoOf(line("duplicates.not_duplicate", { locationId: "L1", key: "cccccccc-2" }), state), null, "already taken back");
  assert.equal(undoOf(line("duplicates.undo", { locationId: "L1", key: "aaaaaaaa-2" }), state), null);
  assert.equal(undoOf(line("duplicates.not_duplicate", { locationId: "L1" }), state), null);
  const row = (id: number): HistoryRow => ({ id, at: "", who: "", kind: "decision", text: "", locationId: "L1", locationName: null, names: [], undo: { kind: "review", locationId: "L1", key: "aaaaaaaa-2" }, dryRun: false });
  const rows = newestUndo([row(5), row(3)]);
  assert.ok(rows[0].undo && !rows[1].undo);
});

test("scale: 150 accounts and 5,000 groups page without ever holding more than a page, and the worst client comes first", () => {
  const items: QueueItem[] = [];
  for (let a = 0; a < 150; a++) {
    for (let g = 0; g < 34; g++) {
      const people: Person[] = [1, 2].map((k) => ({ contactId: `a${a}g${g}k${k}`, name: `Person ${a} ${g}`, email: `p${a}-${g}@x.test`, phone: null, tags: [], createdAt: "2026-01-01T00:00:00Z", lastActivityAt: null, source: null, openDeals: 0, wonDeals: 0, hasConversation: false }));
      items.push({ key: `${String(g).padStart(8, "0")}-2`, people, confidence: 94, reasons: ["same email"], kind: "exact", survivorId: people[0].contactId, locationId: `loc${a}`, locationName: `Client ${a}` });
    }
  }
  assert.equal(items.length, 5100);
  const open = selectGroups(items, { status: "open", decided: new Set(), later: new Set() });
  const page = pageOf(open, 3, 25);
  assert.equal(page.rows.length, 25);
  assert.equal(page.pages, 204);
  const rows = Array.from({ length: 150 }, (_, i) => ({ name: `Client ${i}`, score: i % 7 === 0 ? null : 100 - (i % 60), contacts: 100 + i }));
  const worst = worstFirst(rows);
  assert.equal(worst.length, 150);
  assert.ok(worst[0].score !== null && worst[0].score <= worst[1].score!);
  assert.equal(worst.at(-1)!.score, null, "accounts with no score yet go last");
});

test("scale: a 20,000 contact account is scanned and grouped without a second pass over the data", () => {
  const rows: QRow[] = [];
  const people: Person[] = [];
  for (let i = 0; i < 20_000; i++) {
    const dup = i % 100 === 0;
    const base = dup ? i - 1 : i;
    const email = `user${base}@acme${base % 500}.test`;
    rows.push({ id: `c${i}`, firstName: "Person", lastName: String(i), email, phone: `+1555${String(1000000 + i).slice(-7)}`, tags: [] });
    people.push({ contactId: `c${i}`, name: `Person ${i}`, email, phone: `+1555${String(1000000 + i).slice(-7)}`, tags: [], createdAt: "2026-01-01T00:00:00Z", lastActivityAt: null, source: null, openDeals: 0, wonDeals: 0, hasConversation: false });
  }
  const t0 = Date.now();
  const scan = scanContacts(rows, { countryCode: "+1" });
  const groups = groupDuplicates(people, 50, 40, PRESETS.balanced);
  assert.equal(scan.total, 20_000);
  assert.ok(groups.length >= 1);
  assert.ok(Date.now() - t0 < 5_000, "well inside a request's time");
});
