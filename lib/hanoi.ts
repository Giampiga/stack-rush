export type HanoiBoard = [number[], number[], number[]];

export type HanoiTierId = "quick" | "classic" | "expert" | "master";

export const HANOI_LEVELS = {
  quick: { label: "Quick", diskCount: 3, par: 7 },
  classic: { label: "Classic", diskCount: 4, par: 15 },
  expert: { label: "Expert", diskCount: 5, par: 31 },
  master: { label: "Master", diskCount: 6, par: 63 },
} as const satisfies Record<
  HanoiTierId,
  { label: string; diskCount: number; par: number }
>;

export type HanoiMoveResult =
  | { ok: true; board: HanoiBoard; disk: number }
  | { ok: false; board: HanoiBoard; message: string };

export function createHanoiBoard(diskCount: number): HanoiBoard {
  if (!Number.isInteger(diskCount) || diskCount < 3 || diskCount > 7) {
    throw new Error("diskCount must be an integer between 3 and 7");
  }
  return [
    Array.from({ length: diskCount }, (_, index) => diskCount - index),
    [],
    [],
  ];
}

export function isValidHanoiBoard(
  value: unknown,
  diskCount: number,
): value is HanoiBoard {
  if (!Array.isArray(value) || value.length !== 3) return false;
  const disks = value.flat();
  if (
    disks.length !== diskCount ||
    disks.some((disk) => !Number.isInteger(disk) || disk < 1 || disk > diskCount)
  ) {
    return false;
  }
  if (new Set(disks).size !== diskCount) return false;
  return value.every((peg) =>
    Array.isArray(peg) && peg.every((disk, index) => index === 0 || peg[index - 1] > disk),
  );
}

export function moveHanoiDisk(
  board: HanoiBoard,
  from: number,
  to: number,
  diskCount: number,
): HanoiMoveResult {
  if (!isValidHanoiBoard(board, diskCount)) {
    return { ok: false, board, message: "The board state is invalid." };
  }
  if (![from, to].every((peg) => Number.isInteger(peg) && peg >= 0 && peg < 3) || from === to) {
    return { ok: false, board, message: "Choose a different tower." };
  }
  const source = board[from];
  const destination = board[to];
  const disk = source.at(-1);
  if (disk === undefined) {
    return { ok: false, board, message: "That tower is empty." };
  }
  const destinationTop = destination.at(-1);
  if (destinationTop !== undefined && destinationTop < disk) {
    return { ok: false, board, message: "A larger ring cannot sit on a smaller one." };
  }
  const next = board.map((peg) => [...peg]) as HanoiBoard;
  next[from].pop();
  next[to].push(disk);
  return { ok: true, board: next, disk };
}

export function isHanoiSolved(board: HanoiBoard, diskCount: number): boolean {
  return isValidHanoiBoard(board, diskCount) && board[2].length === diskCount;
}

export function hanoiProgress(board: HanoiBoard, diskCount: number): number {
  return Math.round((board[2].length / diskCount) * 100);
}

/** The next move on a shortest route to peg three, even after a detour. */
export function hanoiHint(board: HanoiBoard, diskCount: number): { from: number; to: number; disk: number } | null {
  if (!isValidHanoiBoard(board, diskCount)) return null;
  const positions: number[] = [];
  board.forEach((peg, index) => peg.forEach((disk) => { positions[disk] = index; }));
  function next(disk: number, target: number): { from: number; to: number; disk: number } | null {
    if (!disk) return null;
    const from = positions[disk];
    if (from === target) return next(disk - 1, target);
    return next(disk - 1, 3 - from - target) ?? { from, to: target, disk };
  }
  return next(diskCount, 2);
}
