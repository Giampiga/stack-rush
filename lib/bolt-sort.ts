export const BOLT_CAPACITY = 4;
export const SPARE_BOLT_COUNT = 2;

export const BOLT_COLORS = [
  "coral",
  "orange",
  "amber",
  "lemon",
  "lime",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "cobalt",
  "violet",
  "purple",
  "magenta",
  "rose",
  "berry",
] as const;

export type BoltColor = (typeof BOLT_COLORS)[number];
export type BoltSortBoard = BoltColor[][];
export type BoltSortTierId =
  | "quick"
  | "classic"
  | "expert"
  | "endurance";

export interface BoltSortTier {
  id: BoltSortTierId;
  label: string;
  colorCount: number;
  shuffleMoves: number;
}

export const BOLT_SORT_TIERS: Record<BoltSortTierId, BoltSortTier> = {
  quick: {
    id: "quick",
    label: "Quick",
    colorCount: 6,
    shuffleMoves: 24,
  },
  classic: {
    id: "classic",
    label: "Classic",
    colorCount: 9,
    shuffleMoves: 36,
  },
  expert: {
    id: "expert",
    label: "Expert",
    colorCount: 12,
    shuffleMoves: 48,
  },
  endurance: {
    id: "endurance",
    label: "Endurance",
    colorCount: 15,
    shuffleMoves: 60,
  },
};

export const SORT_LEVELS = BOLT_SORT_TIERS;

export interface BoltSortMove {
  from: number;
  to: number;
}

export type BoltSortMoveFailureReason =
  | "invalid-board"
  | "invalid-bolt"
  | "same-bolt"
  | "source-empty"
  | "source-locked"
  | "target-full"
  | "color-mismatch";

export type BoltSortMoveResult =
  | {
      ok: true;
      board: BoltSortBoard;
      color: BoltColor;
      from: number;
      to: number;
    }
  | {
      ok: false;
      board: BoltSortBoard;
      reason: BoltSortMoveFailureReason;
      message: string;
    };

export interface BoltSortProgress {
  percent: number;
  completedColors: number;
  totalColors: number;
  completedPieces: number;
  totalPieces: number;
}

export interface BoltSortPuzzle {
  version: 1;
  tier: BoltSortTierId;
  seed: string;
  colorCount: number;
  capacity: number;
  board: BoltSortBoard;
  solution: BoltSortMove[];
}

function cloneBoard(board: BoltSortBoard): BoltSortBoard {
  return board.map((bolt) => [...bolt]);
}

function boardSignature(board: BoltSortBoard): string {
  return JSON.stringify(board);
}

function allSameColor(bolt: readonly BoltColor[]): boolean {
  return bolt.length > 0 && bolt.every((color) => color === bolt[0]);
}

export function isBoltLocked(bolt: readonly BoltColor[]): boolean {
  return bolt.length === BOLT_CAPACITY && allSameColor(bolt);
}

export const isLockedBolt = isBoltLocked;

export function isValidBoltSortBoard(
  value: unknown,
  expectedColorCount?: number,
): value is BoltSortBoard {
  if (!Array.isArray(value)) return false;

  const counts = new Map<BoltColor, number>();
  let pieceCount = 0;

  for (const bolt of value) {
    if (!Array.isArray(bolt) || bolt.length > BOLT_CAPACITY) return false;

    for (const color of bolt) {
      if (
        typeof color !== "string" ||
        !BOLT_COLORS.includes(color as BoltColor)
      ) {
        return false;
      }
      const boltColor = color as BoltColor;
      counts.set(boltColor, (counts.get(boltColor) ?? 0) + 1);
      pieceCount += 1;
    }
  }

  const colorCount = counts.size;
  if (colorCount === 0) return false;
  if (
    expectedColorCount !== undefined &&
    (!Number.isInteger(expectedColorCount) || colorCount !== expectedColorCount)
  ) {
    return false;
  }

  if (value.length !== colorCount + SPARE_BOLT_COUNT) return false;
  if (pieceCount !== colorCount * BOLT_CAPACITY) return false;

  if (expectedColorCount !== undefined) {
    const expectedColors = BOLT_COLORS.slice(0, expectedColorCount);
    if (
      expectedColors.length !== expectedColorCount ||
      expectedColors.some((color) => !counts.has(color))
    ) {
      return false;
    }
  }

  return [...counts.values()].every((count) => count === BOLT_CAPACITY);
}

export function moveBoltNut(
  board: BoltSortBoard,
  from: number,
  to: number,
  expectedColorCount?: number,
): BoltSortMoveResult {
  if (!isValidBoltSortBoard(board, expectedColorCount)) {
    return {
      ok: false,
      board,
      reason: "invalid-board",
      message: "The board state is invalid.",
    };
  }

  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= board.length ||
    to >= board.length
  ) {
    return {
      ok: false,
      board,
      reason: "invalid-bolt",
      message: "Choose a bolt on the board.",
    };
  }

  if (from === to) {
    return {
      ok: false,
      board,
      reason: "same-bolt",
      message: "Choose two different bolts.",
    };
  }

  const source = board[from];
  const target = board[to];
  const movingColor = source.at(-1);

  if (movingColor === undefined) {
    return {
      ok: false,
      board,
      reason: "source-empty",
      message: "That bolt is empty.",
    };
  }

  if (isBoltLocked(source)) {
    return {
      ok: false,
      board,
      reason: "source-locked",
      message: "That completed bolt is locked.",
    };
  }

  if (target.length >= BOLT_CAPACITY) {
    return {
      ok: false,
      board,
      reason: "target-full",
      message: "That bolt is full.",
    };
  }

  const targetColor = target.at(-1);
  if (targetColor !== undefined && targetColor !== movingColor) {
    return {
      ok: false,
      board,
      reason: "color-mismatch",
      message: "The top colors must match.",
    };
  }

  const nextBoard = cloneBoard(board);
  nextBoard[from].pop();
  nextBoard[to].push(movingColor);

  return {
    ok: true,
    board: nextBoard,
    color: movingColor,
    from,
    to,
  };
}

export const moveBoltPiece = moveBoltNut;
export const moveBoltSortNut = moveBoltNut;

export function listLegalBoltMoves(
  board: BoltSortBoard,
  expectedColorCount?: number,
): BoltSortMove[] {
  if (!isValidBoltSortBoard(board, expectedColorCount)) return [];

  const moves: BoltSortMove[] = [];
  for (let from = 0; from < board.length; from += 1) {
    for (let to = 0; to < board.length; to += 1) {
      if (moveBoltNut(board, from, to, expectedColorCount).ok) {
        moves.push({ from, to });
      }
    }
  }
  return moves;
}

export function isBoltSortSolved(
  board: BoltSortBoard,
  expectedColorCount?: number,
): boolean {
  return (
    isValidBoltSortBoard(board, expectedColorCount) &&
    board.every((bolt) => bolt.length === 0 || isBoltLocked(bolt))
  );
}

export function getBoltSortProgress(
  board: BoltSortBoard,
  expectedColorCount?: number,
): BoltSortProgress {
  if (!isValidBoltSortBoard(board, expectedColorCount)) {
    return {
      percent: 0,
      completedColors: 0,
      totalColors: 0,
      completedPieces: 0,
      totalPieces: 0,
    };
  }

  const totalColors = new Set(board.flat()).size;
  const completedColors = board.filter(isBoltLocked).length;
  const completedPieces = completedColors * BOLT_CAPACITY;
  const totalPieces = totalColors * BOLT_CAPACITY;

  return {
    percent: Math.round((completedColors / totalColors) * 100),
    completedColors,
    totalColors,
    completedPieces,
    totalPieces,
  };
}

export function boltSortProgress(
  board: BoltSortBoard,
  expectedColorCount?: number,
): number {
  return getBoltSortProgress(board, expectedColorCount).percent;
}

export function getBoltSortTier(tier: BoltSortTierId): BoltSortTier {
  const config = BOLT_SORT_TIERS[tier];
  if (!config) throw new Error(`Unknown bolt-sort tier: ${tier}`);
  return { ...config };
}

function canonicalSeed(seed: string | number): string {
  if (typeof seed === "number" && !Number.isFinite(seed)) {
    throw new Error("seed must be a finite number or string");
  }
  return String(seed);
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function solvedBoard(colorCount: number): BoltSortBoard {
  const board = BOLT_COLORS.slice(0, colorCount).map((color) =>
    Array<BoltColor>(BOLT_CAPACITY).fill(color),
  );
  board.push([], []);
  return board;
}

function shuffleIndices(values: number[], random: () => number): number[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
}

function applyReverseShuffle(
  board: BoltSortBoard,
  solution: BoltSortMove[],
  from: number,
  to: number,
): { board: BoltSortBoard; solution: BoltSortMove[] } {
  const color = board[from].at(-1);
  if (color === undefined || board[to].length >= BOLT_CAPACITY) {
    throw new Error("Invalid reverse shuffle");
  }

  const shuffled = cloneBoard(board);
  shuffled[from].pop();
  shuffled[to].push(color);

  const inverse = moveBoltNut(shuffled, to, from);
  if (!inverse.ok || boardSignature(inverse.board) !== boardSignature(board)) {
    throw new Error("Reverse shuffle did not produce a legal inverse move");
  }

  return {
    board: shuffled,
    solution: [{ from: to, to: from }, ...solution],
  };
}

// Local indices 0-2 are solved color bolts and 3-4 are empty workspaces.
// This reverse-legal template finishes with three full bolts containing three
// colors and four alternating segments each; local bolts 1 and 2 become the
// next pair of empty workspaces. Reversing these moves produces a valid public
// solution because applyReverseShuffle verifies every inverse as it builds.
const DEEP_GROUP_REVERSE_SHUFFLES: readonly BoltSortMove[] = [
  { from: 2, to: 4 },
  { from: 1, to: 4 },
  { from: 2, to: 3 },
  { from: 0, to: 3 },
  { from: 0, to: 4 },
  { from: 0, to: 4 },
  { from: 2, to: 0 },
  { from: 1, to: 3 },
  { from: 4, to: 0 },
  { from: 1, to: 0 },
  { from: 2, to: 3 },
  { from: 1, to: 4 },
];

export function createBoltSortPuzzle(
  tier: BoltSortTierId,
  seed: string | number,
): BoltSortPuzzle {
  const config = getBoltSortTier(tier);
  const normalizedSeed = canonicalSeed(seed);
  const random = seededRandom(`${tier}:${normalizedSeed}`);
  let board = solvedBoard(config.colorCount);
  let solution: BoltSortMove[] = [];
  const colorBolts = shuffleIndices(
    Array.from({ length: config.colorCount }, (_, index) => index),
    random,
  );
  let workspaces = [config.colorCount, config.colorCount + 1];
  if (random() < 0.5) workspaces.reverse();

  // Every tier has a color count divisible by three. Each template application
  // consumes three untouched solved bolts and the current two empty workspaces,
  // then produces three densely mixed bolts and a new pair of empty workspaces.
  for (let index = 0; index < colorBolts.length; index += 3) {
    const [first, second, third] = colorBolts.slice(index, index + 3);
    const localBolts = [first, second, third, ...workspaces];

    for (const shuffle of DEEP_GROUP_REVERSE_SHUFFLES) {
      ({ board, solution } = applyReverseShuffle(
        board,
        solution,
        localBolts[shuffle.from],
        localBolts[shuffle.to],
      ));
    }
    workspaces = random() < 0.5 ? [second, third] : [third, second];
  }

  const emptyCount = board.filter((bolt) => bolt.length === 0).length;
  if (
    solution.length !== config.shuffleMoves ||
    emptyCount !== SPARE_BOLT_COUNT ||
    isBoltSortSolved(board)
  ) {
    throw new Error("Unable to generate a shuffled bolt-sort puzzle");
  }

  return {
    version: 1,
    tier,
    seed: normalizedSeed,
    colorCount: config.colorCount,
    capacity: BOLT_CAPACITY,
    board,
    solution,
  };
}

export function createBoltSortBoard(
  tier: BoltSortTierId,
  seed: string | number,
): BoltSortBoard {
  return createBoltSortPuzzle(tier, seed).board;
}
