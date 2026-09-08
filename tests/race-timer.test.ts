import assert from "node:assert/strict";
import test from "node:test";
import { raceElapsed, formatRaceTime } from "../lib/race-timer.ts";

test("race timer advances while playing", () => {
  assert.equal(raceElapsed(1_000, 2_750), 1_750);
});

test("race timer freezes immediately at an optimistic local finish", () => {
  assert.equal(raceElapsed(1_000, 9_000, null, 3_125), 2_125);
});

test("authoritative finish replaces the optimistic timestamp", () => {
  assert.equal(raceElapsed(1_000, 9_000, 3_100, 3_125), 2_100);
});

test("time formatting rounds across minute boundaries without displaying 60 seconds", () => {
  assert.equal(formatRaceTime(59_949), "59.9s");
  assert.equal(formatRaceTime(59_999), "1:00.0");
  assert.equal(formatRaceTime(119_999), "2:00.0");
  assert.equal(formatRaceTime(-100), "0.0s");
});
