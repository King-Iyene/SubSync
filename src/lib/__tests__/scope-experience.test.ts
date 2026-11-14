import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { GHL_SCOPES } from "../ghl/scopes.ts";
import { NEEDS_PERMISSION, NOTE_SCOPE } from "../meeting-wording.ts";
import { renderScopesDoc } from "../scope-doc.ts";
import { FEATURE_NEEDS, groupOf, groupStatus, NOT_REQUESTED, parseGranted, permissionPrompt, SCOPE_GROUPS, SCOPE_NAMES } from "../scope-groups.ts";

// N64: every permission the app asks for is justified in plain words, grouped by what it is for; docs/SCOPES.md says the same and cannot drift; and a feature that
// needs an optional permission says the same thing everywhere: "Needs permission: reconnect".
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

test("every permission the install link asks for has a reason, in exactly one group, and nothing else is listed", () => {
  assert.deepEqual([...SCOPE_NAMES].sort(), [...GHL_SCOPES].sort());
  assert.equal(new Set(SCOPE_NAMES).size, SCOPE_NAMES.length, "no permission is listed twice");
  for (const g of SCOPE_GROUPS) for (const s of g.scopes) {
    assert.ok(s.why.length >= 40, `${s.scope}: a real reason, not a label`);
    assert.equal(groupOf(s.scope)?.id, g.id);
    assert.ok(s.kind === (/\.(write|publish|delete|create)$/.test(s.scope) || s.scope === "oauth.write" ? "change" : "read"), `${s.scope}: kind`);
  }
});

test("required and optional match the marketplace listing (7 required, then 73 optional), and every change permission is optional except the platform's own token one", () => {
  const all = SCOPE_GROUPS.flatMap((g) => g.scopes);
  assert.equal(all.filter((s) => s.required).length, 7);
  assert.equal(all.filter((s) => !s.required).length, GHL_SCOPES.length - 7);
  for (const s of all.filter((x) => x.kind === "change" && x.required)) assert.equal(s.scope, "oauth.write", "only the token permission is a required change permission");
  assert.match(read("docs/SCOPE_PLAN.md"), /7 required, 2 optional/);
});

test("docs/SCOPES.md is generated from the list, covers every permission once, and is not stale", () => {
  const doc = read("docs/SCOPES.md").replace(/\r\n/g, "\n");
  assert.equal(doc, renderScopesDoc(), "run: node --import tsx scripts/gen-scopes-doc.ts");
  for (const scope of GHL_SCOPES) assert.equal(doc.split(`| \`${scope}\` |`).length - 1, 1, `${scope} appears once in a table row`);
  for (const n of NOT_REQUESTED) assert.ok(!(GHL_SCOPES as readonly string[]).includes(n.scope), `${n.scope} is said to be not requested, so it must not be requested`);
  assert.match(doc, /Needs permission: reconnect/);
  assert.match(doc, /Not available from the platform yet/);
});

test("the grouped scope explanations N64 names exist: Calls, Team and Email health", () => {
  const titles = SCOPE_GROUPS.map((g) => g.title).join("|");
  assert.match(titles, /calls/i);
  assert.match(titles, /Team/);
  assert.match(read("docs/SCOPES.md"), /## Email health/);
});

test("a feature that needs an optional permission names one that is asked for, and gets the same words everywhere", () => {
  assert.ok(FEATURE_NEEDS.length >= 4);
  for (const f of FEATURE_NEEDS) assert.ok((GHL_SCOPES as readonly string[]).includes(f.scope), `${f.id} -> ${f.scope}`);
  assert.ok(FEATURE_NEEDS.some((f) => f.scope === NOTE_SCOPE), "meeting notes use the add-notes permission the wording module names");
  const granted = parseGranted("locations.readonly contacts.readonly");
  const p = permissionPrompt("speed", granted);
  assert.ok(p);
  assert.equal(p.headline, NEEDS_PERMISSION);
  assert.equal(NEEDS_PERMISSION, "Needs permission: reconnect");
  assert.match(p.detail, /conversations\/message\.readonly/);
  assert.equal(permissionPrompt("speed", parseGranted("conversations/message.readonly")), null, "granted: no prompt");
  assert.equal(permissionPrompt("speed", null), null, "not known (the demo): no prompt");
  assert.equal(permissionPrompt("nothing", []), null);
});

test("the group status marks exactly what an install did not grant, and says nothing is missing when it is not known", () => {
  const some = groupStatus(["contacts.readonly", "locations.readonly"]);
  const missing = some.flatMap((g) => g.scopes).filter((s) => !s.granted).map((s) => s.scope);
  assert.equal(missing.length, GHL_SCOPES.length - 2);
  assert.ok(some.find((g) => g.id === "contacts")!.missing === 1, "contacts.write is missing");
  assert.equal(groupStatus(null).reduce((n, g) => n + g.missing, 0), 0);
  assert.equal(groupStatus([...GHL_SCOPES]).reduce((n, g) => n + g.missing, 0), 0);
  assert.deepEqual(parseGranted("a  b\nc"), ["a", "b", "c"]);
  assert.deepEqual(parseGranted(null), []);
});

test("one wording for a missing permission: no screen says 'Needs approval', and the screens that refuse use the shared words", () => {
  function files(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(join(process.cwd(), dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(process.cwd(), rel)).isDirectory()) { if (name !== "__tests__") files(rel, out); } else if (/\.tsx?$/.test(name)) out.push(rel);
    }
    return out;
  }
  for (const f of files("src/app")) assert.doesNotMatch(read(f), /Needs approval/, `${f}: use "Needs permission: reconnect"`);
  assert.match(read("src/app/app/views/appointments.tsx"), /Needs permission: reconnect/);
  assert.match(read("src/app/app/views/speed.tsx"), /Needs permission: reconnect/);
  assert.match(read("src/app/app/views/settings-parts.tsx"), /NEEDS_PERMISSION/);
});
