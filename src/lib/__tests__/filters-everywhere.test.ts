import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { answerStoreKey } from "../analytics/read-answers.ts";
import { inPipeline, pipeKey, pipelineCacheKey, pipelineParam } from "../analytics/pipeline-pick.ts";
import { hashWithPick, pickFromHash, pickPath } from "../design/pipeline-pick-link.ts";
import { DATES_NOTES, datesNote } from "../design/dates-note.ts";
import { barMode } from "../design/global-filter.ts";
import { resolveRange, type RangePreset } from "../design/range.ts";
import { localDay } from "../design/zone.ts";
import { windowQuery } from "../design/page-range.ts";
import { parsePlWindow } from "../analytics/pipeline3-intel.ts";
import { parseWindow as clientsWindow } from "../analytics/clients3-intel.ts";
import { parseWindow as peopleWindow } from "../analytics/people3-intel.ts";
import { parseApptWindow } from "../analytics/appointments3-intel.ts";
import { parseWindow as speedWindow } from "../analytics/speed-window.ts";
import { queryOf } from "../../app/app/views/pl3/adapters.ts";

// King, 13 Nov 2026: "the pipeline filter is not affecting the stuff" and "the date filters are not working in all the modules".
// Part A: one picked pipeline must reach every number, list and export. Part B: the date bar's window must be the window every server reader uses, and every page says what the dates do.
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const lagos = (iso: string) => Date.parse(`${iso}+01:00`);

// ---------------- A: pipeline ----------------
type Deal = { id: string; pipelineName: string; status: "open" | "won" | "lost"; value: number };
const FIXTURE: Deal[] = [
  { id: "a1", pipelineName: "Sales Pipeline", status: "open", value: 100 }, { id: "a2", pipelineName: "Sales Pipeline", status: "open", value: 300 }, { id: "a3", pipelineName: "sales  pipeline ", status: "won", value: 50 },
  { id: "b1", pipelineName: "Onboarding", status: "open", value: 70 }, { id: "b2", pipelineName: "Onboarding", status: "lost", value: 20 },
];

test("with two pipelines, picking one keeps exactly that pipeline's deals (names merge across spacing and case)", () => {
  const sales = FIXTURE.filter((d) => inPipeline(d.pipelineName, "Sales Pipeline")), onboarding = FIXTURE.filter((d) => inPipeline(d.pipelineName, "ONBOARDING"));
  assert.deepEqual(sales.map((d) => d.id), ["a1", "a2", "a3"]);
  assert.deepEqual(onboarding.map((d) => d.id), ["b1", "b2"]);
  assert.equal(FIXTURE.filter((d) => inPipeline(d.pipelineName, null)).length, 5, "nothing picked = all pipelines");
  assert.equal(sales.filter((d) => d.status === "open").reduce((s, d) => s + d.value, 0), 400);
  assert.equal(onboarding.filter((d) => d.status === "open").reduce((s, d) => s + d.value, 0), 70, "open money changes with the pick");
  assert.equal(pipeKey("  Sales   Pipeline "), "sales pipeline");
});

test("the pipeline in an address is cleaned, and a different pipeline never shares a cached answer", () => {
  assert.equal(pipelineParam(new URLSearchParams("pipeline=%20Sales%20Pipeline%20")), "Sales Pipeline");
  assert.equal(pipelineParam(new URLSearchParams("pipeline=")), null);
  assert.equal(pipelineParam(new URLSearchParams("")), null);
  assert.equal(pipelineParam(new URLSearchParams(`pipeline=${"x".repeat(500)}`))?.length, 120);
  assert.notEqual(pipelineCacheKey("Sales Pipeline"), pipelineCacheKey("Onboarding"));
  assert.notEqual(pipelineCacheKey("Sales Pipeline"), pipelineCacheKey(null));
  assert.equal(pipelineCacheKey("Sales  PIPELINE"), pipelineCacheKey("sales pipeline"));
});

test("the stored-answer key differs by pipeline, account, date window and person", () => {
  const key = (who: string, qs: string) => answerStoreKey(who, "/api/app/pipeline3", new URLSearchParams(qs));
  const base = "part=overview&from=2026-10-15&to=2026-11-13";
  const k = key("agency::u1", base);
  assert.notEqual(key("agency::u1", `${base}&pipeline=Sales%20Pipeline`), k, "a picked pipeline");
  assert.notEqual(key("agency::u1", `${base}&pipeline=Sales%20Pipeline`), key("agency::u1", `${base}&pipeline=Onboarding`), "another pipeline");
  assert.notEqual(key("agency::u1", `${base}&location=abc123`), k, "an account");
  assert.notEqual(key("agency::u1", "part=overview&from=2026-11-07&to=2026-11-13"), k, "another window");
  assert.notEqual(key("location::u9", base), k, "another role or person");
  assert.equal(key("agency::u1", `${base}&_r=1`), k, "only the retry marker is ignored");
});

test("every Pipeline part asks the server with the picked pipeline, and with none when nothing is picked", () => {
  const F = { from: "2026-10-15", to: "2026-11-13", locationId: "", pipeline: "Sales Pipeline", ownerId: "", q: "" };
  for (const p of ["money-flow", "overview", "needs-attention", "won-lost", "forecast", "people", "sources", "stage-history", "health", "proof", "list", "accounts"] as const) {
    assert.equal(new URL("http://x/" + queryOf(p, F, {})).searchParams.get("pipeline"), "Sales Pipeline", p);
    assert.equal(new URL("http://x/" + queryOf(p, { ...F, pipeline: "" }, {})).searchParams.get("pipeline"), null, p);
  }
});

test("the older screens inside Pipeline get the same pick through one helper", () => {
  assert.equal(pickPath("stale?left=0", { pipeline: "Sales Pipeline", location: "abc123" }), "stale?left=0&pipeline=Sales+Pipeline&location=abc123");
  assert.equal(pickPath("hygiene", { pipeline: "Onboarding", location: "" }), "hygiene?pipeline=Onboarding");
  assert.equal(pickPath("hygiene", { pipeline: "", location: "" }), "hygiene");
  assert.equal(pickPath("export/stale", null), "export/stale");
});

test("a saved view or pasted link brings the pipeline and account back (address round trip)", () => {
  const h = hashWithPick("#pipeline?r.page=30d", { pipeline: "Sales Pipeline", location: "abc123" });
  assert.deepEqual(pickFromHash(h), { pipeline: "Sales Pipeline", location: "abc123" });
  assert.ok(h.includes("r.page=30d"), "the date bar's own parameter is kept");
  assert.equal(hashWithPick(h, { pipeline: "", location: "" }), "#pipeline?r.page=30d", "All pipelines takes it out again");
  assert.deepEqual(pickFromHash("#pipeline?pa=%3Cscript%3E"), { pipeline: "", location: "" }, "an odd account id is dropped");
});

test("every deal reader behind Pipeline takes the pick: SQL fragments, routes and screens", () => {
  for (const [file, needle] of [
    ["lib/analytics/pipeline-queries.ts", "inPipelineSql(db, pipeline)"], ["lib/analytics/queries.ts", "inPipelineSql(db, o.pipeline)"], ["lib/analytics/deal-trust-queries.ts", "inPipelineSql(db, pipeline)"],
    ["lib/analytics/comms-queries.ts", "inPipelineSql(db, pipeline)"], ["lib/analytics/cash-queries.ts", "flagsInPipeline(db, pipeline)"], ["lib/analytics/pipeline3-queries.ts", "pipe = f.pipeline ? slug(f.pipeline) : null"],
  ] as const) assert.ok(src(file).includes(needle), `${file} filters by pipeline`);
  const router = src("lib/api/router.ts");
  assert.ok((router.match(/pipelineParam\(ctx\.url\.searchParams\)/g) ?? []).length >= 7, "stale, pipelines, hygiene, pipeline-intel, both exports and the quiet deals read the pick");
  assert.ok(src("lib/api/cash-routes.ts").includes("pipelineParam(sp)"), "Slipping reads the pick");
  assert.ok(src("lib/api/pipeline-board-routes.ts").includes("pipelineParam("), "the board reads the pick");
  assert.ok(src("lib/api/pipeline3-routes.ts").includes("f.pipeline ?? null"), "Proof reads the pick");
  const mod = src("app/app/views/pl3/module.tsx");
  assert.ok(mod.includes("<PickContext.Provider") && mod.includes("pipeline={filters.pipeline}"), "the module hands the pick to Slipping and the older screens");
  for (const f of ["deals.tsx", "pipeline.tsx", "pipeline-board.tsx", "quiet-deals.tsx"]) assert.ok(src(`app/app/views/${f}`).includes("pickPath("), `${f} follows the pick`);
  assert.ok(src("app/app/views/pl3/history-funnel.tsx").includes("filters.pipeline"), "Step history starts from the pick");
});

// ---------------- B: dates ----------------
const TODAY = "2026-11-13", NOW = lagos("2026-11-13T15:05:30");
const PRESETS: RangePreset[] = ["today", "yday", "7d", "30d", "90d", "week", "lweek", "month", "lmonth"];
const EXPECTED: Record<string, [string, string]> = {
  today: ["2026-11-13", "2026-11-13"], yday: ["2026-11-12", "2026-11-12"], "7d": ["2026-11-07", "2026-11-13"], "30d": ["2026-10-15", "2026-11-13"], "90d": ["2026-08-16", "2026-11-13"],
  week: ["2026-11-09", "2026-11-13"], lweek: ["2026-11-02", "2026-11-08"], month: ["2026-11-01", "2026-11-13"], lmonth: ["2026-10-01", "2026-10-31"],
};

test("each date preset is the window DATE_RULES names, and every server reader reads exactly that window", () => {
  for (const preset of PRESETS) {
    const r = resolveRange({ preset, compare: "none" }, TODAY, NOW);
    assert.deepEqual([r.current.from, r.current.to], EXPECTED[preset], preset);
    const q = new URLSearchParams(windowQuery(r)), from = q.get("from"), to = q.get("to");
    const readers = {
      pipeline: parsePlWindow(from, to, NOW), clients: clientsWindow(from, to, NOW), people: peopleWindow(from, to, NOW), appointments: parseApptWindow(from, to, NOW),
    };
    for (const [name, w] of Object.entries(readers)) {
      assert.equal(localDay(w.from.getTime()), r.current.from, `${name} ${preset} first day`);
      assert.equal(localDay(w.to.getTime() - 1), r.current.to, `${name} ${preset} last day`);
      assert.equal(w.days, r.current.days, `${name} ${preset} length matches the label`);
      assert.equal(w.problem, null, `${name} ${preset}`);
    }
    const s = speedWindow(from, to, NOW);
    assert.ok(s.ok, `speed ${preset}`);
    if (s.ok) { assert.equal(localDay(s.win.fromMs), r.current.from); assert.equal(localDay(s.win.toMs - 1), r.current.to); }
  }
});

test("two different windows give two different server windows (a reader that ignored from/to would give the same)", () => {
  const a = resolveRange({ preset: "7d", compare: "none" }, TODAY, NOW), b = resolveRange({ preset: "90d", compare: "none" }, TODAY, NOW);
  const wa = parsePlWindow(a.current.from, a.current.to, NOW), wb = parsePlWindow(b.current.from, b.current.to, NOW);
  assert.notEqual(wa.from.getTime(), wb.from.getTime());
  assert.equal(wa.to.getTime(), wb.to.getTime(), "both end at the end of today");
  assert.notEqual(answerStoreKey("a", "/api/app/speed", new URLSearchParams(windowQuery(a))), answerStoreKey("a", "/api/app/speed", new URLSearchParams(windowQuery(b))), "stored answers key on the exact window");
});

test("Compare is the previous period of the same length, for every preset", () => {
  for (const preset of PRESETS) {
    const r = resolveRange({ preset, compare: "previous" }, TODAY, NOW);
    assert.ok(r.compare, preset);
    assert.equal(r.compare!.days, r.current.days, `${preset} same length`);
    const prevEnd = localDay(Date.parse(`${r.current.from}T00:00:00Z`) - 86_400_000);
    assert.equal(r.compare!.to, prevEnd, `${preset} ends the day before the window starts`);
  }
});

test("a custom range (the From and To boxes) is read as written", () => {
  const r = resolveRange({ preset: "custom", from: "2026-10-01", to: "2026-10-30", compare: "none" }, TODAY, NOW);
  assert.deepEqual([r.current.from, r.current.to, r.current.days], ["2026-10-01", "2026-10-30", 30]);
  const w = clientsWindow("2026-10-01", "2026-10-30", NOW);
  assert.equal(w.days, 30);
});

test("every page that draws the bar's dates says what they change; pages with their own line are listed, pages 'as of now' say so", () => {
  const RANGE = ["speed", "appointments", "overview", "leads", "deals", "team", "pipeline", "accounts", "clients", "today", "myday", "payments", "finance", "meetings-list", "workflows"];
  for (const v of RANGE) {
    assert.ok(barMode(v) === "range" || barMode(v) === "dates", `${v} draws dates`);
    assert.ok(DATES_NOTES[v], `${v} has an entry saying what the dates do`);
    const line = datesNote(v, "16 Aug to 13 Nov", "Lagos");
    if (DATES_NOTES[v].own) assert.equal(line, null, `${v} prints its own line`);
    else { assert.ok(line!.startsWith("Dates: 16 Aug to 13 Nov, Lagos time."), v); assert.ok(line!.includes("as of now") || DATES_NOTES[v].now === null, v); }
  }
  for (const v of ["audit", "cleanup", "duplicates", "search", "calls", "inbox", "onboarding", "email"]) assert.equal(barMode(v), "now", `${v} is live, as of right now`);
  for (const f of ["cleanup-routes.ts", "dq-routes.ts", "duplicates-routes.ts"]) assert.ok(!/parse\w*Window|get\("from"\)/.test(src(`lib/api/${f}`)), `${f} is as of now: it does not read the dates`);
  for (const f of ["pipeline3-routes.ts", "speed-routes.ts", "appointments3-routes.ts", "clients3-routes.ts", "people3-routes.ts", "today3-routes.ts", "bf-routes.ts"]) assert.ok(/parse\w*Window|get\("from"\)|windowOf/.test(src(`lib/api/${f}`)), `${f} reads the bar's dates`);
});

test("the Appointments screen-only date choices are labelled as such and the bar is the first choice", () => {
  const f = src("app/app/views/ap3/filters-bar.tsx");
  assert.ok(f.includes("Dates from the bar:") && f.includes("This screen only"), "labelled");
  assert.ok(!f.includes("/^lastd+$/"), "the last-N pattern is a real pattern (it had lost its backslash)");
  assert.ok(f.includes("Booked on: any day"));
});

test("one label, one definition for show rate", () => {
  assert.ok(src("app/app/views/appointment-insights.tsx").includes("Show rate of marked appointments is"));
  assert.ok(src("app/app/views/ap3/filters-bar.tsx").includes("true show rate"));
  assert.ok(readFileSync(new URL("../../../docs/METRICS.md", import.meta.url), "utf8").includes("Show rate labels"), "documented in METRICS.md");
});
