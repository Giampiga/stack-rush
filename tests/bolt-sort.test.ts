import assert from "node:assert/strict";
import test from "node:test";
import {
  BOLT_CAPACITY,
  BOLT_COLORS,
  BOLT_SORT_TIERS,
  SPARE_BOLT_COUNT,
  boltSortProgress,
  createBoltSortPuzzle,
  getBoltSortProgress,
  isBoltLocked,
  isBoltSortSolved,
  isValidBoltSortBoard,
  listLegalBoltMoves,
  moveBoltNut,
  type BoltSortBoard,
  type BoltSortTierId,
} from "../lib/bolt-sort.ts";

const twoColorBoard: BoltSortBoard = [
  ["coral", "coral", "orange", "orange"],
  ["orange", "orange"],
  ["coral", "coral"],
  [],
];

function failureReason(
  result: ReturnType<typeof moveBoltNut>,
): string {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("Expected the move to fail");
  return result.reason;
}

test("validates color counts, capacity, and the two-spare-bolt shape", () => {
  assert.equal(isValidBoltSortBoard(twoColorBoard), true);
  assert.equal(isValidBoltSortBoard(twoColorBoard, 2), true);
  assert.equal(isValidBoltSortBoard(twoColorBoard, 3), false);
  assert.equal(
    isValidBoltSortBoard([["red", "red", "red", "red"], []]),
    false,
  );
  assert.equal(
    isValidBoltSortBoard([
      ["red", "red", "red", "red", "red"],
      ["blue", "blue", "blue"],
      [],
      [],
    ]),
    false,
  );
  assert.equal(isValidBoltSortBoard([["red"], ["red"], [], []]), false);
  assert.equal(isValidBoltSortBoard("not a board"), false);

  const wrongTierPalette = BOLT_COLORS.slice(1, 7).map((color) =>
    Array(BOLT_CAPACITY).fill(color),
  );
  wrongTierPalette.push([], []);
  assert.equal(isValidBoltSortBoard(wrongTierPalette), true);
  assert.equal(isValidBoltSortBoard(wrongTierPalette, 6), false);
  assert.equal(isValidBoltSortBoard(twoColorBoard, Number.NaN), false);
});

test("moves exactly one matching top nut and never mutates its input", () => {
  const original = twoColorBoard.map((bolt) => [...bolt]);
  const result = moveBoltNut(original, 0, 1);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(original, twoColorBoard);
  assert.equal(result.color, "orange");
  assert.deepEqual(result.board, [
    ["coral", "coral", "orange"],
    ["orange", "orange", "orange"],
    ["coral", "coral"],
    [],
  ]);
  assert.equal(result.board[0].length, original[0].length - 1);
  assert.equal(result.board[1].length, original[1].length + 1);
});

test("rejects empty, same, mismatched, full, invalid, and locked moves", () => {
  assert.equal(failureReason(moveBoltNut(twoColorBoard, 3, 0)), "source-empty");
  assert.equal(failureReason(moveBoltNut(twoColorBoard, 0, 0)), "same-bolt");
  assert.equal(
    failureReason(moveBoltNut(twoColorBoard, 0, 2)),
    "color-mismatch",
  );
  assert.equal(
    failureReason(moveBoltNut(twoColorBoard, -1, 2)),
    "invalid-bolt",
  );

  const first = moveBoltNut(twoColorBoard, 0, 1);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = moveBoltNut(first.board, 0, 1);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(isBoltLocked(second.board[1]), true);
  assert.equal(
    failureReason(moveBoltNut(second.board, 1, 3)),
    "source-locked",
  );
  assert.equal(
    failureReason(moveBoltNut(second.board, 2, 1)),
    "target-full",
  );

  const malformed = [["coral"], [], [], []] as BoltSortBoard;
  assert.equal(
    failureReason(moveBoltNut(malformed, 0, 1)),
    "invalid-board",
  );
});

test("detects solved boards and reports completed-color progress", () => {
  const unsolvedProgress = getBoltSortProgress(twoColorBoard);
  assert.deepEqual(unsolvedProgress, {
    percent: 0,
    completedColors: 0,
    totalColors: 2,
    completedPieces: 0,
    totalPieces: 8,
  });
  assert.equal(boltSortProgress(twoColorBoard), 0);
  assert.equal(isBoltSortSolved(twoColorBoard), false);

  const halfDone: BoltSortBoard = [
    ["coral", "coral", "coral", "coral"],
    ["orange", "orange"],
    ["orange", "orange"],
    [],
  ];
  assert.equal(boltSortProgress(halfDone), 50);
  assert.equal(isBoltSortSolved(halfDone), false);

  const solved: BoltSortBoard = [
    ["coral", "coral", "coral", "coral"],
    ["orange", "orange", "orange", "orange"],
    [],
    [],
  ];
  assert.equal(boltSortProgress(solved), 100);
  assert.equal(isBoltSortSolved(solved), true);
});

test("generation is deterministic by tier and seed", () => {
  const first = createBoltSortPuzzle("classic", "same-seed");
  const second = createBoltSortPuzzle("classic", "same-seed");
  const different = createBoltSortPuzzle("classic", "different-seed");

  assert.deepEqual(first, second);
  assert.notDeepEqual(first.board, different.board);
  assert.equal(JSON.parse(JSON.stringify(first)).seed, "same-seed");
  assert.throws(() => createBoltSortPuzzle("quick", Number.NaN));
});

test("every tier generates deeply mixed bolts and exactly two empty bolts", () => {
  const tiers = Object.keys(BOLT_SORT_TIERS) as BoltSortTierId[];

  for (const tier of tiers) {
    const puzzle = createBoltSortPuzzle(tier, `invariants-${tier}`);
    const config = BOLT_SORT_TIERS[tier];
    const counts = new Map<string, number>();

    assert.equal(puzzle.version, 1);
    assert.equal(puzzle.capacity, BOLT_CAPACITY);
    assert.equal(puzzle.colorCount, config.colorCount);
    assert.equal(puzzle.board.length, config.colorCount + SPARE_BOLT_COUNT);
    assert.equal(puzzle.board.filter((bolt) => bolt.length === 0).length, 2);
    assert.equal(isValidBoltSortBoard(puzzle.board, config.colorCount), true);
    assert.equal(isBoltSortSolved(puzzle.board), false);
    assert.equal(puzzle.solution.length, config.shuffleMoves);
    const filledBolts = puzzle.board.filter((bolt) => bolt.length > 0);
    assert.equal(filledBolts.length, config.colorCount);
    assert.ok(filledBolts.every((bolt) => bolt.length === BOLT_CAPACITY));
    assert.ok(filledBolts.every((bolt) => new Set(bolt).size === 3));
    assert.ok(
      filledBolts.every((bolt) =>
        bolt.every((color, index) => index === 0 || color !== bolt[index - 1]),
      ),
    );

    for (const bolt of puzzle.board) {
      assert.ok(bolt.length <= BOLT_CAPACITY);
      for (const color of bolt) {
        assert.ok(BOLT_COLORS.includes(color as (typeof BOLT_COLORS)[number]));
        counts.set(color, (counts.get(color) ?? 0) + 1);
      }
    }
    assert.equal(counts.size, config.colorCount);
    assert.ok([...counts.values()].every((count) => count === BOLT_CAPACITY));
  }
});

test("the generated solution replays through the public move function", () => {
  for (const tier of ["quick", "classic", "expert", "endurance"] as const) {
    const puzzle = createBoltSortPuzzle(tier, `solve-${tier}`);
    let board = puzzle.board;

    assert.ok(puzzle.solution.length > 0);
    for (const [index, move] of puzzle.solution.entries()) {
      const result = moveBoltNut(board, move.from, move.to);
      assert.equal(
        result.ok,
        true,
        `${tier} solution move ${index + 1} should be legal`,
      );
      if (!result.ok) break;
      board = result.board;
    }

    assert.equal(isBoltSortSolved(board), true);
    assert.equal(boltSortProgress(board), 100);
  }
});

test("listed moves are exactly the accepted public moves", () => {
  const board = createBoltSortPuzzle("quick", "legal-moves").board;
  const listed = new Set(
    listLegalBoltMoves(board).map(({ from, to }) => `${from}:${to}`),
  );

  for (let from = 0; from < board.length; from += 1) {
    for (let to = 0; to < board.length; to += 1) {
      assert.equal(
        listed.has(`${from}:${to}`),
        moveBoltNut(board, from, to).ok,
      );
    }
  }
});

test("generated boards remain solvable across tiers and a spread of seeds", () => {
  for (const tier of Object.keys(BOLT_SORT_TIERS) as BoltSortTierId[]) {
    for (let seed = 0; seed < 250; seed += 1) {
      const puzzle = createBoltSortPuzzle(tier, seed);
      let board = puzzle.board;
      let progress = boltSortProgress(board, puzzle.colorCount);
      const filledBolts = board.filter((bolt) => bolt.length > 0);

      assert.equal(isValidBoltSortBoard(board, puzzle.colorCount), true);
      assert.equal(board.filter((bolt) => bolt.length === 0).length, 2);
      assert.equal(filledBolts.length, puzzle.colorCount);
      assert.ok(filledBolts.every((bolt) => new Set(bolt).size === 3));
      assert.ok(
        filledBolts.every((bolt) =>
          bolt.every(
            (color, index) => index === 0 || color !== bolt[index - 1],
          ),
        ),
      );

      for (const move of puzzle.solution) {
        const before = JSON.stringify(board);
        const result = moveBoltNut(
          board,
          move.from,
          move.to,
          puzzle.colorCount,
        );
        assert.equal(
          result.ok,
          true,
          `${tier} seed ${seed} must keep a legal solve path`,
        );
        if (!result.ok) break;
        assert.equal(JSON.stringify(board), before);
        const nextProgress = boltSortProgress(
          result.board,
          puzzle.colorCount,
        );
        assert.ok(nextProgress >= progress);
        progress = nextProgress;
        board = result.board;
      }

      assert.equal(
        isBoltSortSolved(board),
        true,
        `${tier} seed ${seed} must solve`,
      );
    }
  }
});
