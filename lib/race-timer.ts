export function raceElapsed(
  startsAt: number,
  now: number,
  finishedAt?: number | null,
  optimisticFinishedAt?: number | null,
): number {
  const stoppedAt = finishedAt ?? optimisticFinishedAt ?? now;
  return Math.max(0, stoppedAt - startsAt);
}
