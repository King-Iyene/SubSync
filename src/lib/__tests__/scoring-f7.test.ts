import assert from "node:assert/strict";
import { test } from "node:test";
import { churnRisk, engagementBreakdown, isDormant, scoreBand, type AccountMetrics } from "../scoring.ts";

// F7 golden cases for the health score, its bands and the leave-risk labels (docs/METRICS.md, "Health score and risk").
const base: AccountMetrics = { contacts: 200, newContacts30d: 10, openOpportunities: 10, staleOpportunities: 0, unansweredOverSla: 0, completenessPct: 100, daysInactive: 0 };

test("the five parts add up to the total and the maximum is exactly 100", () => {
  const b = engagementBreakdown(base);
  assert.equal(b.components.reduce((s, c) => s + c.max, 0), 100);
  assert.equal(b.components.reduce((s, c) => s + c.points, 0), b.total, "no hidden adjustment: the total is the sum of what is shown");
  assert.equal(b.total, 100, "a perfect account scores 100");
});

test("each part has the thresholds the Accounts page tells people", () => {
  const part = (m: Partial<AccountMetrics>, key: string) => engagementBreakdown({ ...base, ...m }).components.find((c) => c.key === key)!.points;
  for (const [days, want] of [[0, 40], [3, 40], [4, 34], [7, 34], [8, 26], [14, 26], [15, 16], [30, 16], [31, 6], [60, 6], [61, 0], [null, 0]] as const) assert.equal(part({ daysInactive: days }, "recency"), want, `last activity ${days} days ago`);
  assert.equal(part({ contacts: 200, newContacts30d: 10 }, "growth"), 20, "5% of the list in a month is full marks");
  assert.equal(part({ contacts: 200, newContacts30d: 0 }, "growth"), 0);
  assert.equal(part({ contacts: 20, newContacts30d: 5 }, "growth"), 20, "a small list needs at least 5 new contacts for full marks");
  assert.equal(part({ openOpportunities: 0 }, "pipeline"), 8, "no open deals is neutral-low, not zero and not full");
  assert.equal(part({ openOpportunities: 10, staleOpportunities: 5 }, "pipeline"), 10);
  assert.equal(part({ unansweredOverSla: 3 }, "responsiveness"), 4);
  assert.equal(part({ unansweredOverSla: 9 }, "responsiveness"), 0, "never below zero");
  assert.equal(part({ completenessPct: 55 }, "quality"), 6);
});

test("band edges: 75 thriving, 55 healthy, 35 watch, under 35 at risk", () => {
  for (const [score, band] of [[100, "thriving"], [75, "thriving"], [74, "healthy"], [55, "healthy"], [54, "watch"], [35, "watch"], [34, "at_risk"], [0, "at_risk"]] as const) assert.equal(scoreBand(score), band, String(score));
});

test("gone quiet means the quiet setting or more, and never having any activity", () => {
  assert.equal(isDormant(29, 30), false);
  assert.equal(isDormant(30, 30), true);
  assert.equal(isDormant(null, 30), true);
});

test("leave risk: quiet for the setting is 'could leave', twice the setting is 'likely to leave', never active is 'likely to leave'", () => {
  const r = (input: Partial<Parameters<typeof churnRisk>[0]>) => churnRisk({ score: 80, daysInactive: 1, dormantDays: 30, history: [], ...input });
  assert.equal(r({}).level, "low");
  assert.equal(r({ daysInactive: 30 }).level, "medium");
  assert.equal(r({ daysInactive: 59 }).level, "medium");
  assert.equal(r({ daysInactive: 60 }).level, "high");
  assert.equal(r({ daysInactive: null }).level, "high");
  assert.equal(r({ score: 39 }).level, "medium");
  assert.equal(r({ score: 24 }).level, "high");
  assert.equal(r({ score: 25 }).level, "medium");
});

test("leave risk from a falling score needs at least three days of history, and says by how much", () => {
  const r = (history: number[], score: number) => churnRisk({ score, daysInactive: 1, dormantDays: 30, history });
  assert.equal(r([90, 90], 50).level, "low", "two points of history is not a trend");
  assert.equal(r([90, 90, 90], 78).level, "medium");
  assert.equal(r([90, 90, 90], 65).level, "high");
  assert.match(r([90, 90, 90], 65).reasons.join(" "), /fell 25 points/);
  assert.equal(r([60, 60, 60], 66).level, "low", "a rise is never a warning");
});

test("the plain-word labels shown on screen exist for every level and band", async () => {
  const ui = await import("node:fs").then((fs) => fs.readFileSync(new URL("../../app/app/ui.tsx", import.meta.url), "utf8"));
  for (const word of ["Likely to leave", "Could leave", "Steady", "Thriving", "Healthy", "Watch", "At risk"]) assert.ok(ui.includes(word), word);
  for (const jargon of ["churn", "Engagement score"]) assert.ok(!ui.includes(jargon), `the screen no longer says "${jargon}"`);
});
