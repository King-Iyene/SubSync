import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLOSED_OUT_STAGE_PATTERN, NOT_IN_USE_PIPELINE_PATTERN, parseRulePatch, pipelineTreatment, ruleKey, stageProbability, suggestPipelineClass, suggestStageClass, treatmentOf,
  type StoredRule,
} from "../analytics/stage-rules.ts";
import { currentVersion, DEAL_RULES_VERSION, encode, rowVersion, sameDefinition } from "../analytics/definitions.ts";
import { attentionBand, healthBand, REPLY_DELAY_AT_RISK, REPLY_DELAY_WATCH } from "../scoring.ts";
import { MIN_BASE_FOR_PERCENT, percentChange } from "../analytics/metrics.ts";
import { effectiveColdTags, engagementOf, qualityFigures, sourceSummary, suggestColdTag } from "../analytics/contact-intel.ts";
import { changeOf, compare, portfolioHeadlines, type SeriesPoint } from "../analytics/digest-intel.ts";
import { plural } from "../text.ts";
import { readLimitNote, unreadSummary } from "../analytics/waiting.ts";

// ---------------- N38: stages and pipelines that are not in play ----------------

test("stage names that are closed out by design are suggested as closed out, and ordinary stages are not", () => {
  for (const name of ["Disqualified", "Bad Fit/Not Qualified", "Wrong Phone Number", "Unreachable", "Closed Lost", "Lost", "Do Not Contact", "Not interested", "Junk", "[DNC]"]) {
    assert.equal(suggestStageClass(name), "closed_out", name);
  }
  for (const name of ["New Lead", "Contacted", "Appointment Set", "Proposal Sent", "Negotiation", "Lostwages Claims", "Blossom", "Qualified", "Fit check", "", null]) {
    assert.equal(suggestStageClass(name as string | null), "active", String(name));
  }
});

test("pipeline names that say not in use are suggested as not in use", () => {
  for (const name of ["[Not IN USE] Old sales", "Old sales (unused)", "Deprecated pipeline", "DO NOT USE", "Inactive leads", "Archived 2024"]) assert.equal(suggestPipelineClass(name), "not_in_use", name);
  for (const name of ["Sales", "Leads pipeline", "Old Customers Upsell", "Used cars", "Renewals", ""]) assert.equal(suggestPipelineClass(name), "in_use", name);
});

test("the same two patterns are exported for the SQL, so the screen and the totals cannot disagree", () => {
  assert.ok(CLOSED_OUT_STAGE_PATTERN.includes("disqualified") && NOT_IN_USE_PIPELINE_PATTERN.includes("not in use"));
  assert.ok(!/[\\]/.test(CLOSED_OUT_STAGE_PATTERN + NOT_IN_USE_PIPELINE_PATTERN), "no escapes: Postgres and JavaScript read it the same way");
});

test("the owner's rule beats the name, in both directions, and a pipeline that is not in use takes every stage with it", () => {
  const none: StoredRule[] = [];
  assert.equal(treatmentOf("Sales", "Disqualified", none).out, true);
  assert.equal(treatmentOf("Sales", "Disqualified", none).source, "name");
  assert.equal(treatmentOf("Sales", "New", none).out, false);
  const keep: StoredRule[] = [{ pipelineKey: "sales", stageKey: "disqualified", cls: "active", winProbability: null }];
  assert.equal(treatmentOf("Sales", "Disqualified", keep).out, false, "the owner says this stage is still worked");
  assert.equal(treatmentOf("Sales", "Disqualified", keep).source, "owner");
  const closeIt: StoredRule[] = [{ pipelineKey: "sales", stageKey: "new", cls: "closed_out", winProbability: null }];
  assert.equal(treatmentOf("Sales", "New", closeIt).out, true);
  assert.equal(treatmentOf("Sales", "New", closeIt).label, "Closed out");
  const ignore: StoredRule[] = [{ pipelineKey: "sales", stageKey: "junk drawer", cls: "ignore", winProbability: null }];
  assert.equal(treatmentOf("Sales", "Junk drawer", ignore).label, "Ignored");
  // A whole pipeline
  assert.equal(treatmentOf("[Not IN USE] Old", "New Lead", none).out, true, "a stage in an unused pipeline is out whatever its name");
  assert.equal(treatmentOf("[Not IN USE] Old", "New Lead", none).label, "Pipeline not in use");
  const inUse: StoredRule[] = [{ pipelineKey: "[not in use] old", stageKey: "", cls: "in_use", winProbability: null }];
  assert.equal(treatmentOf("[Not IN USE] Old", "New Lead", inUse).out, false, "the owner says the pipeline is in use after all");
  assert.equal(pipelineTreatment("[Not IN USE] Old", inUse).notInUse, false);
  assert.equal(pipelineTreatment("[Not IN USE] Old", none).source, "name");
});

test("rule keys ignore case and spacing, and a stage probability is the owner's number or nothing", () => {
  assert.equal(ruleKey("  Proposal Sent "), "proposal sent");
  const rules: StoredRule[] = [{ pipelineKey: "sales", stageKey: "proposal sent", cls: null, winProbability: 35 }];
  assert.equal(stageProbability("SALES", "Proposal  Sent".replace("  ", " "), rules), 0.35);
  assert.equal(stageProbability("Sales", "New", rules), null, "an unset stage has no assumption, never a default");
  assert.equal(stageProbability("Sales", "", rules), null);
});

test("a rule change is checked before it is saved", () => {
  assert.deepEqual(parseRulePatch({ pipeline: "Sales", stage: "Disqualified", cls: "active" }), { ok: true, patch: { pipeline: "Sales", stage: "Disqualified", cls: "active" } });
  assert.deepEqual(parseRulePatch({ pipeline: "Sales", stage: null, cls: "not_in_use" }), { ok: true, patch: { pipeline: "Sales", stage: null, cls: "not_in_use" } });
  assert.deepEqual(parseRulePatch({ pipeline: "Sales", stage: "New", winProbability: "40" }), { ok: true, patch: { pipeline: "Sales", stage: "New", winProbability: 40 } });
  for (const bad of [null, "x", {}, { pipeline: "" }, { pipeline: "Sales", stage: "New" }, { pipeline: "Sales", stage: "New", cls: "not_in_use" }, { pipeline: "Sales", stage: null, cls: "closed_out" },
    { pipeline: "Sales", stage: "New", winProbability: 101 }, { pipeline: "Sales", stage: "New", winProbability: -1 }, { pipeline: "Sales", stage: null, winProbability: 10 }, { pipeline: "x".repeat(200), stage: null, cls: "in_use" }]) {
    assert.equal(parseRulePatch(bad).ok, false, JSON.stringify(bad));
  }
  assert.deepEqual(parseRulePatch({ pipeline: "Sales", stage: "New", winProbability: null }), { ok: true, patch: { pipeline: "Sales", stage: "New", winProbability: null } }, "clearing a probability is allowed");
});

// ---------------- N39: a change of definition is never a trend ----------------

test("rows written before versions existed are read by date: every open deal before 31 Oct 2026, counted deals from then on", () => {
  assert.equal(rowVersion({ day: "2026-10-30", definitionVersion: null }), 1000);
  assert.equal(rowVersion({ day: "2026-10-31", definitionVersion: null }), 2000);
  assert.equal(rowVersion({ day: "2026-11-01", definitionVersion: undefined }), 2000);
  assert.equal(rowVersion({ day: "2026-11-02", definitionVersion: 3000 }), 3000, "a stored version wins");
  assert.equal(currentVersion(0), encode(DEAL_RULES_VERSION, 0));
  assert.notEqual(currentVersion(0), currentVersion(1), "a change to a stage rule is a new definition");
});

test("the real series that showed $2.4M to $1.0M is drawn from the day the rule changed, with a note", () => {
  const pts = [
    { day: "2026-10-30", definitionVersion: null }, // 10,374 open deals, $2,400,000: every open deal
    { day: "2026-10-31", definitionVersion: null }, // 1 deal, $1,000,000: counted deals
    { day: "2026-11-01", definitionVersion: null },
  ];
  const r = sameDefinition(pts);
  assert.deepEqual(r.kept.map((p) => p.day), ["2026-10-31", "2026-11-01"]);
  assert.equal(r.leftOut, 1);
  assert.equal(r.since, "2026-10-31");
  assert.ok(r.note && r.note.includes("2026-10-31") && r.note.includes("1 earlier day is not drawn"));
  assert.equal(sameDefinition(pts.slice(1)).note, null, "no note when nothing was left out");
  assert.deepEqual(sameDefinition([]), { kept: [], leftOut: 0, since: null, note: null });
  // A later version starts a new line
  const later = sameDefinition([...pts, { day: "2026-11-02", definitionVersion: 3000 }]);
  assert.deepEqual(later.kept.map((p) => p.day), ["2026-11-02"]);
  assert.equal(later.leftOut, 3);
});

const pt = (day: string, over: Partial<SeriesPoint> = {}): SeriesPoint => ({ day, contacts: 100, new30: 20, openOpps: 10, openValue: 100_000, stale: 4, unread: 12, completeness: 80, score: 70, dealsOk: true, ...over });

test("'vs yesterday' for a deal figure ignores days counted the old way, so a rule change is not a fall of 58 percent", () => {
  const before = pt("2026-10-30", { openValue: 2_400_000, openOpps: 10_374, dealsOk: false });
  const after = pt("2026-10-31", { openValue: 1_000_000, openOpps: 1 });
  const c = changeOf([before, after], "openValue", 5000, 5000)!;
  assert.equal(c.yesterday, null, "the old-rule day is not yesterday for this figure");
  assert.equal(c.vsYesterday, null);
  // A figure that does not depend on the rules still compares across the change
  const u = changeOf([pt("2026-10-30", { unread: 20, dealsOk: false }), pt("2026-10-31", { unread: 30 })], "unread")!;
  assert.equal(u.yesterday, 20);
  assert.equal(u.vsYesterday, 50);
  const h = portfolioHeadlines([[before, after]]).find((x) => x.key === "openValue")!;
  assert.equal(h.change.vsYesterday, null);
});

// ---------------- N6: no percentage on a small base ----------------

test("a percentage change needs a base of at least 10, so two contacts never read as minus 100 percent", () => {
  assert.equal(MIN_BASE_FOR_PERCENT, 10);
  assert.equal(percentChange(0, 2), null);
  assert.equal(percentChange(2, 1), null);
  assert.equal(percentChange(3, 9), null);
  assert.equal(percentChange(15, 10), 50);
  assert.equal(percentChange(5, 10), -50);
  assert.equal(percentChange(5, null), null);
  assert.equal(percentChange(5000, 4000, 5000), null, "dollar figures use their own minimum");
  assert.equal(percentChange(9000, 6000, 5000), 50);
  const c = compare([2], 0);
  assert.equal(c.vsYesterday, null);
  assert.equal(c.diffYesterday, -2, "the plain difference is what is shown instead");
  assert.equal(c.smallBase, true);
  const big = compare([40], 20);
  assert.equal(big.vsYesterday, -50);
  assert.equal(big.smallBase, false);
});

// ---------------- N16 and N62: health labels that agree with the waiting customers ----------------

test("23 customers waiting can never read Healthy: the label is held down by the reply delay (N16)", () => {
  // Real case: score 57 is "Healthy", with 23 conversations waiting.
  const h = healthBand(57, 23);
  assert.equal(h.scoreBand, "healthy");
  assert.equal(h.band, "at_risk");
  assert.equal(h.heldDown, true);
  assert.ok(h.why && h.why.includes("23 customers are waiting"));
  assert.equal(healthBand(57, REPLY_DELAY_WATCH).band, "watch");
  assert.equal(healthBand(57, REPLY_DELAY_WATCH - 1).band, "healthy");
  assert.equal(healthBand(90, REPLY_DELAY_AT_RISK).band, "at_risk");
  assert.equal(healthBand(90, REPLY_DELAY_AT_RISK - 1).band, "watch");
  assert.equal(healthBand(20, 0).band, "at_risk", "a low score is never lifted");
  assert.equal(healthBand(60, 0).heldDown, false);
  assert.equal(healthBand(60, 0).why, null);
  assert.equal(healthBand(60, 1).band, "healthy");
});

test("inside a Needs attention list nothing is Healthy or Thriving (N16)", () => {
  assert.equal(attentionBand("thriving"), "watch");
  assert.equal(attentionBand("healthy"), "watch");
  assert.equal(attentionBand("watch"), "watch");
  assert.equal(attentionBand("at_risk"), "at_risk");
});

// ---------------- N45, N46, N47: leads ----------------

test("tags that name a cold list are suggested, the owner's choice replaces the suggestion, and an empty choice is a choice (N45)", () => {
  for (const t of ["cold email outreach", "50k agency owners cold", "Scraped list", "outreach", "bought list"]) assert.equal(suggestColdTag(t), true, t);
  for (const t of ["lead", "customer", "vip", "Coldwell referral", "newsletter"]) assert.equal(suggestColdTag(t), false, t);
  const all = ["lead", "cold email outreach", "50k agency owners", "vip"];
  assert.deepEqual(effectiveColdTags(all, null).map((c) => c.tag), ["cold email outreach"]);
  assert.equal(effectiveColdTags(all, null)[0].source, "name");
  assert.deepEqual(effectiveColdTags(all, ["50k agency owners"]), [{ tag: "50k agency owners", source: "owner" }], "the owner's list replaces the guess");
  assert.deepEqual(effectiveColdTags(all, []), [], "an empty choice means nothing is cold");
  assert.deepEqual(effectiveColdTags(all, ["deleted tag"]), [], "a tag nobody has is not listed");
});

test("what a contact has done is told as seen, recent, then quiet, or none seen (N45)", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  const day = 86_400_000;
  assert.equal(engagementOf(null, now), "none_seen");
  assert.equal(engagementOf(now - 10 * day, now), "engaged_recently");
  assert.equal(engagementOf(now - 90 * day, now), "engaged_recently", "exactly 90 days is not yet over 90");
  assert.equal(engagementOf(now - 91 * day, now), "engaged_then_quiet");
});

test("a zero is only a zero when the check could run, and missing is not invalid (N46)", () => {
  const q = { total: 1000, withEmail: 800, withPhone: 700, badEmail: 0, disposable: 0, badPhone: 0 };
  const ok = qualityFigures(q, true);
  assert.deepEqual(ok.invalidEmails, { state: "checked", value: 0, of: 800 }, "0 of 800 emails checked is a real zero");
  assert.deepEqual(ok.missingEmails, { state: "checked", value: 200, of: 1000 });
  assert.deepEqual(ok.missingPhones, { state: "checked", value: 300, of: 1000 });
  const unread = qualityFigures(q, false);
  assert.equal(unread.invalidEmails.state, "not_checked", "before the contacts are read nothing is checked");
  assert.equal(unread.missingEmails.state, "not_checked");
  const noEmails = qualityFigures({ total: 50, withEmail: 0, withPhone: 50, badEmail: 0, disposable: 0, badPhone: 2 }, true);
  assert.equal(noEmails.invalidEmails.state, "not_checked", "no emails on file means there is nothing to judge");
  assert.ok(noEmails.invalidEmails.state === "not_checked" && noEmails.invalidEmails.reason.includes("email"));
  assert.deepEqual(noEmails.invalidPhones, { state: "checked", value: 2, of: 50 });
  assert.equal(qualityFigures({ total: 0, withEmail: 0, withPhone: 0, badEmail: 0, disposable: 0, badPhone: 0 }, true).invalidPhones.state, "not_checked", "no contacts, nothing checked");
});

test("when most contacts have no source the Leads page says what to do, with enough contacts behind it (N47)", () => {
  const real = sourceSummary([{ source: "Unknown", contacts: 52_223, new30: 4, won: 0, wonValue: 0 }, { source: "Facebook Lead Form", contacts: 600, new30: 3, won: 2, wonValue: 4000 }, { source: "Website form", contacts: 103, new30: 1, won: 0, wonValue: 0 }]);
  assert.equal(real.total, 52_926);
  assert.equal(real.noSourcePct, 99);
  assert.ok(real.action && real.action.headline.startsWith("99% of your contacts have no source recorded") && real.action.steps.length === 3);
  assert.deepEqual(real.kinds.map((k) => k.kind), ["none", "meta", "form"]);
  const fine = sourceSummary([{ source: "Referral", contacts: 40, new30: 1, won: 0, wonValue: 0 }, { source: "Zillow Premier Agent", contacts: 30, new30: 1, won: 0, wonValue: 0 }, { source: "", contacts: 10, new30: 0, won: 0, wonValue: 0 }]);
  assert.equal(fine.action, null, "12% unknown is not an action");
  assert.equal(sourceSummary([{ source: "Unknown", contacts: 10, new30: 0, won: 0, wonValue: 0 }]).action, null, "ten contacts are too few to say anything");
  assert.equal(sourceSummary([]).noSourcePct, null);
});

// ---------------- N62: the noun agrees with the number ----------------

test("1 contact, 2 contacts, 0 contacts", () => {
  assert.equal(plural(1, "contact"), "1 contact");
  assert.equal(plural(2, "contact"), "2 contacts");
  assert.equal(plural(0, "contact"), "0 contacts");
  assert.equal(plural(1, "person", "people"), "1 person");
  assert.equal(plural(3, "person", "people"), "3 people");
  assert.equal(plural(52_926, "contact"), "52,926 contacts");
});

// ---------------- N15: unread is its own count, and the limit is stated ----------------

test("unread counts every unread conversation, and says how many of them are also waiting (285 versus 259)", () => {
  // The real figures: 285 unread, of which 26 were also waiting. The Inbox's Unread card used to show only the 259 that were not waiting.
  const rows = [
    ...Array.from({ length: 259 }, () => ({ unreadCount: 1, overSla: false })),
    ...Array.from({ length: 26 }, () => ({ unreadCount: 2, overSla: true })),
    ...Array.from({ length: 40 }, () => ({ unreadCount: 0, overSla: true })),
  ];
  assert.deepEqual(unreadSummary(rows), { unread: 285, unreadAndWaiting: 26, unreadNotWaiting: 259 });
});

test("a count that hides conversations says so; one that hides nothing says nothing", () => {
  assert.equal(readLimitNote(0, 3), null);
  assert.ok(readLimitNote(1, 3)!.includes("newest 500") && readLimitNote(1, 3)!.includes("1 of 3 accounts has"));
  assert.ok(readLimitNote(2, 2)!.includes("2 of 2 accounts have"));
});

// ---------------- N64: three different reasons something is unavailable ----------------

import { CAPABILITY_PROBES, classifyProbe, dig, fieldReport } from "../ghl/capabilities.ts";
import { GHL_SCOPES } from "../ghl/scopes.ts";

test("a refusal is explained by its real cause: never asked, declined by this install, or refused by the platform (N64)", () => {
  const never = classifyProbe({ requestedByApp: false, grantedByInstall: false, status: 403 });
  assert.equal(never.cause, "needs_permission_not_requested");
  assert.ok(never.words.startsWith("Needs permission") && never.words.includes("never asked"));
  const declined = classifyProbe({ requestedByApp: true, grantedByInstall: false, status: 401 });
  assert.equal(declined.cause, "needs_permission_declined");
  assert.ok(declined.words.includes("reconnect"));
  const restricted = classifyProbe({ requestedByApp: true, grantedByInstall: true, status: 403 });
  assert.equal(restricted.cause, "platform_restricted");
  assert.ok(restricted.words.startsWith("Not available from the platform yet"));
  assert.equal(classifyProbe({ requestedByApp: true, grantedByInstall: true, status: 404 }).cause, "not_exposed");
  assert.equal(classifyProbe({ requestedByApp: true, grantedByInstall: true, status: 429 }).cause, "not_verified", "a rate limit is not an answer");
  assert.equal(classifyProbe({ requestedByApp: true, grantedByInstall: true, status: null }).cause, "not_verified");
  assert.equal(classifyProbe({ requestedByApp: true, grantedByInstall: true, status: 200, fieldsPresent: ["id"], fieldsMissing: [] }).cause, "available");
  const partly = classifyProbe({ requestedByApp: true, grantedByInstall: true, status: 200, fieldsPresent: ["id"], fieldsMissing: ["lastActivity"] });
  assert.equal(partly.cause, "partly");
  assert.ok(partly.words.includes("lastActivity"));
});

test("the probe list asks only for permissions the app declares, or ones it says it does not have", () => {
  const asked = new Set<string>(GHL_SCOPES);
  const keys = CAPABILITY_PROBES.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length, "no probe is listed twice");
  for (const p of CAPABILITY_PROBES) {
    assert.ok(p.path("LOC", { calendarId: "C", conversationId: "V" }) !== null, p.key);
    assert.ok(!/(?:^|[?&])(?:delete|remove|create)/i.test(p.path("LOC", { calendarId: "C", conversationId: "V" }) ?? ""), "only reads: " + p.key);
  }
  const notAsked = CAPABILITY_PROBES.filter((p) => p.scope && !asked.has(p.scope)).map((p) => p.key).sort();
  assert.deepEqual(notAsked, ["forms", "invoices", "transactions", "workflows"], "exactly the permissions the roadmap has not asked for");
});

test("a field report names the fields and counts the filled ones, never a value", () => {
  const r = fieldReport([{ id: "1", source: "Web", tags: [], lastActivity: null }, { id: "2", source: null, tags: ["a"] }], ["id", "source", "tags", "lastActivity", "dnd"]);
  assert.deepEqual(r.fieldsPresent, ["id", "source", "tags", "lastActivity"]);
  assert.deepEqual(r.fieldsMissing, ["dnd"]);
  assert.deepEqual(r.filled, { id: 2, source: 1, tags: 1, lastActivity: 0 });
  assert.equal(r.sample, 2);
  assert.deepEqual(fieldReport([], ["id"]).fieldsMissing, ["id"]);
  assert.equal(dig({ a: { b: 5 } }, ["a", "b"]), 5);
  assert.equal(dig({ a: 1 }, ["a", "b"]), undefined);
});
