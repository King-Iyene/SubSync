import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { clearDraft, draftCount, draftKey, getDraft, putDraft } from "../design/drafts.ts";
import { resultText } from "../design/send-result.ts";
import { properName } from "../people/names.ts";
import { hotkeyIgnored, isEditableTarget } from "../design/ui-logic.ts";

// Typing is never a shortcut (the lead panel closed while a message was being typed, and the words landed in the page's search box).
const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, getAttribute: () => null, closest: () => null, ...extra });

test("text fields, text areas, menus lists, editable blocks and text-box roles are all 'typing'", () => {
  assert.equal(isEditableTarget(el("INPUT")), true);
  assert.equal(isEditableTarget(el("TEXTAREA")), true);
  assert.equal(isEditableTarget(el("SELECT")), true);
  assert.equal(isEditableTarget(el("DIV", { isContentEditable: true })), true);
  assert.equal(isEditableTarget(el("DIV", { getAttribute: (n: string) => (n === "contenteditable" ? "true" : null) })), true);
  assert.equal(isEditableTarget(el("SPAN", { closest: () => ({}) })), true, "a child of a combobox or text box counts");
  assert.equal(isEditableTarget(el("BUTTON")), false);
  assert.equal(isEditableTarget(null), false);
});

test("a shortcut is ignored while typing, with a modifier held, or while an input method is composing", () => {
  assert.equal(hotkeyIgnored({ target: el("TEXTAREA") as never }), true);
  assert.equal(hotkeyIgnored({ target: el("BODY") as never, ctrlKey: true }), true);
  assert.equal(hotkeyIgnored({ target: el("BODY") as never, metaKey: true }), true);
  assert.equal(hotkeyIgnored({ target: el("BODY") as never, isComposing: true }), true);
  assert.equal(hotkeyIgnored({ target: el("BODY") as never }), false);
});

test("a draft is kept per person, survives a refresh, is replaced as typed and cleared when sent", () => {
  const a = draftKey("loc1", "c1"), b = draftKey("loc1", "c2");
  putDraft(a, { text: "Hello", subject: "", channel: "SMS" });
  putDraft(b, { text: "Other person", subject: "Hi", channel: "Email" });
  assert.equal(getDraft(a)?.text, "Hello");
  assert.equal(getDraft(b)?.text, "Other person", "one person's draft never shows on another");
  putDraft(a, { text: "Hello there", subject: "", channel: "SMS" });
  assert.equal(getDraft(a)?.text, "Hello there");
  putDraft(a, { text: "", subject: "", channel: "SMS" });
  assert.equal(getDraft(a), undefined, "an empty box keeps nothing");
  clearDraft(b);
  assert.equal(getDraft(b), undefined);
});

test("the drafts kept in memory are capped", () => {
  for (let i = 0; i < 400; i++) putDraft(draftKey("l", `x${i}`), { text: "t", subject: "", channel: null });
  assert.ok(draftCount() <= 200);
});

test("after a message is handled the panel always says so in plain words", () => {
  assert.match(resultText("message", true), /^Not sent: sending is switched off/);
  assert.match(resultText("message", true, "Nothing was sent."), /^Not sent: sending is switched off/);
  assert.match(resultText("message", true, "Nothing was sent. This is what would have happened.", "To Ann"), /^Not sent:/);
  assert.match(resultText("message", true, "Changes from SubSync are switched off."), /^Not sent: Changes from SubSync are switched off/);
  assert.match(resultText("message", false, undefined, "Text sent to Ann."), /^Sent\. Text sent to Ann\./);
  assert.match(resultText("note", false, undefined, "Note added."), /^Done\./);
  assert.match(resultText("note", true), /^Nothing was sent\./);
});

test("a name stored in lower case only is shown with capitals; a name with any capital is shown as stored", () => {
  assert.equal(properName("test lead one"), "Test Lead One");
  assert.equal(properName("anne-marie o'neil"), "Anne-Marie O'Neil");
  assert.equal(properName("maria de la cruz"), "Maria de la Cruz");
  assert.equal(properName("Test Lead One"), "Test Lead One");
  assert.equal(properName("McDonald"), "McDonald");
  assert.equal(properName("DE LA CRUZ"), "DE LA CRUZ");
  assert.equal(properName("test lead one@x.com"), "Test Lead One@x.com".replace("@x.com", "@x.com"), "an email-like name only gets word capitals");
  assert.equal(properName("12345"), "12345");
  assert.equal(properName(""), "");
  assert.equal(properName(null), "");
});

// ---- source guards ----
const root = join(import.meta.dirname, "..", "..", "app", "app");
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.tsx?$/.test(f)) out.push(p); }
  return out;
}
const files = walk(root).map((p) => ({ p, s: readFileSync(p, "utf8") }));

test("every page-level key handler that acts on a letter, digit or slash skips typing", () => {
  const offenders = files.filter(({ s }) => /addEventListener\(\s*["']keydown["']/.test(s) && /\be\.key === "[a-zA-Z0-9\/]"|key === "[a-zA-Z0-9\/]"|\/\^\[1-9\]\$\/\.test\(e\.key\)|\.key\.toLowerCase\(\)/.test(s)
    && !/hotkeyIgnored|isEditableTarget|isContentEditable/.test(s)).map(({ p }) => p.slice(root.length + 1).replace(/\\/g, "/"));
  // These three only listen for Ctrl or Cmd + Shift + K, or for Escape on the window; their letter keys belong to a row (React onKeyDown), not the page.
  assert.deepEqual(offenders.filter((f) => !["ds/command-palette.tsx", "views/workflows.tsx", "views/ap3/parts.tsx"].includes(f)), []);
});

test("the lead panel's own keys skip typing, and the Open button hands the panel to the page shell so a refreshed list cannot close it", () => {
  const drawer = readFileSync(join(root, "ds", "lead-drawer.tsx"), "utf8");
  assert.match(drawer, /isEditableTarget\(el\)/);
  assert.match(drawer, /draftKey\(seed\.locationId, seed\.contactId\)/, "the message box keeps its draft per person");
  const button = readFileSync(join(root, "ds", "open-lead-button.tsx"), "utf8");
  assert.match(button, /openLeadPanel\(seed, showAccount\)/);
  const dash = readFileSync(join(root, "dashboard.tsx"), "utf8");
  assert.match(dash, /<LeadDrawerHost \/>/);
});

test("the panel's re-reads never cancel each other and never remount the message box", () => {
  const drawer = readFileSync(join(root, "ds", "lead-drawer.tsx"), "utf8");
  assert.match(drawer, /refreshing\.current/);
  assert.doesNotMatch(drawer, /<Composer key=/, "a key on the message box would throw the draft away");
});

test("a refresh of the same search keeps the people on screen", () => {
  const more = readFileSync(join(root, "views", "find-more.tsx"), "utf8");
  assert.match(more, /s\.key === key && s\.rows\.length > 0/);
});
