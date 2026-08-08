import assert from "node:assert/strict";
import test from "node:test";
import {
  createHanoiBoard,
  isHanoiSolved,
  isValidHanoiBoard,
  moveHanoiDisk,
  perfectMoveCount,
  solvedProgress,
  type HanoiBoard,
} from "../lib/hanoi.ts";

test("creates a canonical Tower of Hanoi board", () => {
  assert.deepEqual(createHanoiBoard(3), [[3, 2, 1], [], []]);
  assert.deepEqual(createHanoiBoard(5), [[5, 4, 3, 2, 1], [], []]);
  assert.throws(() => createHanoiBoard(2));
  assert.throws(() => createHanoiBoard(8));
});

test("rejects malformed and physically impossible boards", () => {
  assert.equal(isValidHanoiBoard([[3, 2, 1], [], []], 3), true);
  assert.equal(isValidHanoiBoard([[3, 1], [2], []], 3), true);
  assert.equal(isValidHanoiBoard([[1, 2, 3], [], []], 3), false);
  assert.equal(isValidHanoiBoard([[3, 2], [2], []], 3), false);
  assert.equal(isValidHanoiBoard([[3, 2, 1], []], 3), false);
  assert.equal(isValidHanoiBoard([[3, 2, 1], [], [], []], 3), false);
});

test("accepts only legal top-ring moves and never mutates its input", () => {
  const original = createHanoiBoard(3);
  const first = moveHanoiDisk(original, 0, 2, 3);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(original, [[3, 2, 1], [], []]);
  assert.deepEqual(first.board, [[3, 2], [], [1]]);
  assert.equal(first.disk, 1);

  const blocked = moveHanoiDisk(first.board, 0, 2, 3);
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.board, first.board);

  const empty = moveHanoiDisk(first.board, 1, 0, 3);
  assert.equal(empty.ok, false);
  const samePeg = moveHanoiDisk(first.board, 0, 0, 3);
  assert.equal(samePeg.ok, false);
  const badPeg = moveHanoiDisk(first.board, -1, 2, 3);
  assert.equal(badPeg.ok, false);
});

test("solves the three-ring puzzle on exactly the seventh optimal move", () => {
  const sequence = [
    [0, 2],
    [0, 1],
    [2, 1],
    [0, 2],
    [1, 0],
    [1, 2],
    [0, 2],
  ] as const;
  let board: HanoiBoard = createHanoiBoard(3);

  sequence.forEach(([from, to], index) => {
    const result = moveHanoiDisk(board, from, to, 3);
    assert.equal(result.ok, true, `move ${index + 1} should be legal`);
    if (!result.ok) return;
    board = result.board;
    assert.equal(isHanoiSolved(board, 3), index === sequence.length - 1);
  });

  assert.deepEqual(board, [[], [], [3, 2, 1]]);
  assert.equal(perfectMoveCount(3), 7);
  assert.equal(solvedProgress(board, 3), 100);
});

test("every accepted move across all valid three-ring placements moves one disk", () => {
  const validBoards: HanoiBoard[] = [];
  for (let first = 0; first < 3; first += 1) {
    for (let second = 0; second < 3; second += 1) {
      for (let third = 0; third < 3; third += 1) {
        const board: HanoiBoard = [[], [], []];
        [first, second, third].forEach((peg, diskIndex) => {
          board[peg].unshift(diskIndex + 1);
        });
        if (isValidHanoiBoard(board, 3)) validBoards.push(board);
      }
    }
  }

  assert.ok(validBoards.length > 0);
  for (const board of validBoards) {
    for (let from = 0; from < 3; from += 1) {
      for (let to = 0; to < 3; to += 1) {
        const result = moveHanoiDisk(board, from, to, 3);
        if (!result.ok) continue;
        const before = board.flat();
        const after = result.board.flat();
        assert.deepEqual([...before].sort(), [...after].sort());
        assert.equal(result.board[from].length, board[from].length - 1);
        assert.equal(result.board[to].length, board[to].length + 1);
      }
    }
  }
});
