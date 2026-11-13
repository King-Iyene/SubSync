import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localToMs, localHM, windowAtMs, rollupFromDay, rollupUntilDay, localDay } from "../design/zone.ts";
import { decodeRange, encodeRange, resolveRange } from "../design/range.ts";
import { windowQuery, checkCustom } from "../design/page-range.ts";
import { parsePlWindow } from "../analytics/pipeline3-intel.ts";
import { parseWindow as clientsWindow } from "../analytics/clients3-intel.ts";
import { parseWindow as speedWindow } from "../analytics/speed-window.ts";
import { queryOf } from "../../app/app/views/pl3/adapters.ts";

const lagos = (iso: string) => Date.parse(`${iso}+01:00`);
const NOW = lagos("2026-11-13T15:05:30");

test("a Lagos day window starts at Lagos midnight, and its rollup keys are the Lagos days", () => {
  const p = parsePlWindow("2026-11-13", "2026-11-13", NOW);
  assert.equal(p.from.getTime(), lagos("2026-11-13T00:00:00"));
  assert.equal(p.to.getTime(), lagos("2026-11-14T00:00:00"));
  assert.equal(rollupFromDay(p.from.getTime()), "2026-11-13");
  assert.equal(rollupUntilDay(p.to.getTime()), "2026-11-14");
  const c = clientsWindow("2026-11-09", "2026-11-13", NOW);
  assert.equal(localDay(c.from.getTime()), "2026-11-09");
  assert.equal(c.days, 5);
});

test("hour windows: the last hour and a custom range with times", () => {
  const r = resolveRange({ preset: "1h", compare: "none" }, localDay(NOW), NOW);
  assert.deepEqual(r.at, { fromTime: "14:06", toTime: "15:05" });
  assert.equal(windowQuery(r), "from=2026-11-13&to=2026-11-13&fromTime=14:06&toTime=15:05");
  const w = windowAtMs("2026-11-13", "2026-11-13", r.at!.fromTime, r.at!.toTime)!;
  assert.equal(w.toMs - w.fromMs, 3_600_000);
  const day = resolveRange({ preset: "24h", compare: "previous" }, localDay(NOW), NOW);
  assert.deepEqual([day.current.from, day.current.to, day.compare], ["2026-11-12", "2026-11-13", null]);
  const cust = parsePlWindow("2026-11-12", "2026-11-12", NOW, { fromTime: "09:00", toTime: "17:30" });
  assert.equal(cust.from.getTime(), lagos("2026-11-12T09:00:00"));
  assert.equal(cust.to.getTime(), lagos("2026-11-12T17:31:00"));
  assert.equal(rollupUntilDay(cust.to.getTime()), "2026-11-13", "a rollup counts the whole day the hours touch: day precision");
  const s = speedWindow("2026-11-12", "2026-11-12", NOW, { fromTime: "09:00", toTime: "17:30" });
  assert.ok(s.ok && s.win.toMs - s.win.fromMs === 511 * 60_000);
  assert.equal(localHM(lagos("2026-11-13T00:05:00")), "00:05");
  assert.equal(localToMs("2026-11-13", "24:00"), null);
});

test("the address keeps times, bad times are refused, an end time in the future is refused", () => {
  const spec = { preset: "custom" as const, from: "2026-11-12", to: "2026-11-12", fromTime: "09:00", toTime: "17:30", compare: "none" as const };
  assert.equal(encodeRange(spec), "custom:2026-11-12~2026-11-12@09:00-17:30");
  assert.deepEqual(decodeRange("custom:2026-11-12~2026-11-12@09:00-17:30"), spec);
  assert.equal(decodeRange("custom:2026-11-12~2026-11-12@25:00-17:30"), null);
  assert.equal(decodeRange("1h")?.preset, "1h");
  assert.match(checkCustom("2026-11-12", "2026-11-12", "2026-11-13", "18:00", "09:00") ?? "", /before the start time/);
  assert.match(resolveRange({ ...spec, from: "2026-11-13", to: "2026-11-13", toTime: "23:00" }, "2026-11-13", NOW).problem ?? "", /not happened/);
});

test("Pipeline reads dates only from the bar: no date, no days fallback; hours travel", () => {
  const f = { locationId: "", pipeline: "", ownerId: "", q: "" };
  const none = new URL("http://x/" + queryOf("overview", f)).searchParams;
  assert.equal(none.get("from"), null);
  assert.equal(none.get("to"), null);
  const timed = new URL("http://x/" + queryOf("overview", { ...f, from: "2026-11-13", to: "2026-11-13", fromTime: "14:06", toTime: "15:05" })).searchParams;
  assert.equal(timed.get("fromTime"), "14:06");
});

test("narrowing the window changes won and lost, never open money (source rules)", () => {
  const rd = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  assert.doesNotMatch(rd("app/app/views/pl3/adapters.ts"), /new Date\(|toISOString/);
  assert.doesNotMatch(rd("app/app/views/pl3/data.tsx"), /f\.days|days: 45/);
  assert.match(rd("app/app/views/pl3/sections.tsx"), /as of now/);
});
