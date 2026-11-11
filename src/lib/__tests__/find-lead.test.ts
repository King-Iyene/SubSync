import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanTag } from "../people/writeback.ts";
import { BULK_MAX, EXPORT_HEAD, bulkLine, decodeCursor, encodeCursor, exportCsv, parseBulk, protectedReason } from "../people/find.ts";

const clean = { tag: cleanTag, noteMax: 2000 };
const T = (n: number) => Array.from({ length: n }, (_, i) => ({ locationId: "xtest-loc-a", contactId: `xtest-c-${i + 100}` }));

test("a cursor round-trips and keeps the database's own timestamp text", () => {
  const c = { rk: 2, ra: "2026-11-10 09:30:00.123456+00", rd: "-infinity", loc: "xtest-loc-a", id: "xtest-c-100" };
  assert.deepEqual(decodeCursor(encodeCursor(c)), c);
});

test("a hand-made cursor is refused: wrong shape, odd characters, injected SQL, huge", () => {
  const forge = (a: unknown) => Buffer.from(JSON.stringify(a)).toString("base64url");
  for (const bad of [
    null, undefined, "", "not base64!", "a".repeat(500), forge([1, 2, 3]), forge("x"),
    forge([9, "-infinity", "-infinity", "xtest-a", "xtest-b"]),
    forge([0, "2026-11-10'; select 1 --", "-infinity", "xtest-a", "xtest-b"]),
    forge([0, "-infinity", "-infinity", "a' or '1'='1", "xtest-b"]),
    forge([0, "-infinity", "-infinity", "xtest-a", "x"]),
    forge([1.5, "-infinity", "-infinity", "xtest-a", "xtest-b"]),
  ]) assert.equal(decodeCursor(bad), null, String(bad).slice(0, 30));
});

test("a bulk change names between 1 and 50 valid people and one clear action", () => {
  assert.equal(parseBulk({ action: "tag", tag: "vip", targets: [] }, clean).ok, false);
  assert.equal(parseBulk({ action: "tag", tag: "vip", targets: T(BULK_MAX + 1) }, clean).ok, false);
  assert.equal(parseBulk({ action: "tag", tag: "vip", targets: T(BULK_MAX) }, clean).ok, true);
  assert.equal(parseBulk({ action: "tag", tag: "a,b", targets: T(1) }, clean).ok, false, "a comma would make two tags");
  assert.equal(parseBulk({ action: "note", text: "  ", targets: T(1) }, clean).ok, false);
  assert.equal(parseBulk({ action: "note", text: "x".repeat(2001), targets: T(1) }, clean).ok, false);
  assert.equal(parseBulk({ action: "delete", targets: T(1) }, clean).ok, false, "there is no bulk delete");
  assert.equal(parseBulk({ action: "tag", tag: "vip", targets: [{ locationId: "../x", contactId: "xtest-c-1" }] }, clean).ok, false);
  const same = parseBulk({ action: "tag", tag: "vip", targets: [...T(2), ...T(2)] }, clean);
  assert.ok(same.ok && same.input.targets.length === 2, "the same person twice is one");
});

test("the preview says who is skipped and that nobody is messaged", () => {
  const line = bulkLine("tag", { will: 3, already: 1, notFound: 1, dnd: 2, names: [] }, "vip");
  assert.match(line, /add the tag ‘vip’ to 3 people/);
  assert.match(line, /1 already has it/);
  assert.match(line, /nobody is messaged/);
  assert.match(bulkLine("note", { will: 1, already: 0, notFound: 0, dnd: 0, names: [] }), /add your note to 1 person\./);
});

test("the export file is safe to open in a spreadsheet", () => {
  const csv = exportCsv([
    { name: "=HYPERLINK(\"http://evil\",\"x\")", email: "+a@b.c", phone: "@cmd", accountName: "-Acme", ownerName: "A, B", source: "web\nform", tags: ["x", "y"], dnd: true, dateAdded: "2026-11-01T10:00:00.000Z", lastActivityAt: null },
  ]);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], EXPORT_HEAD.join(","));
  assert.equal(lines.length, 2, "a line break inside a cell never starts a new line");
  const row = lines[1];
  assert.ok(row.startsWith(`"'=HYPERLINK(""http://evil"",""x"")"`), row);
  for (const bad of ["+a@b.c", "@cmd", "-Acme"]) assert.ok(row.includes(`'${bad}`), bad);
  assert.ok(row.includes('"A, B"') && row.includes("x; y") && row.includes(",yes,2026-11-01,"));
});

test("why a person cannot be messaged is one plain line, or nothing", () => {
  assert.equal(protectedReason({ dnd: true, phone: "1", email: null }), "Asked not to be contacted");
  assert.equal(protectedReason({ dnd: false, phone: null, email: null }), "No phone number or email on file");
  assert.equal(protectedReason({ dnd: false, phone: "1", email: null }), null);
});
