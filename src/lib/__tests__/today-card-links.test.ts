import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { arrivalNote, cardLink, goWith, NOSHOW_WINDOW_DAYS, setDeepLink, takeDeepLink, UNMARKED_WINDOW_DAYS } from "../design/deep-link.ts";

// The rule: every Today number opens exactly its rows. The live bug: "Appointments to confirm 23" opened Appointments with "last 30 days" and "0 appointments match" (the 23 were 51 to 83 days old).

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const DAY = 86_400_000;

test("Appointments to confirm opens Needs outcome with a look-back that includes every counted appointment", () => {
  const l = cardLink("unmarked", { count: 23 });
  assert.equal(l.view, "appointments");
  assert.equal(l.tab, "needs");
  assert.equal(l.expect, 23);
  // The 23 from the live report were 51 to 83 days old: the window must reach them, and it is not the 30 days of the date bar.
  const ages = Array.from({ length: 23 }, (_, i) => 51 + Math.round((i * 32) / 22));
  assert.ok(l.days && l.days > 30);
  assert.ok(ages.every((a) => a <= (l.days as number)), "every counted appointment is inside the opened window");
  assert.equal(l.days, UNMARKED_WINDOW_DAYS);
});

test("No-shows to rebook opens No-show recovery (the last 7 days, not booked again)", () => {
  const l = cardLink("noshows", { count: 4, location: "locA1" });
  assert.deepEqual([l.view, l.tab, l.days, l.location, l.expect], ["appointments", "recover", NOSHOW_WINDOW_DAYS, "locA1", 4]);
});

test("Money at risk opens the quiet-deals section of Pipeline", () => {
  const l = cardLink("stale_deals", { count: 11 });
  assert.deepEqual([l.view, l.tab], ["pipeline", "stale"]);
});

test("a link is read once, by the page it is for", () => {
  setDeepLink(cardLink("unmarked", { count: 5 }));
  assert.equal(takeDeepLink("pipeline"), null, "another page does not take it");
  assert.equal(takeDeepLink("appointments")?.tab, "needs");
  assert.equal(takeDeepLink("appointments"), null, "a later visit by the menu starts clean");
  let went = "";
  goWith((v, loc) => { went = `${v}|${loc ?? ""}`; }, cardLink("noshows", { count: 1, location: "locB2" }));
  assert.equal(went, "appointments|locB2");
  takeDeepLink("appointments");
});

test("count equals rows: no note when they match, a clear one-line note with a widen hint when they do not", () => {
  const l = { expect: 23, what: "Appointments to confirm" };
  assert.equal(arrivalNote(l, 23), null);
  assert.equal(arrivalNote(l, null), null, "still loading");
  assert.equal(arrivalNote({ expect: null }, 0), null, "a card with no count promises nothing");
  const empty = arrivalNote(l, 0);
  assert.equal(empty?.tone, "empty");
  assert.match(empty?.text ?? "", /counted 23.*none show.*Widen/);
  assert.equal(arrivalNote(l, 20)?.tone, "differs");
});

test("the Today count and the Appointments list use one rule", () => {
  const today = read("lib/analytics/today3-queries.ts"), ap = read("lib/analytics/appointments3-queries.ts");
  // Same statuses and the same 3-hour wait in both.
  const unmarked = "a.status not in ('showed', 'noshow', 'cancelled', 'invalid') and a.start_at < now() - interval '3 hours'";
  assert.ok(today.includes(unmarked) && ap.includes(unmarked));
  // Same no-show rule: not booked again, snoozed ones left out, deleted appointments left out.
  for (const part of ["b.start_at > a.start_at and b.appointment_id <> a.appointment_id and b.status not in ('cancelled', 'invalid')", "fa.deleted_at is null", "snoozed_until"]) {
    assert.ok(today.includes(part) && ap.includes(part), part);
  }
  // The window comes from one constant that is also the link's window.
  assert.ok(today.includes("UNMARKED_WINDOW_DAYS") && today.includes("NOSHOW_WINDOW_DAYS"));
  assert.ok(ap.includes("minAgeDays") && !ap.includes("90 days'"), "the list is bounded by the dates the link sets, not a hidden 90");
  void DAY;
});

test("every Today card opens its own rows: no bare link into Appointments or Pipeline from a card with a count", () => {
  const hero = read("app/app/views/td3/module.tsx");
  for (const [id, kind] of [["money", "stale_deals"], ["noshows", "noshows"], ["appts", "unmarked"]] as const) {
    const line = hero.split("\n").find((x) => x.includes(`id: "${id}"`)) ?? "";
    assert.ok(line.includes(`cardLink("${kind}"`) && line.includes("setDeepLink"), `${id} card sets its deep link`);
    assert.ok(!/onGo: \(\) => go\(/.test(line), `${id} card is not a bare link`);
  }
  // The two appointment cards count every account with the Appointments rule and open the matching list.
  assert.ok(hero.includes('kind: "all_unmarked"') && hero.includes('kind: "open_noshows"'));
  assert.ok(hero.includes("t.counts?.unmarked") && hero.includes("t.counts?.noshows"));
  for (const f of ["today-dash.tsx", "today-page.tsx"]) {
    const src = read(`app/app/views/${f}`);
    const bare = src.split("\n").filter((x) => /go\("appointments"\)/.test(x) && !/showRate|my-showrate|AppointmentsSection/.test(x));
    assert.deepEqual(bare, [], `${f} has a bare link into Appointments from a count`);
  }
});

test("Appointments takes the link on arrival and says which dates it opened with", () => {
  const m = read("app/app/views/ap3/module.tsx"), s2 = read("app/app/views/ap3/sections2.tsx");
  assert.ok(m.includes('takeDeepLink("appointments")') && m.includes("setArrival"));
  assert.ok(s2.includes("Showing the last {arrival.days} days") && s2.includes("ap-arrival-widen"));
  assert.ok(read("app/app/views/pl3/module.tsx").includes('takeDeepLink("pipeline")'));
});
