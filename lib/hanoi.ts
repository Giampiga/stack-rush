export type HanoiBoard = [number[], number[], number[]];

export type HanoiMoveResult =
  | { ok: true; board: HanoiBoard; disk: number }
  | { ok: false; board: HanoiBoard; reason: string };

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

  const disks: number[] = [];
  for (const peg of value) {
    if (!Array.isArray(peg)) return false;
    for (let index = 0; index < peg.length; index += 1) {
      const disk = peg[index];
      if (!Number.isInteger(disk) || disk < 1 || disk > diskCount) return false;
      if (index > 0 && peg[index - 1] <= disk) return false;
      disks.push(disk);
    }
  }

  return (
    disks.length === diskCount &&
    new Set(disks).size === diskCount &&
    disks.sort((a, b) => a - b).every((disk, index) => disk === index + 1)
  );
}

export function moveHanoiDisk(
  board: HanoiBoard,
  from: number,
  to: number,
  diskCount: number,
): HanoiMoveResult {
  if (!isValidHanoiBoard(board, diskCount)) {
    return { ok: false, board, reason: "The board state is invalid." };
  }

  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    from > 2 ||
    to < 0 ||
    to > 2 ||
    from === to
  ) {
    return { ok: false, board, reason: "Choose two different pegs." };
  }

  const movingDisk = board[from].at(-1);
  if (movingDisk === undefined) {
    return { ok: false, board, reason: "That peg is empty." };
  }

  const targetDisk = board[to].at(-1);
  if (targetDisk !== undefined && targetDisk < movingDisk) {
    return {
      ok: false,
      board,
      reason: "A larger ring cannot sit on a smaller one.",
    };
  }

  const nextBoard = board.map((peg) => [...peg]) as HanoiBoard;
  nextBoard[from].pop();
  nextBoard[to].push(movingDisk);
  return { ok: true, board: nextBoard, disk: movingDisk };
}

export function isHanoiSolved(board: HanoiBoard, diskCount: number): boolean {
  return isValidHanoiBoard(board, diskCount) && board[2].length === diskCount;
}

export function perfectMoveCount(diskCount: number): number {
  return 2 ** diskCount - 1;
}

export function solvedProgress(board: HanoiBoard, diskCount: number): number {
  if (!isValidHanoiBoard(board, diskCount)) return 0;
  return Math.round((board[2].length / diskCount) * 100);
}
