import test from "node:test";
import assert from "node:assert/strict";
import {
  HANOI_LEVELS,
  createHanoiBoard,
  hanoiProgress,
  isHanoiSolved,
  isValidHanoiBoard,
  moveHanoiDisk,
} from "../lib/hanoi.ts";

test("Hanoi tiers expose their exact minimum move counts", () => {
  for (const level of Object.values(HANOI_LEVELS)) {
    assert.equal(level.par, 2 ** level.diskCount - 1);
  }
});

test("Hanoi only permits a top ring onto an empty peg or larger ring", () => {
  const start = createHanoiBoard(3);
  const first = moveHanoiDisk(start, 0, 2, 3);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const blocked = moveHanoiDisk(first.board, 0, 2, 3);
  assert.equal(blocked.ok, false);
  assert.deepEqual(start, [[3, 2, 1], [], []]);
});

test("a perfect three-ring game validates, progresses, and solves", () => {
  let board = createHanoiBoard(3);
  for (const [from, to] of [[0, 2], [0, 1], [2, 1], [0, 2], [1, 0], [1, 2], [0, 2]] as const) {
    const result = moveHanoiDisk(board, from, to, 3);
    assert.equal(result.ok, true);
    if (result.ok) board = result.board;
  }
  assert.equal(isValidHanoiBoard(board, 3), true);
  assert.equal(hanoiProgress(board, 3), 100);
  assert.equal(isHanoiSolved(board, 3), true);
});
