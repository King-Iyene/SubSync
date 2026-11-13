import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bestWorst, bestWorstLine, cleanOf, goodRate, MIN_SOURCE_LEADS, pctOf, tallyProblem, ZERO, type SourceRow } from "../dq/dq-core.ts";
import { layoutGate, passSeconds } from "../design/sorting-gate.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const row = (label: string, leads: number, dups: number, junk: number): SourceRow => ({ key: label.toLowerCase(), label, ...ZERO, leads, dups, junk });

// The live case from King's screenshot: 133 leads in 30 days, 18 of them duplicates (all "No source"), 1 junk.
const FIXTURE = [row("Facebook Ad", 23, 0, 0), row("Google Ad", 23, 0, 0), row("Referral", 23, 0, 0), row("Instagram", 22, 0, 0), row("Website Form", 22, 0, 1), row("No source", 34, 18, 0), row("Other sources", 4, 0, 0)];

test("the gate tally equals the rows behind it: duplicates + clean + junk = leads, and the duplicates are the 18 listed", () => {
  const L = layoutGate({ lanes: FIXTURE, groups: 0 }, { width: 900 });
  const listLength = 18; // the "Duplicate leads" list for the same window
  assert.equal(L.totals.dups, listLength);
  assert.equal(L.totals.clean + L.totals.dups + L.totals.junk, L.totals.leads);
  for (const l of L.lanes) assert.equal(l.clean + l.dups + l.junk, l.leads, `${l.label} adds up`);
  assert.equal(L.lanes.find((l) => l.label === "No source")?.dups, 18, "the duplicates sit on their own source line");
  assert.equal(tallyProblem(FIXTURE), null);
  assert.match(tallyProblem([row("Bad", 5, 4, 3)]) ?? "", /only 5 leads/);
});

test("good leads = the clean share; under the minimum a source says 'not enough leads', never 0%", () => {
  assert.equal(cleanOf(row("x", 23, 18, 1)), 4);
  assert.equal(goodRate(row("x", 23, 0, 0)), 1);
  assert.equal(goodRate(row("x", MIN_SOURCE_LEADS - 1, 0, 0)), null);
  assert.equal(pctOf(goodRate(row("x", 4, 0, 0))), "not enough leads");
  const b = bestWorst(FIXTURE);
  assert.equal(b.best?.label !== undefined, true);
  assert.match(bestWorstLine(b), /Best: .*\(\d+% good leads.*Weakest: .*\(\d+% good leads/);
  assert.doesNotMatch(bestWorstLine(b), /\(0% good leads/);
  assert.equal(b.worst?.label, "No source");
  assert.match(bestWorstLine(b), /Weakest: No source \(47% good leads, 53% duplicates\)/);
  const few = bestWorst([row("A", 9, 0, 0), row("B", 9, 3, 0)]);
  assert.equal(few.best, null);
  assert.match(bestWorstLine(few), /Not enough leads/);
});

test("the card and the list share one definition and one WHERE (wiring)", () => {
  const q = read("../analytics/dq-queries.ts");
  const live = q.slice(q.indexOf("async function sourcesLive"), q.indexOf("async function sourcesHistory"));
  assert.match(live, /leadWhere\(db, s, f\)/, "the card's counts use the list's WHERE");
  assert.match(live, /LEAD_SQL\.dup/); assert.match(live, /LEAD_SQL\.junk/);
  assert.match(q, /export async function listLeads[\s\S]*?leadWhere\(db, s, f\)/);
  assert.match(q, /export async function countLeads[\s\S]*?leadWhere\(db, s, f\)/);
  const roll = q.slice(q.indexOf("export async function sourcesRollup"), q.indexOf("export async function sourceDays"));
  assert.match(roll, /sourcesLive\(/, "the overview reads live counts, not only the daily record");
});

test("the sorting gate plays one pass and rests: no looping animation, a pause control, off-screen and hidden-tab guards", () => {
  const g = read("../../app/app/views/dq/sorting-gate.tsx");
  assert.doesNotMatch(g, /indefinite/, "no endless SVG animation");
  assert.doesNotMatch(g, /requestAnimationFrame/, "no frame loop");
  assert.doesNotMatch(g, /animation[^\n]*infinite/);
  assert.match(g, /repeatCount="1"/);
  assert.match(g, /IntersectionObserver/); assert.match(g, /visibilitychange/);
  assert.match(g, /-pause`/); assert.match(g, /-replay`/);
  assert.match(g, /pauseAnimations\(\)/); assert.match(g, /useReducedMotion\(\)/);
  assert.match(g, /showDots = !reduced/);
  const L = layoutGate({ lanes: FIXTURE, groups: 0 }, { width: 900 });
  assert.ok(passSeconds(L.dots) > 0 && passSeconds(L.dots) < 15, "one pass is a few seconds");
  assert.equal(passSeconds([]), 0);
});

test("other decorative cards no longer loop forever", () => {
  for (const f of ["../../app/app/views/pl3/funnel-dots.css", "../../app/app/views/pl3/funnel-fx.css", "../../app/app/ds/lead-journey-pro.css"]) {
    const css = read(f);
    for (const line of css.split("\n")) {
      if (!/animation[^;]*infinite/.test(line)) continue;
      // only small loading skeletons and the "replaying" status dot may pulse
      assert.match(line, /fv-bone|fv-replaychip/, `${f}: ${line.slice(0, 80)}`);
    }
  }
  assert.doesNotMatch(read("../../app/app/views/pl3/funnel-dots.css"), /fv-fall linear infinite|fv-sway[^;]*infinite/);
});
