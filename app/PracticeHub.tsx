"use client";

import { formatRaceTime as timeLabel } from "@/lib/race-timer";
import { BOLT_SORT_TIERS } from "@/lib/bolt-sort";
import { HANOI_LEVELS, type HanoiTierId } from "@/lib/hanoi";
import { dailyStreak, practiceBest, type PracticeConfig, type PracticeRecord, type SavedPractice } from "@/lib/practice";

export function SessionStart({ saved, disabled, onPlay, onResume, onHelp }: {
  saved: SavedPractice | null; disabled: boolean; onPlay: () => void; onResume: () => void; onHelp: () => void;
}) {
  return <div className="session-start">
    <div className="session-start-actions">
      <button className="practice-button" type="button" disabled={disabled} onClick={onPlay}>PLAY SOLO <span aria-hidden="true">→</span></button>
      <button className="text-action" type="button" onClick={onHelp}>Learn the rules</button>
    </div>
    <p>Make it a warm-up. Undo, hints, and pause are here when you need them.</p>
    {saved ? <button className="resume-session" type="button" disabled={disabled} onClick={onResume}>
      <span><b>CONTINUE YOUR PUZZLE</b><small>{saved.config.mode === "sort" ? "Nuts & Bolts" : "Tower of Hanoi"} · {saved.moves} moves · {timeLabel(saved.elapsed)}{saved.config.dailyDate ? ` · Daily ${saved.config.dailyDate}` : ""}</small></span><span aria-hidden="true">↗</span>
    </button> : null}
  </div>;
}

export function DailyCard({ config, records, disabled, onPlay, now }: {
  config: PracticeConfig; records: PracticeRecord[]; disabled: boolean; onPlay: () => void; now: number;
}) {
  const tier = BOLT_SORT_TIERS[config.tier as keyof typeof BOLT_SORT_TIERS];
  const done = records.some((record) => record.dailyDate === config.dailyDate);
  const streak = dailyStreak(records, now);
  return <div className="daily-card">
    <div className="daily-heading"><span className="section-kicker">THE DAILY SORT</span><span className="daily-status">{done ? "✓ SOLVED" : "NEW PUZZLE"}</span></div>
    <h2>One scramble.<br />A fresh start.</h2>
    <p>Everyone gets the same puzzle. Come back tomorrow for a new one.</p>
    <div className="daily-spec"><strong>{tier.colorCount}</strong><span>COLORS<br /><b>{tier.label.toUpperCase()}</b></span><span className="daily-streak"><b>{streak}</b> DAY STREAK</span></div>
    <button type="button" onClick={onPlay} disabled={disabled}>{done ? "PLAY TODAY AGAIN" : "PLAY TODAY’S PUZZLE"}<span aria-hidden="true">↗</span></button>
    <small>{config.dailyDate} · Resets at midnight UTC</small>
  </div>;
}

export function PersonalBests({ records, mode, tier }: { records: PracticeRecord[]; mode: PracticeConfig["mode"]; tier: PracticeConfig["tier"] }) {
  const best = practiceBest(records, mode, tier);
  const label = mode === "sort" ? BOLT_SORT_TIERS[tier as keyof typeof BOLT_SORT_TIERS].label : HANOI_LEVELS[tier as HanoiTierId].label;
  return <section className="personal-bests" aria-labelledby="personal-bests-title">
    <div><span className="section-kicker">YOUR SOLO PROGRESS</span><h2 id="personal-bests-title">Beat your best.</h2><p>{mode === "sort" ? "Nuts & Bolts" : "Tower of Hanoi"} · {label}</p></div>
    <div className="best-values"><div><b>{best ? timeLabel(best.time) : "—"}</b><span>FASTEST FINISH</span></div><div><b>{best?.moves ?? "—"}</b><span>FEWEST MOVES</span></div><div><b>{records.length}</b><span>SAVED SOLVES</span></div></div>
    <p className="records-note">{best ? "Best unassisted runs from your last 100 solves." : "Finish without hints or undo to set a personal best."} Saved on this device.</p>
    {records.length ? <details className="recent-runs"><summary>Recent finishes <span aria-hidden="true">↓</span></summary><ol>{records.slice(0, 5).map((record) => <li key={record.id}><span><b>{record.mode === "sort" ? "Nuts & Bolts" : "Tower of Hanoi"}</b><small>{record.tier} · {record.assisted ? "assisted" : "unassisted"}{record.dailyDate ? " · daily" : ""}</small></span><span><b>{timeLabel(record.elapsed)}</b><small>{record.moves} moves</small></span></li>)}</ol></details> : null}
  </section>;
}
