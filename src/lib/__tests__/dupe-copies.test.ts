import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PROTECT_WORDS } from "../cleanup/cu-core.ts";
import { DELETE_BLOCKED_WHY, PROTECTED_EXPLAINER, firstReason, protectChips } from "../dq/dupe-copies.ts";

const src = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

test("protection chips name the exact reason and carry the shared words", () => {
  const c = protectChips({ dnd: true, openDeals: 2, openValue: 4500, nextAppointmentAt: "2026-12-24T15:00:00Z" });
  assert.deepEqual(c.map((x) => x.reason), ["dnd", "open_deal", "appointment"]);
  assert.equal(c[0].text, "Do Not Disturb");
  assert.equal(c[1].text, "Open deal $4,500");
  assert.match(c[2].text, /^Appointment on /);
  for (const x of c) assert.equal(x.title, PROTECT_WORDS[x.reason]);
  assert.deepEqual(protectChips({ openDeals: 0, dnd: false }), []);
});

test("the first chip agrees with the shared protected rule", () => {
  for (const f of [{ dnd: true }, { openDeals: 1 }, { nextAppointmentAt: "2026-12-24T15:00:00Z" }, {}]) assert.equal(protectChips(f)[0]?.reason ?? null, firstReason(f));
});

test("explainer words are plain and vendor-free", () => {
  assert.match(PROTECTED_EXPLAINER, /Do Not Disturb, an open deal, or a coming appointment/);
  assert.match(PROTECTED_EXPLAINER, /one at a time/);
  assert.equal(DELETE_BLOCKED_WHY, "Everyone else here is protected");
  assert.doesNotMatch(PROTECTED_EXPLAINER + DELETE_BLOCKED_WHY, /GoHighLevel|HighLevel|GHL/i);
});

test("source guard: copies listed == people, lazy detail, ids kept, no hard-coded colours", () => {
  const ui = src("src/app/app/views/dq/dq-copies.tsx"), row = src("src/app/app/views/dq/dq-dupes.tsx");
  assert.match(ui, /g\.people\.map\(\(lp\)/);
  assert.match(src("src/app/app/views/dq/dq-merge-view.tsx"), /dq\/dupe\?account=/);
  assert.match(ui, /useGroupDetail\(g\)/);
  assert.match(row, /\{show && <CopiesPanel/);
  for (const id of ["dq-dupe-row", "dq-badge", "dq-protected", "dq-merge", "dq-notsame", "dq-delete"]) assert.ok((row + ui).includes(`"${id}"`) || (row + ui).includes(`"${id}`), id);
  assert.match(ui, /OpenLeadButton/);
  assert.match(ui, /Open in your CRM/);
  assert.doesNotMatch(ui, /#[0-9a-fA-F]{3,8}\b|rgb\(|shadow-\[|glow/);
  assert.match(src("src/lib/api/dq-routes.ts"), /PROTECT_WORDS\.appointment : null/);
});
