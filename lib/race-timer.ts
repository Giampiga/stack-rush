export function raceElapsed(
  startsAt: number,
  now: number,
  finishedAt?: number | null,
  optimisticFinishedAt?: number | null,
): number {
  const stoppedAt = finishedAt ?? optimisticFinishedAt ?? now;
  return Math.max(0, stoppedAt - startsAt);
}

export function formatRaceTime(milliseconds: number): string {
  const tenths = Math.round(Math.max(0, milliseconds) / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = ((tenths % 600) / 10).toFixed(1);
  return minutes ? `${minutes}:${seconds.padStart(4, "0")}` : `${seconds}s`;
}
