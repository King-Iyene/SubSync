import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildReplay, rebuiltMoves, type RebuildRow } from "../analytics/pipeline3-intel.ts";
import { buildReplayFrames, nextFrame, pressPlay, tickReplay, replayHasMovement, type ReplayState } from "../design/river-replay.ts";
import type { PlReplayDay, PlStage } from "../analytics/pipeline3-types-interim.ts";

const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"];
// Today: 2 deals open in step B, 1 won (was in B), 1 lost (was in B). History does not exist: only the deals' own dates.
const rows: RebuildRow[] = [
  { day: "2026-11-01", ev: "created", moved: true, status: null, stageKey: "B", firstKey: "A", count: 3, value: 300 },
  { day: "2026-11-02", ev: "created", moved: false, status: null, stageKey: "B", firstKey: "A", count: 1, value: 100 },
  { day: "2026-11-03", ev: "stage", moved: true, status: null, stageKey: "B", firstKey: "A", count: 3, value: 300 },
  { day: "2026-11-04", ev: "status", moved: false, status: "won", stageKey: "B", firstKey: "A", count: 1, value: 100 },
  { day: "2026-11-05", ev: "status", moved: false, status: "lost", stageKey: "B", firstKey: "A", count: 1, value: 100 },
];
const current = [{ stageId: "A", count: 0, value: 0 }, { stageId: "B", count: 2, value: 200 }];

test("rebuilt moves: created, moved and closed deals become day moves", () => {
  const mv = rebuiltMoves(rows);
  assert.equal(mv.length, 5);
  assert.deepEqual(mv[0], { day: "2026-11-01", from: null, to: "A", status: null, count: 3, value: 300 });
  assert.deepEqual(mv[2], { day: "2026-11-03", from: "A", to: "B", status: null, count: 3, value: 300 });
  assert.equal(mv[3].status, "won");
  // a row whose step is unknown is skipped, never guessed
  assert.equal(rebuiltMoves([{ ...rows[0], stageKey: null }]).length, 0);
});

test("rebuilt frames: last day equals today's stock, no stock goes negative, deals walk A to B", () => {
  const frames = buildReplay(days, current, rebuiltMoves(rows));
  assert.equal(frames.length, 5);
  const last = frames[4];
  assert.equal(last.stages.find((s) => s.stageId === "B")?.count, 2);
  for (const f of frames) for (const s of f.stages) assert.ok(s.count >= 0 && s.value >= 0);
  assert.equal(frames[0].stages.find((s) => s.stageId === "A")?.count, 3);
  assert.equal(frames[2].stages.find((s) => s.stageId === "A")?.count, 0);
});

const stage = (i: number): PlStage => ({ id: i ? "B" : "A", name: `S${i}`, order: i, count: 0, valueCents: 0, staleCount: 0, staleValueCents: 0, medianDwellDays: null, normalDwellDays: null, lostCount: 0, lostValueCents: 0 });
const asDays = (): PlReplayDay[] => buildReplay(days, current, rebuiltMoves(rows)).map((f) => ({
  date: f.day, stageCounts: ["A", "B"].map((id) => f.stages.find((s) => s.stageId === id)?.count ?? 0), stageValueCents: ["A", "B"].map((id) => (f.stages.find((s) => s.stageId === id)?.value ?? 0) * 100),
  wonCents: f.wonValue * 100, lostCents: f.lostValue * 100, wonCount: f.wonCount, lostCount: f.lostCount,
  moves: [...f.moved.map((m) => ({ from: m.from === null ? null : m.from === "A" ? 0 : 1, to: m.to === "A" ? 0 : 1, status: null, count: m.count, valueCents: m.value * 100 })), ...(f.closed ?? []).map((m) => ({ from: m.from === "A" ? 0 : 1, to: null, status: m.status, count: m.count, valueCents: m.value * 100 }))],
}));

test("the rebuilt replay has movement and won/lost only climb, never past the final totals", () => {
  const d = asDays();
  assert.equal(replayHasMovement(d), true);
  const fr = buildReplayFrames(d, [stage(0), stage(1)], false);
  const wonSeq = fr.map((f) => f.wonCount), lostSeq = fr.map((f) => f.lostCount);
  for (let i = 1; i < fr.length; i++) { assert.ok(wonSeq[i] >= wonSeq[i - 1]); assert.ok(lostSeq[i] >= lostSeq[i - 1]); assert.ok(fr[i].wonCents >= fr[i - 1].wonCents); }
  const final = fr[fr.length - 1];
  assert.equal(final.wonCount, 1); assert.equal(final.lostCount, 1);
  for (const f of fr) { assert.ok(f.wonCount <= final.wonCount); assert.ok(f.lostCount <= final.lostCount); assert.ok(f.wonCents <= final.wonCents); }
});

test("with no deal dated inside the window there is no movement (honest: nothing to replay)", () => {
  const frames = buildReplay(days, current, rebuiltMoves([]));
  assert.equal(frames.length, 5);
  const d: PlReplayDay[] = frames.map((f) => ({ date: f.day, stageCounts: [0, 2], stageValueCents: [0, 20000], wonCents: 0, lostCents: 0, moves: [] }));
  assert.equal(replayHasMovement(d), false);
});

test("pressing Replay: starts on the first day, plays on every tick to the last day, then stops", () => {
  const total = 5;
  let st: ReplayState = { frame: null, playing: false };
  st = pressPlay(st, total, false);
  assert.deepEqual(st, { frame: 0, playing: true });
  const seen: Array<number | null> = [st.frame];
  for (let i = 0; i < 10 && st.playing; i++) { st = tickReplay(st, total); seen.push(st.frame); }
  assert.deepEqual(seen, [0, 1, 2, 3, 4]);
  assert.equal(st.playing, false);
  // pressing again after the end restarts from the first day
  assert.deepEqual(pressPlay(st, total, false), { frame: 0, playing: true });
});

test("pause keeps the day, resume continues from it, and a tick while paused does nothing", () => {
  let st: ReplayState = { frame: 2, playing: true };
  st = pressPlay(st, 5, false);
  assert.deepEqual(st, { frame: 2, playing: false });
  assert.deepEqual(tickReplay(st, 5), st);
  assert.deepEqual(pressPlay(st, 5, false), { frame: 2, playing: true });
});

test("reduced motion steps one day per press and never plays by itself", () => {
  let st: ReplayState = { frame: null, playing: false };
  st = pressPlay(st, 3, true); assert.deepEqual(st, { frame: 0, playing: false });
  st = pressPlay(st, 3, true); assert.deepEqual(st, { frame: 1, playing: false });
  st = pressPlay(st, 3, true); st = pressPlay(st, 3, true); assert.deepEqual(st, { frame: 2, playing: false });
  assert.equal(nextFrame(2, 3).done, true);
});

test("no frames: pressing does nothing and never throws", () => {
  const st: ReplayState = { frame: null, playing: false };
  assert.deepEqual(pressPlay(st, 0, false), st);
});

test("wiring: the Replay button drives pressPlay, the timer drives tickReplay, controls disabled say why, rebuilt line is shown", () => {
  const src = readFileSync(new URL("../../app/app/views/pl3/money-flow.tsx", import.meta.url), "utf8");
  assert.match(src, /pressPlay\(\{ frame, playing \}, frames\.length, reduced\)/);
  assert.match(src, /tickReplay\(\{ frame, playing: true \}, frames\.length\)/);
  assert.match(src, /onClick=\{play\}[^>]*disabled=\{!replayOn\}[^>]*title=\{replayOn \? undefined : replayWhy\}/);
  assert.match(src, /Rebuilt from deal dates; /);
  assert.match(src, /data-testid="pl-scrub"/);
});
