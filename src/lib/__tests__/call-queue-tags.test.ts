import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { duplicateTags, previewChange, QUEUES, resolveTags, validateTag } from "../call-queue-tags/tags.ts";
import { guideRowState, judgeSetup, NEEDS_PERMISSION } from "../call-queue-tags/check.ts";
import { snapshotUrlFrom, snapshotVisible } from "../call-queue-tags/snapshot.ts";
import { routeAllowed } from "../access.ts";
import { buildSteps, type Facts } from "../getting-started.ts";
import { CONCEPT_GUIDES } from "../concept-guides.ts";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

test("a tag name must be plain: not empty, at most 60 characters, no commas", () => {
  assert.equal(validateTag("  Hot  lead ").ok && (validateTag("  Hot  lead ") as { tag: string }).tag, "Hot lead");
  for (const bad of ["", "   ", "a,b", "x".repeat(61), null, 5, "<b>"]) assert.equal(validateTag(bad).ok, false, String(bad));
  assert.equal(validateTag("x".repeat(60)).ok, true);
});

test("every queue falls back to its default; an own name wins; the earlier call-now tag is kept", () => {
  const d = resolveTags({});
  assert.deepEqual(Object.values(d), QUEUES.map((q) => q.defaultTag));
  assert.equal(resolveTags({ no_show: "missed-appt" }).no_show, "missed-appt");
  assert.equal(resolveTags({}, "subsync-call-now").call_now, "subsync-call-now");
  assert.equal(resolveTags({ call_now: "mine" }, "subsync-call-now").call_now, "mine");
  assert.equal(resolveTags({ call_now: "bad,tag" }).call_now, "call-now", "a stored value that is not valid is ignored");
});

test("the preview says what will change, line by line, and nothing is saved by it", () => {
  const cur = resolveTags({});
  const p = previewChange(cur, { call_now: "dial-me", no_show: cur.no_show });
  assert.equal(p.ok, true);
  assert.match(p.rows.find((r) => r.key === "call_now")!.line, /SubSync will look for the tag "dial-me" instead of "call-now"/);
  assert.equal(p.rows.find((r) => r.key === "no_show")!.changed, false);
  const bad = previewChange(cur, { first_reply: "a,b" });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.first_reply ?? "", /comma/);
  assert.deepEqual(duplicateTags(resolveTags({ no_show: "call-now" })).sort(), ["call_now", "no_show"]);
});

test("the check reports found, not found yet, and exactly 'Needs permission: reconnect'", () => {
  const tags = resolveTags({});
  const all = { tagsReadable: true, workflowsReadable: true, tagNames: QUEUES.map((q) => q.defaultTag.toUpperCase()), workflowNames: ["Call queue", "no-show follow-up call", "Slow first reply call"] };
  const ok = judgeSetup(tags, all);
  assert.equal(ok.state, "ok");
  assert.ok(ok.lines.every((l) => l.state === "found"));
  const miss = judgeSetup(tags, { ...all, tagNames: [], workflowNames: ["Call queue"] });
  assert.equal(miss.state, "missing");
  assert.ok(miss.lines.every((l) => !/should have|your fault|you forgot|failed/i.test(l.text)), "never blames");
  const perm = judgeSetup(tags, { ...all, workflowsReadable: false });
  assert.equal(perm.state, "needs_permission");
  assert.equal(NEEDS_PERMISSION, "Needs permission: reconnect");
  assert.ok(perm.lines.some((l) => l.text.endsWith("Needs permission: reconnect")));
  assert.equal(judgeSetup(tags, { ...all, tagsReadable: false }).state, "needs_permission");
});

test("Getting started row: done only when every checked account is ok; open with a plain reason otherwise; never done by hand", () => {
  assert.deepEqual(guideRowState([], 1).done, false);
  assert.match(guideRowState([], 1).detail, /Not checked yet/);
  assert.equal(guideRowState([{ state: "ok" }], 1).done, true);
  assert.equal(guideRowState([{ state: "ok" }, { state: "ok" }], 2).done, true);
  assert.equal(guideRowState([{ state: "ok" }], 3).done, false, "one of three checked is not done");
  assert.match(guideRowState([{ state: "ok" }], 3).detail, /1 of 3/);
  assert.equal(guideRowState([{ state: "ok" }, { state: "missing" }], 2).done, false);
  assert.equal(guideRowState([{ state: "needs_permission" }], 1).detail, "Needs permission: reconnect");
  const base: Facts = { synced: true, syncDetail: "", seen: new Set(["today", "speed"]), companyUsage: true, slackBrief: true, emailSet: true, clientViewOn: 0, ignoredCount: 0, testLookingCount: 0, changedKeys: new Set(), sharedAudits: 0, feedbackGiven: 0, meetingsPage: false, zoomOn: false };
  for (const role of ["agency_owner", "account_admin"] as const) {
    const row = (f: Facts) => buildSteps(role, f).find((s) => s.id === "call_queues")!;
    assert.ok(row(base), `${role} has the row`);
    assert.equal(row(base).done, false, "no facts: open");
    assert.match(row(base).detail ?? "", /Not checked yet/);
    assert.equal(row({ ...base, callQueues: guideRowState([{ state: "needs_permission" }], 1) }).done, false);
    assert.equal(row({ ...base, callQueues: guideRowState([{ state: "needs_permission" }], 1) }).detail, "Needs permission: reconnect");
    assert.equal(row({ ...base, callQueues: guideRowState([{ state: "ok" }], 1) }).done, true);
    assert.deepEqual(row(base).ticksOn ?? [], [], "a page visit cannot tick it");
    assert.equal(row(base).view, "settings");
    assert.equal(row(base).section, "queues");
    assert.ok(!row(base).optional, "never auto-skips");
  }
});

test("the one-click card shows only to an agency session, with every switch on and an address set", () => {
  const on = { kind: "agency" as const, demo: false, flagOn: true, companyOn: true, url: "https://example.test/setup" };
  assert.equal(snapshotVisible(on).show, true);
  assert.equal(snapshotVisible({ ...on, kind: "business" }).why, "not_agency");
  assert.equal(snapshotVisible({ ...on, kind: "client" }).show, false);
  assert.equal(snapshotVisible({ ...on, flagOn: false }).show, false);
  assert.equal(snapshotVisible({ ...on, companyOn: false }).show, false);
  assert.equal(snapshotVisible({ ...on, url: null }).show, false);
  assert.equal(snapshotVisible({ ...on, demo: true }).show, false);
  assert.equal(snapshotUrlFrom({}), null);
  assert.equal(snapshotUrlFrom({ SNAPSHOT_SHARE_URL: "http://insecure.test" }), null);
  assert.equal(snapshotUrlFrom({ SNAPSHOT_SHARE_URL: " https://example.test/x " }), "https://example.test/x");
});

test("an account session (business or client staff) cannot reach the snapshot address or the owner switch; an agency session can reach the route", () => {
  for (const kind of ["business", "client"] as const) {
    assert.equal(routeAllowed(kind, "GET", ["cqt", "snapshot"]), false, `${kind} snapshot`);
    assert.equal(routeAllowed(kind, "PUT", ["cqt", "switch"]), false, `${kind} switch`);
    assert.equal(routeAllowed(kind, "GET", ["cqt", "tags"]), true, `${kind} may read the tag settings`);
    assert.equal(routeAllowed(kind, "POST", ["cqt", "check"]), true, `${kind} may run the check`);
  }
  assert.equal(routeAllowed("business", "PUT", ["cqt", "tags"]), true);
  assert.equal(routeAllowed("client", "PUT", ["cqt", "tags"]), false, "a client's staff cannot change the tags");
  assert.equal(routeAllowed("agency", "GET", ["cqt", "snapshot"]), true);
  const route = read("src/lib/api/cqt-routes.ts");
  assert.match(route, /ctx\.kind === "agency" && !ctx\.demo \? await gate\(ctx\) : null;\s*\n\s*if \(!g\?\.show \|\| !g\.url\) return json\(\{ error: "Not found" \}, 404\)/, "the handler checks agency again and answers 404");
  assert.match(route, /ownerSession\(ctx\.session\)/, "the switch is owner only");
});

test("the address lives only in the server environment: never in the repository, the client code or a public file", () => {
  const files = ["src/lib/api/cqt-routes.ts", "src/lib/call-queue-tags/snapshot.ts"];
  for (const f of files) assert.ok(!/https:\/\/(?!example)[a-z0-9.-]+\/[^"'\s]*snapshot|share\/[A-Za-z0-9]{10,}/i.test(read(f)), `${f} carries no address`);
  const client = ["src/app/app/views/call-queue-tags-card.tsx", "src/app/app/views/settings.tsx", "src/app/app/views/guides-view.tsx"];
  for (const f of client) assert.ok(!read(f).includes("SNAPSHOT_SHARE_URL"), `${f} never names the variable`);
  assert.ok(!read("src/app/app/views/call-queue-tags-card.tsx").includes("process.env"));
  assert.match(read("src/app/app/views/call-queue-tags-card.tsx"), /api\.get<\{ url: string \}>\("cqt\/snapshot"/, "the address is fetched on click, not rendered");
  assert.ok(!/NEXT_PUBLIC_SNAPSHOT/.test(read("src/lib/call-queue-tags/snapshot.ts")));
});

test("every place that reads the call-now tag or installs a library workflow uses the account's own tag", () => {
  assert.match(read("src/lib/dial/callqueue-run.ts"), /ownTags\(installationId, locationId\)\)\.call_now/);
  assert.match(read("src/lib/workflows-setup/library-run.ts"), /tag: await libraryTag\(/);
  assert.match(read("src/lib/workflows-setup/library-run.ts"), /noshow_task: "no_show"/);
  const store = read("src/lib/call-queue-tags/store.ts");
  for (const q of store.split("\n").filter((l) => /from account_queue_tags|into account_queue_tags|from call_queue_checks|into call_queue_checks/.test(l))) assert.match(q, /installation_id/, "every query is limited to the installation");
});

test("the guide, the settings section and the card use plain words and no platform brand names", () => {
  const g = CONCEPT_GUIDES.find((x) => x.id === "set-up-call-queues")!;
  assert.ok(g && g.read.length >= 4 && g.read.length <= 8 && g.tryView === "settings");
  assert.equal(g.shots?.length, 4);
  assert.ok(g.shots!.every((s) => s.src.startsWith("/guides/call-queue-")));
  const text = JSON.stringify([g, QUEUES]) + read("src/app/app/views/call-queue-tags-card.tsx") + read("src/lib/call-queue-tags/check.ts") + read("src/lib/call-queue-tags/snapshot.ts");
  assert.ok(!/go\s*high\s*level|high\s*level|\bghl\b|lead\s*connector|sub-account/i.test(text));
  assert.match(JSON.stringify(g), /last action, Remove Contact Tag, and pick the same tag that triggered/);
  assert.match(JSON.stringify(g), /switched on/);
  const index = JSON.parse(read("public/guides/index.json")) as { shots: { file: string; caption: string }[] };
  for (const s of g.shots!) assert.ok(index.shots.some((x) => s.src.endsWith(x.file) && x.caption === s.caption), `${s.src} is listed in public/guides/index.json`);
});

test("the guide is visible to everyone and the one-click card is not: the card sits behind the server's flag, and the guide link and tag settings are drawn for every session", () => {
  const card = read("src/app/app/views/call-queue-tags-card.tsx");
  assert.match(card, /d\?\.snapshot\.show && \(/, "the card renders only when the server says so");
  assert.match(card, /Read the guide: Set up your call queues/, "the guide link is always there");
  assert.match(read("src/app/app/views/settings.tsx"), /section === "queues"[^\n]*<CallQueueTagsCard \/>/);
  assert.match(read("src/lib/api/cqt-routes.ts"), /snapshot: snap\?\.show \? \{ show: true, steps: SNAPSHOT_STEPS \} : \{ show: false \}/);
  assert.ok(!/url/.test(read("src/lib/api/cqt-routes.ts").match(/snapshot: snap\?\.show[^\n]*/)![0]), "the tags answer never carries the address");
});
