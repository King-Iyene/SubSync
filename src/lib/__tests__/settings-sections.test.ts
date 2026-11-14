import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CONTROL_HOME, describeChange, HISTORY_ACTION, isSectionId, MOVED_INTO_SETTINGS, movedSettingsSection, NUMBER_SETTINGS, SECTION_IDS, SECTIONS, sectionsFor, SETTING_LABEL, SETTINGS_SECTION_KEY } from "../settings-sections.ts";

// N76 and N89: Settings in the eight sections the note names, nothing lost in the move, settings changes audited, numbers recalculated only when they should be.
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

test("the sections of the note, in order, with plain titles", () => {
  assert.deepEqual(SECTIONS.map((s) => s.title), ["Replies", "Brand", "Call queues", "Notifications", "Integrations", "Team", "Data", "Sync status", "Advanced"]);
  assert.equal(new Set(SECTION_IDS).size, 9);
  for (const s of SECTIONS) assert.ok(s.hint.length > 20 && s.hint.length < 120, s.id);
  assert.ok(isSectionId("privacy") && !isSectionId("rules") && !isSectionId(null) && !isSectionId(3));
  assert.equal(SETTINGS_SECTION_KEY, "settings-section");
});

test("who sees which section: an agency and a business see all of them, a client's staff none (Settings is not in their menu and the API refuses it)", () => {
  assert.equal(sectionsFor("agency").length, 9);
  assert.equal(sectionsFor("business").length, 9);
  assert.equal(sectionsFor("client").length, 0);
  assert.match(read("src/lib/access.ts"), /client: new Set\(\[[^\]]*\]\)/);
  assert.doesNotMatch(read("src/lib/access.ts").match(/client: new Set\(\[[^\]]*\]\)/)![0], /"settings"/);
});

test("every control lives in a real section, and the screen draws each section", () => {
  for (const [control, home] of Object.entries(CONTROL_HOME)) assert.ok(SECTION_IDS.includes(home), `${control} -> ${home}`);
  const screen = read("src/app/app/views/settings.tsx");
  for (const id of SECTION_IDS) assert.match(screen, new RegExp(`section === "${id}"`), `Settings draws the ${id} section`);
  // The controls of the old long page are all still there, under their old names.
  for (const label of ["Client access", "Thresholds", "Speed to lead", "Your name on reports", "Links", "Onboarding checklist", "Slack alerts and daily brief", "Meeting notes privacy", "What we store", "Delete my data", "AI assistant connector", "Test and practice accounts", "History of changes"]) {
    assert.ok(screen.includes(label) || read("src/app/app/views/settings-parts.tsx").includes(label), `${label} survived the move`);
  }
  for (const id of ["stale", "dormant", "sla", "speed-target", "speed-open", "speed-close", "inbox-ack-grace", "brand-name", "brand-color", "domain", "custom", "slack", "digest-email", "digest-hour", "digest-zone"]) assert.match(screen, new RegExp(`id="${id}"`), `field ${id}`);
});

test("the two slots other stages fill exist and are in the right sections: Watching is filled (F5), Connections is filled with the connection screens (they moved into Settings, Integrations on 4 Nov 2026)", () => {
  const watching = read("src/app/app/views/settings-slot-watching.tsx");
  const connections = read("src/app/app/views/settings-slot-connections.tsx");
  assert.match(watching, /return <WatchingPanel \/>;/);
  assert.match(connections, /return <IntegrationsContent nested \/>;/);
  assert.match(watching, /watching-panel/);
  const page = read("src/app/app/views/connections.tsx");
  assert.match(page, /id="my-connections"/, "My connections is drawn by the connection screens");
  assert.match(page, /id="team-connections"/, "Team connections is drawn by the connection screens");
  assert.equal(CONTROL_HOME["watching"], "sync");
  assert.equal(CONTROL_HOME["team-connections"], "integrations");
  assert.equal(CONTROL_HOME["my-connections"], "integrations");
  const screen = read("src/app/app/views/settings.tsx");
  assert.ok(screen.indexOf("<WatchingSlot />") < screen.indexOf("<SyncStatusPanel />"), "the watching panel sits above the sync panel");
  assert.ok(screen.indexOf("<ConnectionsSlot />") < screen.indexOf("<PermissionsPanel"), "the connections sit above the permissions list, inside Integrations");
  assert.doesNotMatch(screen, /<Card title="Connections">/, "no pointer card to a separate Connections page is left");
  assert.doesNotMatch(screen, /href="#connections"/, "Settings no longer sends anyone to a Connections menu entry");
});

test("the settings that recalculate numbers are the ones the server recalculates for", () => {
  const router = read("src/lib/api/router.ts");
  const server = new Set([...router.match(/const INSIGHT_SETTINGS = new Set\(\[([^\]]*)\]/)![1].matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]));
  for (const k of NUMBER_SETTINGS) assert.ok(server.has(k), `${k} is recalculated by the server`);
});

test("settings changes are audited by name, never by value, and read back in plain words", () => {
  const router = read("src/lib/api/router.ts");
  assert.match(router, /await logSettingsChange\(ctx\.installationId, actorOf\(ctx\), ctx\.kind, \[\.\.\.Object\.keys\(patch\)/);
  assert.match(router, /await logAccountFlags\(/);
  assert.match(router, /await logKeyChange\(ctx\.installationId, actorOf\(ctx\), ctx\.kind, (true|false)\)/);
  const q = read("src/lib/feedback-queries.ts");
  assert.match(q, /"settings\.changed", \{ keys: keys\.slice\(0, 40\), by: kind \}/, "the detail is key names and the kind of session");
  assert.doesNotMatch(q.slice(q.indexOf("logSettingsChange"), q.indexOf("logAccountFlags")), /patch\.|slackWebhookUrl\)/, "no value is passed to the audit line");
  assert.equal(describeChange("settings.changed", ["slaHours", "slackWebhookUrl", "slaHours"]), "Changed settings: Reply target (hours), Slack channel");
  assert.equal(describeChange("accounts.flags_changed", ["ignored"]), "Changed an account switch: Leave out of every number");
  assert.equal(describeChange("settings.changed", ["somethingNew"]), "Changed settings: a setting");
  assert.equal(describeChange("data.purge_refused", []), "A delete of all data was refused");
  assert.equal(describeChange("unknown.action", []), "Changed something");
  for (const k of NUMBER_SETTINGS) assert.ok(SETTING_LABEL[k], `${k} has a plain name`);
  assert.ok(Object.keys(HISTORY_ACTION).includes("settings.changed"));
  // The history is in Advanced, and only agency and business sessions can ask for it (the client rule list has no settings entry).
  assert.equal(CONTROL_HOME["settings-history"], "advanced");
  assert.doesNotMatch(read("src/lib/access.ts").match(/const CLIENT_RULES[^;]*;/)![0], /"settings"/);
});

test("the test-account switch uses the account switch that already leaves an account out of every number, and does not delete anything", () => {
  const screen = read("src/app/app/views/settings.tsx");
  assert.match(screen, /accounts\/\$\{a\.locationId\}\/flags`, \{ ignored: !a\.ignored \}/);
  const parts = read("src/app/app/views/settings-parts.tsx");
  assert.match(parts, /Nothing is deleted/);
  assert.match(parts, /SubSync only suggests/);
  // The words say what the owner must do: the guess is from the name, the decision is theirs (KF-7: say what only the user can enter).
  assert.match(parts, /You decide/);
  // The server turns the account flag into exclusion everywhere (the queries filter on it), and it is for agency sessions only.
  assert.match(read("src/lib/access.ts"), /if \(a === "accounts" && c === "flags"\) return false;/);
});

test("Connections moved into Settings, Integrations: the old address maps to that section and nothing else moved", () => {
  assert.deepEqual({ ...MOVED_INTO_SETTINGS }, { connections: "integrations" });
  assert.equal(movedSettingsSection("connections"), "integrations");
  assert.equal(movedSettingsSection("settings"), null);
  assert.equal(movedSettingsSection("constructor"), null, "a name from the object prototype is not a moved page");
  assert.equal(movedSettingsSection("toString"), null);
  for (const section of Object.values(MOVED_INTO_SETTINGS)) assert.ok(SECTION_IDS.includes(section), "the target section exists");
});
