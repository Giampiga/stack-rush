import { BOLT_SORT_TIERS, createBoltSortPuzzle, isValidBoltSortBoard, isBoltSortSolved, moveBoltSortNut, type BoltSortBoard, type BoltSortTierId } from "./bolt-sort.ts";
import { HANOI_LEVELS, createHanoiBoard, moveHanoiDisk, isHanoiSolved, isValidHanoiBoard, type HanoiBoard, type HanoiTierId } from "./hanoi.ts";

export type PracticeConfig = {
  mode: "sort" | "hanoi";
  tier: BoltSortTierId | HanoiTierId;
  seed: string;
  dailyDate?: string;
};

export type SavedPractice = {
  version: 1;
  config: PracticeConfig;
  board: BoltSortBoard | HanoiBoard;
  moves: number;
  elapsed: number;
  assisted: boolean;
  history: Array<BoltSortBoard | HanoiBoard>;
};

export type PracticeRecord = {
  id: string;
  mode: PracticeConfig["mode"];
  tier: PracticeConfig["tier"];
  elapsed: number;
  moves: number;
  assisted: boolean;
  completedAt: number;
  dailyDate?: string;
};

export const PRACTICE_SAVE_KEY = "stack-rush:practice:v1";
export const PRACTICE_RECORDS_KEY = "stack-rush:records:v1";

export function dailyChallenge(now = Date.now()): PracticeConfig {
  const day = Math.floor(now / 86_400_000);
  const dailyDate = new Date(now).toISOString().slice(0, 10);
  const tiers: BoltSortTierId[] = ["quick", "classic", "expert", "endurance"];
  const tier = tiers[((day % tiers.length) + tiers.length) % tiers.length];
  return { mode: "sort", tier, seed: `daily:v1:${dailyDate}:${tier}`, dailyDate };
}

export function practiceBest(records: PracticeRecord[], mode: PracticeConfig["mode"], tier: PracticeConfig["tier"]) {
  const eligible = records.filter((record) => record.mode === mode && record.tier === tier && !record.assisted);
  if (!eligible.length) return null;
  return { time: Math.min(...eligible.map((record) => record.elapsed)), moves: Math.min(...eligible.map((record) => record.moves)), solves: eligible.length };
}

export function dailyStreak(records: PracticeRecord[], now = Date.now()): number {
  const dates = new Set(records.map((record) => record.dailyDate).filter(Boolean));
  let day = Math.floor(now / 86_400_000);
  if (!dates.has(new Date(day * 86_400_000).toISOString().slice(0, 10))) day -= 1;
  let count = 0;
  while (dates.has(new Date(day * 86_400_000).toISOString().slice(0, 10))) { count += 1; day -= 1; }
  return count;
}

function validTier(mode: unknown, tier: unknown): boolean {
  return typeof tier === "string" && (mode === "sort"
    ? Object.hasOwn(BOLT_SORT_TIERS, tier)
    : mode === "hanoi" && Object.hasOwn(HANOI_LEVELS, tier));
}

function validDate(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

const validCount = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
const validElapsed = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 31_536_000_000;

export function parsePracticeSave(raw: string | null): SavedPractice | null {
  if (!raw || raw.length > 500_000) return null;
  try {
    const saved = JSON.parse(raw) as SavedPractice;
    if (!saved || saved.version !== 1 || !saved.config || !validTier(saved.config.mode, saved.config.tier) ||
      typeof saved.config.seed !== "string" || saved.config.seed.length > 160 || !validDate(saved.config.dailyDate) ||
      !validCount(saved.moves) || !validElapsed(saved.elapsed) || typeof saved.assisted !== "boolean" ||
      !Array.isArray(saved.history) || saved.history.length > 200 || saved.history.length > saved.moves) return null;
    const validate = (board: unknown) => saved.config.mode === "sort"
      ? isValidBoltSortBoard(board, BOLT_SORT_TIERS[saved.config.tier as BoltSortTierId].colorCount)
      : isValidHanoiBoard(board, HANOI_LEVELS[saved.config.tier as HanoiTierId].diskCount);
    if (!validate(saved.board) || !saved.history.every(validate)) return null;
    const solved = saved.config.mode === "sort"
      ? isBoltSortSolved(saved.board as BoltSortBoard, BOLT_SORT_TIERS[saved.config.tier as BoltSortTierId].colorCount)
      : isHanoiSolved(saved.board as HanoiBoard, HANOI_LEVELS[saved.config.tier as HanoiTierId].diskCount);
    if (solved) return null;
    const initial = saved.config.mode === "sort"
      ? createBoltSortPuzzle(saved.config.tier as BoltSortTierId, saved.config.seed).board
      : createHanoiBoard(HANOI_LEVELS[saved.config.tier as HanoiTierId].diskCount);
    if (saved.moves === 0 && JSON.stringify(initial) !== JSON.stringify(saved.board)) return null;
    if (saved.history.length === saved.moves && saved.moves > 0 && JSON.stringify(initial) !== JSON.stringify(saved.history[0])) return null;
    const states = [...saved.history, saved.board];
    for (let index = 1; index < states.length; index += 1) {
      const before = states[index - 1];
      const after = states[index];
      const from = before.findIndex((stack, peg) => stack.length > after[peg].length);
      const to = before.findIndex((stack, peg) => stack.length < after[peg].length);
      const move = saved.config.mode === "sort"
        ? moveBoltSortNut(before as BoltSortBoard, from, to, BOLT_SORT_TIERS[saved.config.tier as BoltSortTierId].colorCount)
        : moveHanoiDisk(before as HanoiBoard, from, to, HANOI_LEVELS[saved.config.tier as HanoiTierId].diskCount);
      if (!move.ok || JSON.stringify(move.board) !== JSON.stringify(after)) return null;
    }
    if (saved.config.dailyDate) {
      const expected = dailyChallenge(Date.parse(`${saved.config.dailyDate}T00:00:00Z`));
      if (saved.config.mode !== expected.mode || saved.config.tier !== expected.tier || saved.config.seed !== expected.seed) return null;
    }
    return saved;
  } catch { return null; }
}

export function parsePracticeRecords(raw: string | null): PracticeRecord[] {
  if (!raw || raw.length > 100_000) return [];
  try {
    const records: unknown = JSON.parse(raw);
    if (!Array.isArray(records)) return [];
    const seen = new Set<string>();
    return records.filter((record): record is PracticeRecord => {
      if (!record || typeof record !== "object") return false;
      const r = record as PracticeRecord;
      if (typeof r.id !== "string" || r.id.length > 100 || seen.has(r.id) || !validTier(r.mode, r.tier) ||
        !validCount(r.moves) || !validElapsed(r.elapsed) || typeof r.assisted !== "boolean" ||
        !Number.isSafeInteger(r.completedAt) || r.completedAt <= 0 || !validDate(r.dailyDate)) return false;
      seen.add(r.id);
      return true;
    }).slice(0, 100);
  } catch { return []; }
}

/** Follow the generator's proven solution only when the current board is on it. */
export function sortPracticeHint(config: PracticeConfig, current: BoltSortBoard) {
  const puzzle = createBoltSortPuzzle(config.tier as BoltSortTierId, config.seed);
  const signature = JSON.stringify(current);
  let board = puzzle.board;
  for (const move of puzzle.solution) {
    if (JSON.stringify(board) === signature) return move;
    const result = moveBoltSortNut(board, move.from, move.to, puzzle.colorCount);
    if (!result.ok) return null;
    board = result.board;
  }
  return null;
}
