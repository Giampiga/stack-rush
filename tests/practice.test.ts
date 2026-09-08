import assert from "node:assert/strict";
import test from "node:test";
import { createBoltSortPuzzle, isBoltSortSolved, moveBoltSortNut } from "../lib/bolt-sort.ts";
import { createHanoiBoard, hanoiHint, moveHanoiDisk, type HanoiBoard } from "../lib/hanoi.ts";
import { dailyChallenge, dailyStreak, parsePracticeRecords, parsePracticeSave, practiceBest, sortPracticeHint, type PracticeRecord, type SavedPractice } from "../lib/practice.ts";

test("daily puzzles are stable for a UTC day and rotate at midnight", () => {
  const start = Date.parse("2026-09-04T00:00:00Z");
  const first = dailyChallenge(start);
  assert.deepEqual(dailyChallenge(start + 86_399_999), first);
  assert.notEqual(dailyChallenge(start + 86_400_000).seed, first.seed);
  assert.equal(new Set(Array.from({ length: 4 }, (_, index) => dailyChallenge(start + index * 86_400_000).tier)).size, 4);
});

test("guided sort hints solve every tier using legal group moves", () => {
  for (const tier of ["quick", "classic", "expert", "endurance"] as const) {
    const config = { mode: "sort" as const, tier, seed: `hint:${tier}` };
    const puzzle = createBoltSortPuzzle(tier, config.seed);
    let board = puzzle.board;
    for (let step = 0; step < puzzle.solution.length; step += 1) {
      const hint = sortPracticeHint(config, board);
      assert.ok(hint, `Missing hint on ${tier} step ${step}`);
      const result = moveBoltSortNut(board, hint.from, hint.to, puzzle.colorCount);
      assert.ok(result.ok);
      board = result.board;
    }
    assert.equal(isBoltSortSolved(board, puzzle.colorCount), true);
    assert.equal(sortPracticeHint(config, board), null);
  }
});

test("Hanoi hints reduce the exact distance for every legal 3–6 ring state", () => {
  for (const count of [3, 4, 5, 6]) {
    const goal: HanoiBoard = [[], [], Array.from({ length: count }, (_, index) => count - index)];
    const queue: HanoiBoard[] = [goal];
    const distances = new Map([[JSON.stringify(goal), 0]]);
    for (let index = 0; index < queue.length; index += 1) {
      const board = queue[index];
      const distance = distances.get(JSON.stringify(board))!;
      for (let from = 0; from < 3; from += 1) for (let to = 0; to < 3; to += 1) {
        const result = moveHanoiDisk(board, from, to, count);
        if (!result.ok || distances.has(JSON.stringify(result.board))) continue;
        distances.set(JSON.stringify(result.board), distance + 1);
        queue.push(result.board);
      }
    }
    assert.equal(queue.length, 3 ** count);
    for (const board of queue) {
      const distance = distances.get(JSON.stringify(board))!;
      const hint = hanoiHint(board, count);
      if (!distance) { assert.equal(hint, null); continue; }
      assert.ok(hint);
      const result = moveHanoiDisk(board, hint.from, hint.to, count);
      assert.ok(result.ok);
      assert.equal(distances.get(JSON.stringify(result.board)), distance - 1);
    }
  }
});

const freshSave = (): SavedPractice => ({ version: 1, config: { mode: "hanoi", tier: "quick", seed: "save:test" }, board: createHanoiBoard(3), moves: 0, elapsed: 1200, assisted: false, history: [] });

test("saved practice round-trips legal moves and rejects malformed or completed sessions", () => {
  const saved = freshSave();
  assert.deepEqual(parsePracticeSave(JSON.stringify(saved)), saved);
  const moved = moveHanoiDisk(saved.board as HanoiBoard, 0, 2, 3);
  assert.ok(moved.ok);
  const after = { ...saved, board: moved.board, moves: 1, history: [saved.board] };
  assert.deepEqual(parsePracticeSave(JSON.stringify(after)), after);
  for (const invalid of [null, {}, { ...saved, moves: -1 }, { ...saved, elapsed: null }, { ...saved, config: { ...saved.config, tier: "toString" } },
    { ...saved, board: [[], [], [3, 2, 1]] }, { ...saved, board: moved.board },
    { ...after, board: [[3], [2, 1], []] }, { ...saved, history: [saved.board] }, { ...saved, config: { ...saved.config, dailyDate: "2026-02-30" } }]) {
    assert.equal(parsePracticeSave(JSON.stringify(invalid)), null, JSON.stringify(invalid));
  }
  assert.equal(parsePracticeSave("not json"), null);
  assert.equal(parsePracticeSave("x".repeat(500_001)), null);
});

test("daily resume validates the date, seed and difficulty as one challenge", () => {
  const config = dailyChallenge(Date.parse("2026-09-04T05:00:00Z"));
  const puzzle = createBoltSortPuzzle(config.tier as "quick", config.seed);
  const saved = { ...freshSave(), config, board: puzzle.board };
  assert.deepEqual(parsePracticeSave(JSON.stringify(saved)), saved);
  assert.equal(parsePracticeSave(JSON.stringify({ ...saved, config: { ...config, seed: "other" } })), null);
});

function record(overrides: Partial<PracticeRecord> = {}): PracticeRecord {
  return { id: "one", mode: "hanoi", tier: "quick", moves: 7, elapsed: 7000, completedAt: Date.parse("2026-09-04T08:00:00Z"), assisted: false, ...overrides };
}

test("records ignore assists for bests, keep time and moves independent, and reject corruption", () => {
  const records = [record(), record({ id: "two", moves: 9, elapsed: 6000 }), record({ id: "three", elapsed: 1000, moves: 2, assisted: true })];
  assert.deepEqual(practiceBest(records, "hanoi", "quick"), { time: 6000, moves: 7, solves: 2 });
  assert.equal(practiceBest(records, "sort", "quick"), null);
  assert.deepEqual(parsePracticeRecords(JSON.stringify([...records, records[0], record({ id: "bad", moves: -1 }), null])), records);
  assert.deepEqual(parsePracticeRecords("{"), []);
});

test("daily streak tolerates an unfinished today and counts a repeated day once", () => {
  const now = Date.parse("2026-09-04T10:00:00Z");
  const records = [record({ dailyDate: "2026-09-03" }), record({ dailyDate: "2026-09-02" }), record({ dailyDate: "2026-09-03" })];
  assert.equal(dailyStreak(records, now), 2);
  assert.equal(dailyStreak([...records, record({ dailyDate: "2026-09-04" })], now), 3);
  assert.equal(dailyStreak(records, now + 86_400_000), 0);
});
