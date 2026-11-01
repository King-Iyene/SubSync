import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CRM_NOTE_RULE, CRM_WRITE_SUMMARY, crmNoteFootnote, crmNoteState, NEEDS_PERMISSION, NOTE_SCOPE } from "../meeting-wording.ts";
import { GHL_SCOPES } from "../ghl/scopes.ts";

// N77: every screen says the same true thing about writing meeting notes to the CRM. Before this stage the Meeting notes page said SubSync does not write into the
// CRM, while Settings and Connections said it does. The truth, from the code (src/lib/analytics/meeting-crm.ts): a matched contact gets one note, with the
// add-notes permission, if the setting is on; a refusal is stored as "needs permission".
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(process.cwd(), dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(process.cwd(), rel)).isDirectory()) { if (name !== "__tests__") walk(rel, out); } else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

test("the permission the note needs is one the app asks for, and the code really writes a note with it", () => {
  assert.ok((GHL_SCOPES as readonly string[]).includes(NOTE_SCOPE));
  const crm = read("src/lib/analytics/meeting-crm.ts");
  assert.match(crm, /\/contacts\/\$\{encodeURIComponent\(m\.contact_id as string\)\}\/notes/, "it adds a note on the matched contact");
  assert.match(crm, /m\.push_notes_to_crm === false\) return "skipped"/, "and only when the setting is on");
  assert.match(crm, /res\.status === 401 \|\| res\.status === 403/, "a refusal is stored as needs permission");
});

test("no screen says SubSync does not write into the CRM, or that it never changes anything", () => {
  for (const f of walk("src")) {
    const t = read(f);
    assert.doesNotMatch(t, /does not write into your CRM|never writes? (to|into) your CRM|only reads your data/i, `${f}: contradicts what the code does`);
  }
});

test("the screens that talk about notes in the CRM read the same sentences from one place", () => {
  assert.match(read("src/app/app/views/connections.tsx"), /CRM_NOTE_RULE/);
  assert.match(read("src/app/app/views/meetings.tsx"), /crmNoteFootnote/);
  assert.match(read("src/app/app/views/settings.tsx"), /crmNoteState/);
  assert.match(read("src/app/app/views/help.tsx"), /CRM_WRITE_SUMMARY/);
  assert.match(read("src/app/installed/page.tsx"), /CRM_WRITE_SUMMARY/);
  // The data list and the Trust page say the same condition in their own words.
  assert.match(read("src/lib/data-inventory.ts"), /only when SubSync has permission to add notes/);
  assert.match(CRM_NOTE_RULE, /exactly one contact/);
  assert.match(CRM_WRITE_SUMMARY, /exactly one contact/);
  assert.match(CRM_WRITE_SUMMARY, /switch it off in Settings/);
});

test("without the permission the option is disabled and says: Needs permission, reconnect", () => {
  const no = crmNoteState(false, true);
  assert.equal(no.canEnable, false);
  assert.equal(no.tone, "needs_permission");
  assert.ok(no.text.startsWith(NEEDS_PERMISSION), no.text);
  assert.match(no.text, /Meetings are still saved inside SubSync/);
  assert.equal(crmNoteState(false, false).canEnable, false, "off and not permitted: still cannot be switched on");
  const on = crmNoteState(true, true);
  assert.deepEqual([on.canEnable, on.tone], [true, "ok"]);
  const off = crmNoteState(true, false);
  assert.deepEqual([off.canEnable, off.tone], [true, "off"]);
  assert.equal(crmNoteState(null, true).canEnable, true, "not known (the demo): not blocked");
  assert.ok(crmNoteFootnote(false, true).includes(CRM_NOTE_RULE) && crmNoteFootnote(false, true).includes(NEEDS_PERMISSION));
});

test("Settings disables the checkbox from the state, and the server tells it whether the permission was granted", () => {
  const screen = read("src/app/app/views/settings.tsx");
  assert.match(screen, /disabled=\{!note\.canEnable\}/);
  assert.match(screen, /checked=\{form\.pushNotesToCrm && note\.canEnable\}/);
  const router = read("src/lib/api/router.ts");
  assert.match(router, /noteWriteGranted: granted === null \? null : granted\.includes\(NOTE_SCOPE\)/);
  assert.match(router, /noteWriteGranted: ctx\.demo \? null : await installationHasScope\(ctx\.installationId, NOTE_SCOPE\)/);
});
