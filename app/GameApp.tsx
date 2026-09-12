"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BOLT_CAPACITY,
  BOLT_SORT_TIERS,
  boltSortProgress,
  createBoltSortPuzzle,
  getBoltSortProgress,
  isBoltSortSolved,
  isLockedBolt,
  listLegalBoltMoves,
  moveBoltSortNut,
  topBoltGroupSize,
  type BoltColor,
  type BoltSortBoard,
  type BoltSortTierId,
} from "@/lib/bolt-sort";
import {
  HANOI_LEVELS,
  createHanoiBoard,
  hanoiProgress,
  hanoiHint,
  isHanoiSolved,
  moveHanoiDisk,
  type HanoiBoard,
  type HanoiTierId,
} from "@/lib/hanoi";
import { raceElapsed, formatRaceTime as formatTime } from "@/lib/race-timer";
import { dailyChallenge, parsePracticeSave, parsePracticeRecords, sortPracticeHint, PRACTICE_SAVE_KEY, PRACTICE_RECORDS_KEY, type PracticeConfig, type PracticeRecord, type SavedPractice } from "@/lib/practice";
import { DailyCard, PersonalBests, SessionStart } from "./PracticeHub";

type GameMode = "sort" | "hanoi";

type Player = {
  id: string;
  name: string;
  hue: number;
  wins: number;
  races: number;
};

type OnlinePlayer = Player & { available: boolean };

type Invite = {
  id: string;
  mode: GameMode;
  tier: BoltSortTierId | HanoiTierId;
  colorCount: number | null;
  diskCount: number | null;
  createdAt: number;
  player: Player;
};

type MatchBase = {
  id: string;
  status: "countdown" | "playing" | "finished" | "abandoned";
  startsAt: number;
  finishedAt: number | null;
  winnerId: string | null;
  myMoves: number;
  opponentMoves: number;
  myRematch: boolean;
  opponentRematch: boolean;
  opponent: Player & { online: boolean };
  practice?: boolean;
  dailyDate?: string;
  assisted?: boolean;
  optimisticFinishedAt?: number | null;
};

type SortMatch = MatchBase & {
  mode: "sort";
  tier: BoltSortTierId;
  colorCount: number;
  diskCount: null;
  myBoard: BoltSortBoard;
  opponentBoard: BoltSortBoard;
};

type HanoiMatch = MatchBase & {
  mode: "hanoi";
  tier: HanoiTierId;
  colorCount: null;
  diskCount: number;
  par: number;
  myBoard: HanoiBoard;
  opponentBoard: HanoiBoard;
};

type Match = SortMatch | HanoiMatch;

type PracticeSession = {
  snapshot: Snapshot;
  initialBoard: BoltSortBoard | HanoiBoard;
  config: PracticeConfig;
  history: Array<BoltSortBoard | HanoiBoard>;
};

type Snapshot = {
  serverNow: number;
  player: Player;
  online: OnlinePlayer[];
  incoming: Invite[];
  outgoing: Invite[];
  match: Match | null;
};

type GameResponse = {
  ok: boolean;
  snapshot?: Snapshot;
  error?: string;
  code?: string;
};

type QueuedMove = {
  matchId: string;
  from: number;
  to: number;
  expectedMoves: number;
};

class RequestError extends Error {
  constructor(
    message: string,
    readonly code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}

const MODAL_FOCUS_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function useModalFocus<T extends HTMLElement>(onEscape?: () => void) {
  const dialogRef = useRef<T>(null);
  const escapeRef = useRef(onEscape);

  useEffect(() => {
    escapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;

    const getFocusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(MODAL_FOCUS_SELECTOR)).filter(
        (element) => !element.hasAttribute("disabled") && element.tabIndex !== -1,
      );
    const initialFocus =
      dialog.querySelector<HTMLElement>("[data-autofocus]") ?? getFocusable()[0] ?? dialog;

    queueMicrotask(() => {
      if (dialog.isConnected) initialFocus.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && escapeRef.current) {
        event.preventDefault();
        escapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      event.preventDefault();
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length : currentIndex) - 1
        : (currentIndex + 1) % focusable.length;
      focusable[nextIndex].focus();
    };

    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return dialogRef;
}

const ICONS = {
  back: "←",
  check: "✓",
  copy: "⧉",
  edit: "✎",
  rematch: "↻",
  share: "↗",
  swords: "⚔",
  trophy: "★",
  users: "●●",
  wifi: "◉",
  close: "×",
  zap: "ϟ",
} as const;

function UiIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <span className={`ui-icon ui-icon-${name}`} aria-hidden="true">
      {ICONS[name]}
    </span>
  );
}

async function gameRequest(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<Snapshot> {
  const response = await fetch("/api/game", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = (await response.json()) as GameResponse;
  if (!response.ok || !data.ok || !data.snapshot) {
    throw new RequestError(data.error ?? "Something went wrong.", data.code);
  }
  return data.snapshot;
}

function Avatar({ player, small = false }: { player: Player; small?: boolean }) {
  const initials = player.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <span
      className={`avatar${small ? " avatar-small" : ""}`}
      style={{ "--avatar-hue": player.hue } as React.CSSProperties}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

function Brand() {
  return (
    <div className="brand" aria-label="Stack Rush">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>STACK RUSH</span>
    </div>
  );
}

function recordLabel(player: Player) {
  if (!player.races) return "New racer";
  return `${player.wins} win${player.wins === 1 ? "" : "s"} · ${player.races} races`;
}


function radioKeys(event: React.KeyboardEvent<HTMLDivElement>) {
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const index = buttons.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
    : ["ArrowRight", "ArrowDown"].includes(event.key) ? (index + 1) % buttons.length
    : ["ArrowLeft", "ArrowUp"].includes(event.key) ? (index + buttons.length - 1) % buttons.length : -1;
  if (next < 0) return;
  event.preventDefault(); buttons[next].focus(); buttons[next].click();
}

function boardKeys(event: React.KeyboardEvent<HTMLDivElement>, columns: number) {
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
  const index = buttons.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1
    : event.key === "ArrowDown" ? columns : event.key === "ArrowUp" ? -columns : 0;
  if (!offset) return;
  event.preventDefault(); buttons[(index + offset + buttons.length) % buttons.length]?.focus();
}

function ModePicker({ value, onChange }: { value: GameMode; onChange: (value: GameMode) => void }) {
  return (
    <div className="mode-picker" role="radiogroup" tabIndex={-1} aria-label="Puzzle mode" onKeyDown={radioKeys}>
      <button type="button" role="radio" tabIndex={value === "sort" ? 0 : -1} aria-checked={value === "sort"} className={value === "sort" ? "active" : ""} onClick={() => onChange("sort")}>
        <span aria-hidden="true">⬢</span><b>NUTS &amp; BOLTS</b><small>COLOR STACKS</small>
      </button>
      <button type="button" role="radio" tabIndex={value === "hanoi" ? 0 : -1} aria-checked={value === "hanoi"} className={value === "hanoi" ? "active" : ""} onClick={() => onChange("hanoi")}>
        <span aria-hidden="true">≋</span><b>TOWER RACE</b><small>TOWER OF HANOI</small>
      </button>
    </div>
  );
}

function DifficultyPicker({
  mode,
  value,
  onChange,
}: {
  mode: GameMode;
  value: BoltSortTierId | HanoiTierId;
  onChange: (value: BoltSortTierId | HanoiTierId) => void;
}) {
  const levels = mode === "sort"
    ? Object.values(BOLT_SORT_TIERS).map((level) => ({ id: level.id, label: level.label, count: level.colorCount, detail: `${level.colorCount + 2} BOLTS` }))
    : (Object.entries(HANOI_LEVELS) as Array<[HanoiTierId, (typeof HANOI_LEVELS)[HanoiTierId]]>).map(([id, level]) => ({ id, label: level.label, count: level.diskCount, detail: `PAR ${level.par}` }));
  return (
    <div className="difficulty" role="radiogroup" tabIndex={-1} aria-label="Race difficulty" onKeyDown={radioKeys}>
      {levels.map((level) => (
        <button
          key={level.id}
          type="button"
          role="radio"
          tabIndex={value === level.id ? 0 : -1}
          aria-checked={value === level.id}
          className={value === level.id ? "active" : ""}
          onClick={() => onChange(level.id)}
        >
          <strong>{level.count}</strong>
          <span>{level.label.toUpperCase()}</span>
          <small>{level.detail}</small>
        </button>
      ))}
    </div>
  );
}

function OpponentCard({
  player,
  onChallenge,
  busy,
}: {
  player: OnlinePlayer;
  onChallenge: () => void;
  busy: boolean;
}) {
  return (
    <article className={`racer-card${player.available ? "" : " unavailable"}`}>
      <div className="racer-card-person">
        <Avatar player={player} />
        <span className={`presence-dot${player.available ? "" : " busy"}`} />
        <div>
          <h3>{player.name}</h3>
          <p>{player.available ? recordLabel(player) : "In another race"}</p>
        </div>
      </div>
      <button
        type="button"
        className="challenge-button"
        disabled={!player.available || busy}
        onClick={onChallenge}
        aria-label={`Challenge ${player.name}`}
      >
        {player.available ? (
          <>
            RACE <UiIcon name="swords" />
          </>
        ) : (
          "BUSY"
        )}
      </button>
    </article>
  );
}

function Lobby({
  snapshot,
  mode,
  setMode,
  difficulty,
  setDifficulty,
  busy,
  onChallenge,
  onCancel,
  onPractice,
  onEditName,
  onToast,
  savedPractice, records, daily, onDaily, onResume, onHelp, connection, now,
}: {
  savedPractice: SavedPractice | null; records: PracticeRecord[]; daily: PracticeConfig; onDaily: () => void; onResume: () => void; onHelp: () => void; connection: boolean; now: number;
  snapshot: Snapshot;
  mode: GameMode;
  setMode: (value: GameMode) => void;
  difficulty: BoltSortTierId | HanoiTierId;
  setDifficulty: (value: BoltSortTierId | HanoiTierId) => void;
  busy: boolean;
  onChallenge: (playerId: string) => void;
  onCancel: (inviteId: string) => void;
  onPractice: () => void;
  onEditName: () => void;
  onToast: (message: string) => void;
}) {
  const outgoing = snapshot.outgoing[0];
  const availableCount = snapshot.online.filter((player) => player.available).length;

  const shareLounge = async () => {
    const shareData = {
      title: "Stack Rush",
      text: "Race me in a live puzzle sprint—no account needed.",
      url: window.location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await navigator.clipboard.writeText(window.location.href);
      onToast("Lounge link copied!");
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") {
        onToast("Couldn’t share the link.");
      }
    }
  };

  return (
    <main className="lobby-shell">
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <span className={`live-pill${connection ? "" : " reconnecting"}`}>
            <UiIcon name="wifi" /> {connection ? "LIVE" : "RECONNECTING"}
          </span>
          <button
            type="button"
            className="profile-chip"
            onClick={onEditName}
            aria-label="Edit your racer name"
          >
            <Avatar player={snapshot.player} small />
            <span>{snapshot.player.name}</span>
            <UiIcon name="edit" />
          </button>
        </div>
      </header>

      <section className="lobby-hero">
        <div>
          <span className="eyebrow">
            <span className="pulse-dot" /> {snapshot.online.length + 1} PLAYING NOW
          </span>
          <h1>
            YOUR NEXT<br /><em>BRIGHT MOVE.</em>
          </h1>
          <p>
            Find your rhythm solo. Or challenge a friend to a puzzle race.
          </p>
        </div>
        <div className="hero-actions">
          <span className="hero-note">TWO PUZZLES. YOUR PACE.</span>
          <button type="button" className="share-button" onClick={shareLounge}>
            <UiIcon name="share" /> INVITE A FRIEND
          </button>
        </div>
      </section>

      <div className="lobby-grid">
        <section className="lounge-panel">
          <div className="section-heading">
            <div>
              <span className="section-kicker">01 · CHOOSE YOUR GAME</span>
              <h2>{mode === "sort" ? "SORT THE NUTS" : "MOVE THE TOWER"}</h2>
            </div>
            <span className="par-note">{mode === "sort" ? "MORE COLORS = BIGGER SCRAMBLE" : "MORE RINGS = LONGER RACE"}</span>
          </div>
          <ModePicker value={mode} onChange={setMode} />
          <DifficultyPicker mode={mode} value={difficulty} onChange={setDifficulty} />
          <SessionStart saved={savedPractice} disabled={busy || Boolean(outgoing)} onPlay={onPractice} onResume={onResume} onHelp={onHelp} />

          <div className="rivals-heading" id="rivals">
            <div>
              <span className="section-kicker">OR · MAKE IT A RACE</span>
              <h2>IN THE LOUNGE</h2>
            </div>
            <span className="online-count">
              <UiIcon name="users" /> {availableCount} READY
            </span>
          </div>

          {outgoing ? (
            <div className="waiting-card" role="status">
              <span className="waiting-nuts" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <div>
                <strong>CHALLENGE SENT</strong>
                <span>
                  Waiting for {outgoing.player.name} · {outgoing.mode === "sort" ? `${outgoing.colorCount} colors` : `${outgoing.diskCount} rings`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onCancel(outgoing.id)}
                disabled={busy}
              >
                CANCEL
              </button>
            </div>
          ) : null}

          <div className="racer-list">
            {snapshot.online.length ? (
              snapshot.online.map((player) => (
                <OpponentCard
                  key={player.id}
                  player={player}
                  busy={busy || Boolean(outgoing) || !connection}
                  onChallenge={() => onChallenge(player.id)}
                />
              ))
            ) : (
              <div className="empty-lounge">
                <span className="empty-bolts" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <b />
                </span>
                <div>
                  <h3>YOU’RE FIRST IN THE LOUNGE</h3>
                  <p>Send the link to a friend. They’ll appear here automatically.</p>
                </div>
                <button type="button" onClick={shareLounge}>
                  <UiIcon name="copy" /> COPY LINK
                </button>
              </div>
            )}
          </div>
        </section>

        <aside className="side-panel">
          <DailyCard config={daily} records={records} disabled={busy || Boolean(outgoing)} onPlay={onDaily} now={now} />
          <div className="your-record">
            <span className="section-kicker">YOUR MULTIPLAYER RECORD</span>
            <div className="record-number">
              <strong>{snapshot.player.wins}</strong>
              <span>WINS</span>
            </div>
            <div className="record-split">
              <span>
                <b>{snapshot.player.races}</b> RACES
              </span>
              <span>
                <b>
                  {snapshot.player.races
                    ? Math.round((snapshot.player.wins / snapshot.player.races) * 100)
                    : 0}
                  %
                </b>{" "}
                WIN RATE
              </span>
            </div>
          </div>

          <div className="how-card">
            <span className="section-kicker">HOW TO PLAY</span>
            <h2>{mode === "sort" ? <>STACK SMART.<br />MOVE FAST.</> : <>THINK AHEAD.<br />MOVE FAST.</>}</h2>
            <ol>
              {mode === "sort" ? <><li>
                <span>1</span>
                <p><b>TAP</b> a bolt to lift its matching top group.</p>
              </li>
              <li>
                <span>2</span>
                <p><b>PLACE</b> the full group where every nut fits.</p>
              </li>
              <li>
                <span>3</span>
                <p><b>SORT</b> four of every color before your rival.</p>
              </li></> : <><li><span>1</span><p><b>TAP</b> a tower to lift its top ring.</p></li><li><span>2</span><p><b>PLACE</b> it on an empty peg or a larger ring.</p></li><li><span>3</span><p><b>BUILD</b> the full tower on peg three first.</p></li></>}
            </ol>
            <div className="rule-stamp">
              <UiIcon name="zap" /> HINTS IN SOLO. PURE SKILL IN RACES.
            </div>
          </div>
        </aside>
      </div>

      <PersonalBests records={records} mode={mode} tier={difficulty} />

      <footer className="lobby-footer">
        <span>NO ACCOUNT. JUST RACE.</span>
        <span>SERVER-CHECKED MOVES · LIVE OPPONENT PROGRESS</span>
      </footer>
    </main>
  );
}

// Display colors are independent of the saved puzzle IDs; Quick gets six distinct hues.
const NUT_STYLES = {
  coral: { color: "#f06455", emoji: "🍎", label: "red apple" },
  orange: { color: "#3979d6", emoji: "💧", label: "blue drop" },
  amber: { color: "#f2d343", emoji: "⭐", label: "yellow star" },
  lemon: { color: "#9566c9", emoji: "🍇", label: "purple grapes" },
  lime: { color: "#48af70", emoji: "🍀", label: "green clover" },
  emerald: { color: "#eb85b5", emoji: "🌸", label: "pink flower" },
  teal: { color: "#f49c45", emoji: "🔥", label: "orange fire" },
  cyan: { color: "#55cddd", emoji: "🐟", label: "cyan fish" },
  sky: { color: "#ac7754", emoji: "🐻", label: "brown bear" },
  cobalt: { color: "#afe0b5", emoji: "🌵", label: "mint cactus" },
  violet: { color: "#c0afeb", emoji: "🦋", label: "lavender butterfly" },
  purple: { color: "#354f89", emoji: "🌙", label: "navy moon" },
  magenta: { color: "#f0daba", emoji: "⚽", label: "cream soccer ball" },
  rose: { color: "#a1afbc", emoji: "🔑", label: "gray key" },
  berry: { color: "#963d5d", emoji: "🍄", label: "burgundy mushroom" },
} satisfies Record<BoltColor, { color: string; emoji: string; label: string }>;

function boardColumns(boltCount: number) {
  if (boltCount <= 8) return 4;
  if (boltCount <= 11) return 6;
  if (boltCount <= 14) return 5;
  return 6;
}

function BoltSortBoardView({
  board,
  colorCount,
  selectedBolt,
  invalidBolt = null,
  interactive,
  onBolt,
  mini = false,
}: {
  board: BoltSortBoard;
  colorCount: number;
  selectedBolt: number | null;
  invalidBolt?: number | null;
  interactive: boolean;
  onBolt?: (bolt: number) => void;
  mini?: boolean;
}) {
  return (
    <div
      onKeyDown={mini ? undefined : (event) => boardKeys(event, boardColumns(board.length))}
      className={`bolt-sort-board${mini ? " mini-bolt-board" : ""}`}
      style={{ "--bolt-columns": boardColumns(board.length) } as React.CSSProperties}
      role={mini ? undefined : "group"}
      aria-label={mini ? undefined : `${colorCount}-color sorting board`}
      aria-hidden={mini || undefined}
    >
      {board.map((bolt, boltIndex) => {
        const topNut = bolt.at(-1);
        const groupSize = topBoltGroupSize(bolt);
        const locked = isLockedBolt(bolt);
        const legalTarget =
          selectedBolt !== null &&
          selectedBolt !== boltIndex &&
          moveBoltSortNut(board, selectedBolt, boltIndex, colorCount).ok;
        const classes = `bolt-zone${selectedBolt === boltIndex ? " selected" : ""}${
          legalTarget ? " legal-target" : ""
        }${locked ? " locked" : ""}${invalidBolt === boltIndex ? " invalid" : ""}`;
        const stackSummary = bolt.length
          ? `Bottom to top: ${bolt
              .map((nut) => NUT_STYLES[nut].label)
              .join(", ")}.`
          : "Empty.";
        const contents = (
          <>
            <span className="bolt-rod" />
            <span className="nut-stack">
              {bolt.map((nut, index) => {
                const style = NUT_STYLES[nut];
                return (
                  <span
                    key={`${nut}-${index}`}
                    className={`game-nut${
                      selectedBolt === boltIndex && index >= bolt.length - groupSize
                        ? " lifted"
                        : ""
                    }`}
                    style={{ backgroundColor: style.color }}
                  >
                    <i aria-hidden="true">{style.emoji}</i>
                  </span>
                );
              })}
            </span>
            <span className="bolt-base" />
            {locked && !mini ? <span className="bolt-cap" aria-hidden="true">✓</span> : null}
          </>
        );
        if (mini) {
          return (
            <span
              key={boltIndex}
              className={classes}
              style={{ "--pole-height": `${32 + (boltIndex % 3) * 3}px` } as React.CSSProperties}
            >
              {contents}
            </span>
          );
        }
        return (
          <button
            key={boltIndex}
            type="button"
            className={classes}
            style={{
              "--pole-height": `${98 + (boltIndex % 4) * 6}px`,
              "--compact-pole-height": `${58 + (boltIndex % 4) * 4}px`,
            } as React.CSSProperties}
            onClick={() => onBolt?.(boltIndex)}
            disabled={!interactive}
            aria-pressed={selectedBolt === boltIndex}
            aria-label={`Bolt ${boltIndex + 1} of ${board.length}. ${stackSummary} ${
              topNut
                ? `Top group ${groupSize} ${NUT_STYLES[topNut].label} nut${groupSize === 1 ? "" : "s"}.`
                : ""
            } ${bolt.length} of ${BOLT_CAPACITY} spaces filled.${
              locked ? " Sorted and locked." : ""
            }`}
          >
            {contents}
          </button>
        );
      })}
    </div>
  );
}

function RaceResultDialog({
  snapshot,
  match,
  elapsed,
  myProgress,
  busy,
  onRematch,
  onLeave,
}: {
  snapshot: Snapshot;
  match: Match;
  elapsed: number;
  myProgress: number;
  busy: boolean;
  onRematch: () => void;
  onLeave: () => void;
}) {
  const dialogRef = useModalFocus<HTMLDivElement>();
  const won = match.winnerId === snapshot.player.id;

  return (
    <div className="result-overlay">
      <div
        ref={dialogRef}
        className={`result-card${won ? " won" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-title"
        tabIndex={-1}
      >
        <div className="result-burst" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        <span className="result-icon">
          {won ? <UiIcon name="trophy" /> : <UiIcon name="swords" />}
        </span>
        <span className="result-kicker">{match.practice ? (match.dailyDate ? "DAILY SORT COMPLETE" : "PRACTICE COMPLETE") : won ? (match.mode === "sort" ? "SORT SECURED" : "TOWER SECURED") : "RACE COMPLETE"}</span>
        <h2 id="result-title">
          {won ? (match.mode === "sort" ? "YOU SORTED IT!" : "YOU BUILT IT!") : `${match.opponent.name} GOT THERE FIRST`}
        </h2>
        <p>
          {won
            ? `A ${formatTime(elapsed)} finish in ${match.myMoves} moves.`
            : `You made ${match.myMoves} moves and reached ${myProgress}%.`}
        </p>
        {match.practice ? <><div className="practice-result-summary"><b>{formatTime(elapsed)}</b><span>{match.myMoves} MOVES</span></div><p className="result-note">{match.assisted ? "Assisted finish. Keep practicing; personal bests use runs without hints or undo." : "Unassisted finish. Added to your personal records on this device."}</p></> : <div className="result-score">
          <div className={won ? "winner" : ""}>
            <Avatar player={snapshot.player} small />
            <span>YOU</span>
            <b>{match.myMoves}</b>
            <small>MOVES</small>
          </div>
          <span>VS</span>
          <div className={!won ? "winner" : ""}>
            <Avatar player={match.opponent} small />
            <span>{match.opponent.name}</span>
            <b>{match.opponentMoves}</b>
            <small>MOVES</small>
          </div>
        </div>}
        {match.status === "finished" ? (
          <>
            <button
              type="button"
              className="primary-result"
              onClick={onRematch}
              disabled={busy || match.myRematch}
              data-autofocus
            >
              <UiIcon name="rematch" />
              {match.myRematch
                ? match.opponentRematch
                  ? "STARTING…"
                  : "WAITING FOR RIVAL…"
                : match.practice ? (match.dailyDate ? "PLAY DAILY AGAIN" : "TRY ANOTHER") : "RACE AGAIN"}
            </button>
            <button type="button" className="secondary-result" onClick={onLeave} disabled={busy}>
              BACK TO LOUNGE
            </button>
          </>
        ) : (
          <button
            type="button"
            className="primary-result"
            onClick={onLeave}
            disabled={busy}
            data-autofocus
          >
            BACK TO LOUNGE
          </button>
        )}
      </div>
    </div>
  );
}

function HanoiBoardView({
  board,
  diskCount,
  selectedPeg,
  invalidPeg = null,
  interactive,
  onPeg,
  mini = false,
}: {
  board: HanoiBoard;
  diskCount: number;
  selectedPeg: number | null;
  invalidPeg?: number | null;
  interactive: boolean;
  onPeg?: (peg: number) => void;
  mini?: boolean;
}) {
  return (
    <div onKeyDown={mini ? undefined : (event) => boardKeys(event, 3)} className={`hanoi-board${mini ? " mini-hanoi-board" : ""}`} role={mini ? undefined : "group"} aria-label={mini ? undefined : `${diskCount}-ring Tower of Hanoi board`} aria-hidden={mini || undefined}>
      {board.map((peg, pegIndex) => {
        const contents = <><span className="hanoi-rod" /><span className="ring-stack">{peg.map((disk, index) => <span key={disk} className={`hanoi-ring ring-${disk}${selectedPeg === pegIndex && index === peg.length - 1 ? " lifted" : ""}`} style={{ width: `${32 + (disk / diskCount) * 64}%` }}><i>{disk}</i></span>)}</span><span className="hanoi-base" /></>;
        if (mini) return <span key={pegIndex} className="hanoi-peg">{contents}</span>;
        return <button key={pegIndex} type="button" className={`hanoi-peg${selectedPeg === pegIndex ? " selected" : ""}${selectedPeg !== null && selectedPeg !== pegIndex && moveHanoiDisk(board, selectedPeg, pegIndex, diskCount).ok ? " legal-target" : ""}${invalidPeg === pegIndex ? " invalid" : ""}`} disabled={!interactive} onClick={() => onPeg?.(pegIndex)} aria-pressed={selectedPeg === pegIndex} aria-label={`Tower ${pegIndex + 1}${pegIndex === 2 ? ", goal" : ""}. ${peg.length ? `Bottom to top: ${peg.join(", ")}.` : "Empty."}`}>{contents}<span className="peg-label">{pegIndex === 2 ? "3 · GOAL" : `${pegIndex + 1}`}</span></button>;
      })}
    </div>
  );
}

function HanoiRace({
  snapshot, now, selectedPeg, setSelectedPeg, busy, onMove, onReset, onLeave, onRematch, onToast, practiceTools,
}: {
  practiceTools?: React.ReactNode;
  snapshot: Snapshot; now: number; selectedPeg: number | null; setSelectedPeg: (value: number | null) => void; busy: boolean; onMove: (from: number, to: number) => void; onReset: () => void; onLeave: () => void; onRematch: () => void; onToast: (message: string) => void;
}) {
  const match = snapshot.match as HanoiMatch;
  const [invalidPeg, setInvalidPeg] = useState<number | null>(null);
  const countdown = Math.max(0, Math.min(3, Math.ceil((match.startsAt - now) / 1_000)));
  const ended = match.status === "finished" || match.status === "abandoned";
  const playable = !ended && now >= match.startsAt && !busy;
  const elapsed = raceElapsed(match.startsAt, now, match.finishedAt, match.optimisticFinishedAt);
  const myProgress = hanoiProgress(match.myBoard, match.diskCount);
  const opponentProgress = hanoiProgress(match.opponentBoard, match.diskCount);

  const handlePeg = (peg: number) => {
    if (!playable) return;
    if (selectedPeg === null) {
      if (!match.myBoard[peg].length) {
        setInvalidPeg(peg); onToast("That tower is empty."); setTimeout(() => setInvalidPeg(null), 260); return;
      }
      setSelectedPeg(peg); return;
    }
    if (selectedPeg === peg) { setSelectedPeg(null); return; }
    const local = moveHanoiDisk(match.myBoard, selectedPeg, peg, match.diskCount);
    if (!local.ok) { setInvalidPeg(peg); onToast(local.message); setTimeout(() => setInvalidPeg(null), 260); return; }
    const from = selectedPeg; setSelectedPeg(null); onMove(from, peg);
  };

  return <main className={`race-shell hanoi-race${match.practice ? " practice-race" : ""}`}>
    <header className="race-topbar"><button type="button" className="icon-button" onClick={onLeave} aria-label="Leave race"><UiIcon name="back" /></button><Brand /><div className="race-kind"><span>{match.diskCount} RINGS</span><b>PAR {match.par} MOVES</b></div></header>
    {match.practice ? <section className="practice-strip"><UiIcon name="zap" /><div><span>{match.dailyDate ? "DAILY CHALLENGE" : "SOLO PRACTICE"}</span><b>{match.assisted ? "GUIDED RUN · KEEP EXPLORING" : "YOUR PACE · YOUR PERSONAL BEST"}</b></div></section> : <section className="opponent-strip"><div className="opponent-identity"><Avatar player={match.opponent} small /><div><span>YOUR RIVAL</span><strong>{match.opponent.name}</strong></div><i className={match.opponent.online ? "online" : "offline"}>{match.opponent.online ? "LIVE" : "RECONNECTING"}</i></div><div className="opponent-mini" role="img" aria-label={`Opponent tower, ${opponentProgress} percent complete`}><HanoiBoardView board={match.opponentBoard} diskCount={match.diskCount} selectedPeg={null} interactive={false} mini /></div><div className="opponent-stats"><strong>{opponentProgress}%</strong><span>{match.opponentMoves} MOVES</span></div></section>}
    <section className="race-stage"><div className="race-stats"><div><span>TIME</span><strong>{formatTime(elapsed)}</strong></div><div className="race-status-center"><span className="progress-track" role="progressbar" aria-label="Tower complete" aria-valuemin={0} aria-valuemax={100} aria-valuenow={myProgress}><i style={{ width: `${myProgress}%` }} /></span><b>{match.myBoard[2].length} / {match.diskCount} RINGS ON GOAL</b></div><div><span>MOVES</span><strong>{match.myMoves}</strong></div></div>
      <div className="board-wrap"><span className="you-badge">YOUR BOARD</span><HanoiBoardView board={match.myBoard} diskCount={match.diskCount} selectedPeg={selectedPeg} invalidPeg={invalidPeg} interactive={playable} onPeg={handlePeg} /></div>
      <div className="move-prompt" aria-live="polite"><span className={`prompt-icon${selectedPeg !== null ? " active" : ""}`}>{selectedPeg !== null ? <UiIcon name="check" /> : <span>1</span>}</span><div><b>{selectedPeg !== null ? "RING LIFTED" : "YOUR MOVE"}</b><span>{selectedPeg !== null ? "Tap an empty tower or a larger ring" : "Tap a tower to lift its top ring"}</span></div><div className="prompt-actions">{selectedPeg !== null ? <button type="button" onClick={() => setSelectedPeg(null)}>CANCEL</button> : null}<button type="button" onClick={() => { setSelectedPeg(null); onReset(); }} disabled={busy}>RESET</button></div></div>
    </section>
    {!ended ? practiceTools : null}
    {countdown > 0 && !ended ? <div className="countdown-overlay" role="status" aria-live="assertive"><div className="countdown-card"><span>GET READY</span><strong key={countdown}>{countdown}</strong><p>Same tower. First perfect stack wins.</p></div></div> : null}
    {ended ? <RaceResultDialog snapshot={snapshot} match={match} elapsed={elapsed} myProgress={myProgress} busy={busy} onRematch={onRematch} onLeave={onLeave} /> : null}
  </main>;
}

function SortRace({
  snapshot,
  now,
  selectedBolt,
  setSelectedBolt,
  busy,
  onMove,
  onReset,
  onLeave,
  onRematch,
  onToast,
  practiceTools,
}: {
  practiceTools?: React.ReactNode;
  snapshot: Snapshot;
  now: number;
  selectedBolt: number | null;
  setSelectedBolt: (value: number | null) => void;
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onReset: () => void;
  onLeave: () => void;
  onRematch: () => void;
  onToast: (message: string) => void;
}) {
  const match = snapshot.match as SortMatch;
  const [invalidBolt, setInvalidBolt] = useState<number | null>(null);
  const invalidTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdown = Math.max(
    0,
    Math.min(3, Math.ceil((match.startsAt - now) / 1_000)),
  );
  const ended = match.status === "finished" || match.status === "abandoned";
  const playable = !ended && now >= match.startsAt && !busy;
  const elapsed = raceElapsed(match.startsAt, now, match.finishedAt, match.optimisticFinishedAt);
  const myProgressInfo = getBoltSortProgress(match.myBoard, match.colorCount);
  const myProgress = myProgressInfo.percent;
  const opponentProgress = boltSortProgress(match.opponentBoard, match.colorCount);
  const deadlocked =
    !ended &&
    !isBoltSortSolved(match.myBoard, match.colorCount) &&
    listLegalBoltMoves(match.myBoard, match.colorCount).length === 0;
  const selectedGroupSize = selectedBolt === null ? 0 : topBoltGroupSize(match.myBoard[selectedBolt]);

  useEffect(() => {
    return () => {
      if (invalidTimer.current) clearTimeout(invalidTimer.current);
    };
  }, []);

  const flagInvalidBolt = (bolt: number) => {
    setInvalidBolt(bolt);
    if (invalidTimer.current) clearTimeout(invalidTimer.current);
    invalidTimer.current = setTimeout(() => setInvalidBolt(null), 260);
  };

  const handleBolt = (bolt: number) => {
    if (!playable || deadlocked) return;
    if (selectedBolt === null) {
      if (!match.myBoard[bolt].length) {
        flagInvalidBolt(bolt);
        onToast("That bolt is empty.");
        return;
      }
      if (isLockedBolt(match.myBoard[bolt])) {
        flagInvalidBolt(bolt);
        onToast("That color is already sorted and locked.");
        return;
      }
      setSelectedBolt(bolt);
      setInvalidBolt(null);
      return;
    }
    if (selectedBolt === bolt) {
      setSelectedBolt(null);
      return;
    }
    const localResult = moveBoltSortNut(
      match.myBoard,
      selectedBolt,
      bolt,
      match.colorCount,
    );
    if (!localResult.ok) {
      flagInvalidBolt(bolt);
      onToast(localResult.message);
      return;
    }
    const from = selectedBolt;
    setSelectedBolt(null);
    onMove(from, bolt);
  };

  return (
    <main className={`race-shell${match.practice ? " practice-race" : ""}`}>
      <header className="race-topbar">
        <button type="button" className="icon-button" onClick={onLeave} aria-label="Leave race">
          <UiIcon name="back" />
        </button>
        <Brand />
        <div className="race-kind">
          <span>{match.colorCount} COLORS</span>
          <b>{match.colorCount + 2} BOLTS</b>
        </div>
      </header>

      {match.practice ? <section className="practice-strip"><UiIcon name="zap" /><div><span>{match.dailyDate ? `DAILY SORT · ${match.dailyDate}` : "SOLO PRACTICE"}</span><b>{match.assisted ? "GUIDED RUN · KEEP EXPLORING" : "YOUR PACE · YOUR PERSONAL BEST"}</b></div></section> : <section className="opponent-strip">
        <div className="opponent-identity">
          <Avatar player={match.opponent} small />
          <div>
            <span>YOUR RIVAL</span>
            <strong>{match.opponent.name}</strong>
          </div>
          <i className={match.opponent.online ? "online" : "offline"}>
            {match.opponent.online ? "LIVE" : "RECONNECTING"}
          </i>
        </div>
        <div
          className="opponent-mini"
          role="img"
          aria-label={`Opponent board, ${opponentProgress} percent sorted`}
        >
          <BoltSortBoardView
            board={match.opponentBoard}
            colorCount={match.colorCount}
            selectedBolt={null}
            interactive={false}
            mini
          />
        </div>
        <div className="opponent-stats">
          <strong>{opponentProgress}%</strong>
          <span>{match.opponentMoves} MOVES</span>
        </div>
      </section>}

      <section className="race-stage">
        <div className="race-stats">
          <div>
            <span>TIME</span>
            <strong>{formatTime(elapsed)}</strong>
          </div>
          <div className="race-status-center">
            <span
              className="progress-track"
              role="progressbar"
              aria-label="Colors sorted"
              aria-valuemin={0}
              aria-valuemax={match.colorCount}
              aria-valuenow={myProgressInfo.completedColors}
            >
              <i style={{ width: `${myProgress}%` }} />
            </span>
            <b>
              {myProgressInfo.completedColors} / {match.colorCount} COLORS SORTED
            </b>
          </div>
          <div>
            <span>MOVES</span>
            <strong>{match.myMoves}</strong>
          </div>
        </div>

        <div className="board-wrap">
          <span className="you-badge">YOUR BOARD</span>
          <BoltSortBoardView
            board={match.myBoard}
            colorCount={match.colorCount}
            selectedBolt={selectedBolt}
            invalidBolt={invalidBolt}
            interactive={playable && !deadlocked}
            onBolt={handleBolt}
          />
        </div>

        <div className="move-prompt" aria-live="polite">
          <span className={`prompt-icon${selectedBolt !== null || deadlocked ? " active" : ""}`}>
            {deadlocked ? "!" : selectedBolt !== null ? <UiIcon name="check" /> : <span>1</span>}
          </span>
          <div>
            <b>{deadlocked ? "NO MOVES LEFT" : selectedBolt !== null ? `${selectedGroupSize} NUT${selectedGroupSize === 1 ? "" : "S"} LIFTED` : "YOUR MOVE"}</b>
            <span>
              {deadlocked
                ? match.practice ? "Undo your last move or reset the puzzle" : "Reset to the shared starting scramble"
                : selectedBolt !== null
                ? "Match the emoji on top, or use an empty bolt"
                : "Tap any stack to lift its matching top group"}
            </span>
          </div>
          <div className="prompt-actions">
            {!deadlocked && selectedBolt !== null ? <button type="button" onClick={() => setSelectedBolt(null)}>CANCEL</button> : null}
            <button type="button" onClick={() => { setSelectedBolt(null); onReset(); }} disabled={busy}>RESET</button>
          </div>
        </div>
      </section>

      {!ended ? practiceTools : null}
      {countdown > 0 && !ended ? (
        <div className="countdown-overlay" role="status" aria-live="assertive">
          <div className="countdown-card">
            <span>GET READY</span>
            <strong key={countdown}>{countdown}</strong>
            <p>Same scramble. First clean sort wins.</p>
          </div>
        </div>
      ) : null}

      {ended ? (
        <RaceResultDialog
          snapshot={snapshot}
          match={match}
          elapsed={elapsed}
          myProgress={myProgress}
          busy={busy}
          onRematch={onRematch}
          onLeave={onLeave}
        />
      ) : null}
    </main>
  );
}

function Race(props: {
  practiceTools?: React.ReactNode;
  snapshot: Snapshot;
  now: number;
  selectedBolt: number | null;
  setSelectedBolt: (value: number | null) => void;
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onReset: () => void;
  onLeave: () => void;
  onRematch: () => void;
  onToast: (message: string) => void;
}) {
  return props.snapshot.match?.mode === "hanoi" ? (
    <HanoiRace
      snapshot={props.snapshot}
      now={props.now}
      selectedPeg={props.selectedBolt}
      setSelectedPeg={props.setSelectedBolt}
      busy={props.busy}
      onMove={props.onMove}
      onReset={props.onReset}
      onLeave={props.onLeave}
      onRematch={props.onRematch}
      onToast={props.onToast}
      practiceTools={props.practiceTools}
    />
  ) : <SortRace {...props} />;
}

function InviteSheet({
  invite,
  busy,
  onAccept,
  onDecline,
}: {
  invite: Invite;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const dialogRef = useModalFocus<HTMLElement>();
  return (
    <div className="sheet-backdrop">
      <section
        ref={dialogRef}
        className="invite-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-title"
        tabIndex={-1}
      >
        <div className="invite-versus">
          <Avatar player={invite.player} />
          <span><UiIcon name="swords" /></span>
          <span className="mystery-avatar">YOU</span>
        </div>
        <span className="section-kicker">INCOMING CHALLENGE</span>
        <h2 id="invite-title">{invite.player.name} WANTS TO RACE</h2>
        <p>
          {invite.mode === "sort"
            ? `${invite.colorCount} colors · ${(invite.colorCount ?? 0) + 2} bolts`
            : `${invite.diskCount} rings · par ${2 ** (invite.diskCount ?? 0) - 1}`} · shared countdown
        </p>
        <div className="invite-actions">
          <button type="button" className="decline-button" onClick={onDecline} disabled={busy}>
            <UiIcon name="close" /> DECLINE
          </button>
          <button
            type="button"
            className="accept-button"
            onClick={onAccept}
            disabled={busy}
            data-autofocus
          >
            <UiIcon name="swords" /> ACCEPT RACE
          </button>
        </div>
      </section>
    </div>
  );
}

function NameDialog({
  player,
  busy,
  onClose,
  onSave,
}: {
  player: Player;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(player.name);
  const dialogRef = useModalFocus<HTMLFormElement>(onClose);
  return (
    <div className="sheet-backdrop">
      <form
        ref={dialogRef}
        className="name-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-title"
        tabIndex={-1}
        onSubmit={(event) => {
          event.preventDefault();
          onSave(name);
        }}
      >
        <button type="button" className="dialog-close" onClick={onClose} aria-label="Close">
          <UiIcon name="close" />
        </button>
        <div className="name-dialog-identity">
          <Avatar player={{ ...player, name: name || player.name }} />
          <span className="section-kicker">YOUR GUEST NAME</span>
        </div>
        <h2 id="name-title">MAKE IT YOURS</h2>
        <p>No account needed. This name is visible to people in the lounge.</p>
        <label>
          RACER NAME
          <input
            data-autofocus
            value={name}
            maxLength={18}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
        </label>
        <button type="submit" className="save-name" disabled={busy || name.trim().length < 2}>
          SAVE NAME
        </button>
      </form>
    </div>
  );
}

function ConfirmLeaveDialog({
  opponentName,
  onCancel,
  onConfirm,
}: {
  opponentName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useModalFocus<HTMLElement>(onCancel);
  return (
    <div className="sheet-backdrop">
      <section
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-title"
        tabIndex={-1}
      >
        <span className="warning-icon">!</span>
        <h2 id="leave-title">LEAVE THE RACE?</h2>
        <p>Leaving now awards the win to {opponentName}.</p>
        <div>
          <button type="button" onClick={onCancel} data-autofocus>KEEP RACING</button>
          <button type="button" className="danger-button" onClick={onConfirm}>
            FORFEIT
          </button>
        </div>
      </section>
    </div>
  );
}

function HelpDialog({ mode, onClose }: { mode: GameMode; onClose: () => void }) {
  const dialogRef = useModalFocus<HTMLDivElement>(onClose);
  return <div className="sheet-backdrop"><div ref={dialogRef} className="name-dialog guide-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title" tabIndex={-1}>
    <button className="close-button" type="button" onClick={onClose} aria-label="Close rules">×</button>
    <span className="section-kicker">A QUICK FIELD GUIDE</span>
    <h2 id="guide-title">{mode === "sort" ? "NUTS & BOLTS" : "TOWER OF HANOI"}</h2>
    <p>{mode === "sort" ? "Sort each color onto its own bolt. A complete stack of four locks into place." : "Move the whole tower to peg 3. The challenge is finding the right order."}</p>
    <ol className="guide-steps">
      <li><b>Choose a stack.</b> {mode === "sort" ? "You lift all matching nuts at the top together." : "Only the top ring can move."}</li>
      <li><b>Choose a destination.</b> {mode === "sort" ? "It must be empty or have the same color and emoji on top, with room for the whole group." : "Use an empty peg or put the ring on a larger one."}</li>
      <li><b>Give yourself space.</b> {mode === "sort" ? "Keep a spare bolt open. Filling both spares too early can leave you stuck." : "Move the smaller rings aside before moving a larger ring to the goal."}</li>
    </ol>
    <div className="guide-tip"><b>SOLO IS YOUR WORKSHOP</b><p>Undo a move, ask for a hint, or pause and return later. Hints and undo mark a run as assisted. Multiplayer races have no assists or pauses.</p></div>
    <p className="keyboard-note"><b>Keyboard:</b> Tab to the board, use arrow keys to move between stacks, then Enter or Space to pick up and place. {mode === "sort" ? "Each color has its own emoji, so you can match by either cue." : "Numbers on rings show their size."}</p>
    <button type="button" className="save-name" onClick={onClose}>GOT IT. LET’S PLAY.</button>
  </div></div>;
}

function savedSession(session: PracticeSession): SavedPractice {
  const match = session.snapshot.match!;
  return { version: 1, config: session.config, board: clonePracticeBoard(match.myBoard), moves: match.myMoves,
    elapsed: Math.max(0, Date.now() - match.startsAt), assisted: Boolean(match.assisted), history: session.history };
}

function clonePracticeBoard(board: BoltSortBoard | HanoiBoard): BoltSortBoard | HanoiBoard {
  return board.map((stack) => [...stack]) as BoltSortBoard | HanoiBoard;
}

function createPracticeSession(
  player: Player,
  mode: GameMode,
  tier: BoltSortTierId | HanoiTierId,
  config: PracticeConfig = { mode, tier, seed: `practice:${crypto.randomUUID()}` },
): PracticeSession {
  const now = Date.now();
  const opponent = {
    id: "practice",
    name: "Solo Practice",
    hue: 74,
    wins: 0,
    races: 0,
    online: true,
  };
  let match: Match;
  let initialBoard: BoltSortBoard | HanoiBoard;
  if (mode === "sort") {
    const puzzle = createBoltSortPuzzle(
      tier as BoltSortTierId,
      config.seed,
    );
    initialBoard = puzzle.board;
    match = {
      id: `practice:${crypto.randomUUID()}`,
      mode: "sort",
      tier: tier as BoltSortTierId,
      status: "countdown",
      colorCount: puzzle.colorCount,
      diskCount: null,
      startsAt: now + 1_500,
      finishedAt: null,
      winnerId: null,
      myBoard: clonePracticeBoard(puzzle.board) as BoltSortBoard,
      opponentBoard: clonePracticeBoard(puzzle.board) as BoltSortBoard,
      myMoves: 0,
      opponentMoves: 0,
      myRematch: false,
      opponentRematch: false,
      opponent,
      practice: true,
      dailyDate: config.dailyDate,
      assisted: false,
    };
  } else {
    const level = HANOI_LEVELS[tier as HanoiTierId];
    const board = createHanoiBoard(level.diskCount);
    initialBoard = board;
    match = {
      id: `practice:${crypto.randomUUID()}`,
      mode: "hanoi",
      tier: tier as HanoiTierId,
      status: "countdown",
      colorCount: null,
      diskCount: level.diskCount,
      par: level.par,
      startsAt: now + 1_500,
      finishedAt: null,
      winnerId: null,
      myBoard: clonePracticeBoard(board) as HanoiBoard,
      opponentBoard: clonePracticeBoard(board) as HanoiBoard,
      myMoves: 0,
      opponentMoves: 0,
      myRematch: false,
      opponentRematch: false,
      opponent,
      practice: true,
      dailyDate: config.dailyDate,
      assisted: false,
    };
  }
  return {
    initialBoard: clonePracticeBoard(initialBoard),
    config,
    history: [],
    snapshot: {
      serverNow: now,
      player,
      online: [],
      incoming: [],
      outgoing: [],
      match,
    },
  };
}

export function GameApp() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [mode, setMode] = useState<GameMode>("sort");
  const [sortDifficulty, setSortDifficulty] = useState<BoltSortTierId>("quick");
  const [hanoiDifficulty, setHanoiDifficulty] = useState<HanoiTierId>("classic");
  const [busy, setBusy] = useState(false);
  const [moveReconciling, setMoveReconciling] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [selectedBolt, setSelectedBolt] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [practice, setPractice] = useState<PracticeSession | null>(null);
  const [practiceNow, setPracticeNow] = useState(0);
  const [clockNow, setClockNow] = useState(0);
  const [savedPractice, setSavedPractice] = useState<SavedPractice | null>(null);
  const [records, setRecords] = useState<PracticeRecord[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hintText, setHintText] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [todayNow, setTodayNow] = useState(0);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [storageReady, setStorageReady] = useState(false);
  const snapshotRef = useRef<Snapshot | null>(null);
  const busyRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const appliedSequenceRef = useRef(0);
  const moveQueueRef = useRef<QueuedMove[]>([]);
  const moveSendingRef = useRef(false);
  const clockOffsetRef = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applySnapshot = useCallback((next: Snapshot) => {
    if (snapshotRef.current?.match?.id !== next.match?.id || snapshotRef.current?.match?.mode !== next.match?.mode) {
      moveQueueRef.current = [];
      setSelectedBolt(null);
      setConfirmingLeave(false);
      setMoveReconciling(false);
    }
    if (next.incoming.length) { setEditingName(false); setHelpOpen(false); }
    if (next.match) setPractice(null);
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const applyNetworkSnapshot = useCallback(
    (next: Snapshot, sequence: number) => {
      if (
        sequence < appliedSequenceRef.current ||
        sequence < requestSequenceRef.current
      ) {
        return false;
      }
      appliedSequenceRef.current = sequence;
      clockOffsetRef.current = next.serverNow - Date.now();
      setClockNow(next.serverNow);
      setConnected(true);
      setMoveReconciling(false);
      applySnapshot(next);
      return true;
    },
    [applySnapshot],
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2_600);
  }, []);

  const sendAction = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      if (busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      const sequence = ++requestSequenceRef.current;
      try {
        const next = await gameRequest(action, payload);
        applyNetworkSnapshot(next, sequence);
        return next;
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Try that again.");
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [applyNetworkSnapshot, showToast],
  );

  const flushMoveQueue = useCallback(async () => {
    if (moveSendingRef.current) return;
    moveSendingRef.current = true;

    try {
      while (moveQueueRef.current.length) {
        const move = moveQueueRef.current[0];
        const sequence = ++requestSequenceRef.current;
        try {
          let next = await gameRequest("move", move);
          if (moveQueueRef.current[0] === move) {
            moveQueueRef.current.shift();
          }

          const current = snapshotRef.current;
          const terminal =
            next.match?.status === "finished" || next.match?.status === "abandoned";
          if (terminal || next.match?.id !== move.matchId) {
            moveQueueRef.current = [];
          } else if (
            current?.match?.id === next.match.id &&
            current.match.mode === next.match.mode &&
            current.match.myMoves > next.match.myMoves
          ) {
            next = {
              ...next,
              match: {
                ...next.match,
                myBoard: current.match.myBoard,
                myMoves: current.match.myMoves,
                optimisticFinishedAt: current.match.optimisticFinishedAt,
              } as Match,
            };
          }
          applyNetworkSnapshot(next, sequence);
        } catch (error) {
          moveQueueRef.current = [];
          setMoveReconciling(true);
          showToast(error instanceof Error ? error.message : "Move lost. Resyncing…");
          const syncSequence = ++requestSequenceRef.current;
          try {
            applyNetworkSnapshot(await gameRequest("sync"), syncSequence);
          } catch {
            setConnected(false);
            showToast("Connection interrupted. Reconnecting…");
          }
          break;
        }
      }
    } finally {
      moveSendingRef.current = false;
    }
  }, [applyNetworkSnapshot, showToast]);

  useEffect(() => {
    let cancelled = false;
    const sequence = ++requestSequenceRef.current;
    gameRequest("session")
      .then((next) => {
        if (!cancelled) applyNetworkSnapshot(next, sequence);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadingError(error instanceof Error ? error.message : "Couldn’t enter the lounge.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applyNetworkSnapshot]);

  const hasSnapshot = Boolean(snapshot);
  const matchId = snapshot?.match?.id ?? null;
  const matchStatus = snapshot?.match?.status ?? null;
  const practiceMatchId = practice?.snapshot.match?.id ?? null;
  const practiceMatchStatus = practice?.snapshot.match?.status ?? null;

  useEffect(() => {
    if (!hasSnapshot) return;
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (stopped) return;
      const current = snapshotRef.current;
      const delay = current?.match && !["finished", "abandoned"].includes(current.match.status)
        ? 700
        : 2_200;
      if (
        document.visibilityState === "visible" &&
        !busyRef.current &&
        !moveSendingRef.current &&
        moveQueueRef.current.length === 0
      ) {
        const sequence = ++requestSequenceRef.current;
        try {
          applyNetworkSnapshot(await gameRequest("sync"), sequence);
        } catch {
          setConnected(false);
        }
      }
      timeout = setTimeout(poll, document.visibilityState === "visible" ? delay : 6_000);
    };

    timeout = setTimeout(poll, 700);
    return () => {
      stopped = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [hasSnapshot, applyNetworkSnapshot]);

  useEffect(() => {
    if (!matchId || matchStatus === "finished" || matchStatus === "abandoned") {
      return;
    }
    const interval = setInterval(() => {
      setClockNow(Date.now() + clockOffsetRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, [matchId, matchStatus]);

  useEffect(() => {
    if (!practiceMatchId || practiceMatchStatus === "finished") return;
    const interval = setInterval(() => setPracticeNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [practiceMatchId, practiceMatchStatus]);

  useEffect(() => {
    if (matchId) window.scrollTo({ top: 0, behavior: "instant" });
  }, [matchId]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
    if (cancelled) return;
    setTodayNow(Date.now());
    try {
      setSavedPractice(parsePracticeSave(localStorage.getItem(PRACTICE_SAVE_KEY)));
      setRecords(parsePracticeRecords(localStorage.getItem(PRACTICE_RECORDS_KEY)));
      const preferences = JSON.parse(localStorage.getItem("stack-rush:preferences:v1") ?? "null");
      if (preferences?.mode === "sort" || preferences?.mode === "hanoi") setMode(preferences.mode);
      if (Object.hasOwn(BOLT_SORT_TIERS, preferences?.sort ?? "")) setSortDifficulty(preferences.sort);
      if (Object.hasOwn(HANOI_LEVELS, preferences?.hanoi ?? "")) setHanoiDifficulty(preferences.hanoi);
    } catch { setStorageAvailable(false); }
    setStorageReady(true);
    });
    const timer = setInterval(() => setTodayNow(Date.now()), 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem(PRACTICE_RECORDS_KEY, JSON.stringify(records));
      localStorage.setItem("stack-rush:preferences:v1", JSON.stringify({ mode, sort: sortDifficulty, hanoi: hanoiDifficulty }));
    } catch { queueMicrotask(() => setStorageAvailable(false)); }
  }, [records, mode, sortDifficulty, hanoiDifficulty, storageReady]);

  useEffect(() => {
    const match = practice?.snapshot.match;
    if (!practice || !match) return;
    let cancelled = false;
    if (match.status === "finished") {
      queueMicrotask(() => {
      if (cancelled) return;
      const record: PracticeRecord = { id: match.id, mode: match.mode, tier: match.tier, moves: match.myMoves,
        elapsed: Math.max(0, (match.finishedAt ?? Date.now()) - match.startsAt), completedAt: match.finishedAt ?? Date.now(),
        assisted: Boolean(match.assisted), dailyDate: match.dailyDate };
      setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)].slice(0, 100));
      setSavedPractice(null);
      try { localStorage.removeItem(PRACTICE_SAVE_KEY); } catch { setStorageAvailable(false); }
      });
      return () => { cancelled = true; };
    }
    const save = () => {
      const saved = savedSession(practice);
      setSavedPractice(saved);
      try { localStorage.setItem(PRACTICE_SAVE_KEY, JSON.stringify(saved)); } catch { setStorageAvailable(false); }
    };
    queueMicrotask(() => { if (!cancelled) save(); });
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", save);
    return () => { cancelled = true; window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", save); };
  }, [practice]);

  if (!snapshot || !storageReady) {
    return (
      <main className="loading-screen">
        <Brand />
        <div className="loading-nuts" aria-hidden="true"><i /><i /><i /><i /></div>
        <span>{loadingError ? "OFFLINE" : "ENTERING THE LOUNGE"}</span>
        <h1>{loadingError ?? "FINDING RACERS…"}</h1>
        {loadingError ? (
          <button type="button" onClick={() => window.location.reload()}>TRY AGAIN</button>
        ) : (
          <div className="loading-line"><i /></div>
        )}
      </main>
    );
  }

  const handleMove = (from: number, to: number) => {
    const current = snapshotRef.current;
    const match = current?.match;
    if (!current || !match) return;
    if (moveQueueRef.current.length >= 6) {
      showToast("Give the connection a beat…");
      return;
    }
    if (match.mode === "sort") {
      const local = moveBoltSortNut(match.myBoard, from, to, match.colorCount);
      if (!local.ok) return;
      applySnapshot({
        ...current,
        match: {
          ...match,
          myBoard: local.board,
          myMoves: match.myMoves + 1,
          optimisticFinishedAt: isBoltSortSolved(local.board, match.colorCount)
            ? Date.now() + clockOffsetRef.current
            : match.optimisticFinishedAt,
        },
      });
    } else {
      const local = moveHanoiDisk(match.myBoard, from, to, match.diskCount);
      if (!local.ok) return;
      applySnapshot({
        ...current,
        match: {
          ...match,
          myBoard: local.board,
          myMoves: match.myMoves + 1,
          optimisticFinishedAt: isHanoiSolved(local.board, match.diskCount)
            ? Date.now() + clockOffsetRef.current
            : match.optimisticFinishedAt,
        },
      });
    }
    moveQueueRef.current.push({
      matchId: match.id,
      from,
      to,
      expectedMoves: match.myMoves,
    });
    void flushMoveQueue();
  };

  const leaveCurrentMatch = () => {
    const currentMatchId = snapshotRef.current?.match?.id;
    if (!currentMatchId) return;
    moveQueueRef.current = [];
    void sendAction("leave-match", { matchId: currentMatchId });
  };

  const resetCurrentBoard = async () => {
    setResetPending(true);
    try {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (!moveSendingRef.current && moveQueueRef.current.length === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (moveSendingRef.current || moveQueueRef.current.length) {
        showToast("Still confirming your last move. Try reset again in a moment.");
        return;
      }
      const match = snapshotRef.current?.match;
      if (!match) return;
      const next = await sendAction("reset", {
        matchId: match.id,
        expectedMoves: match.myMoves,
      });
      if (!next) setMoveReconciling(true);
    } finally {
      setResetPending(false);
    }
  };

  const activeRace = snapshot.match && !["finished", "abandoned"].includes(snapshot.match.status);
  const difficulty = mode === "sort" ? sortDifficulty : hanoiDifficulty;

  const beginPractice = (
    practiceMode: GameMode = mode,
    practiceTier: BoltSortTierId | HanoiTierId = difficulty,
    config?: PracticeConfig,
  ) => {
    setSelectedBolt(null);
    setHintText(null);
    const session = createPracticeSession(snapshot.player, practiceMode, practiceTier, config);
    setPracticeNow(session.snapshot.serverNow);
    setPractice(session);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const resumePractice = () => {
    if (!savedPractice) return;
    const { config, board, moves, elapsed, history, assisted } = savedPractice;
    const session = createPracticeSession(snapshot.player, config.mode, config.tier, config);
    session.snapshot.match = { ...session.snapshot.match!, myBoard: clonePracticeBoard(board), myMoves: moves,
      startsAt: Date.now() - elapsed, status: "playing", assisted } as Match;
    session.history = history;
    setSelectedBolt(null); setHintText(null); setPracticeNow(Date.now()); setPractice(session);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const pausePractice = () => {
    if (practice && practice.snapshot.match?.status !== "finished") {
      const saved = savedSession(practice);
      setSavedPractice(saved);
      try { localStorage.setItem(PRACTICE_SAVE_KEY, JSON.stringify(saved)); } catch { setStorageAvailable(false); }
    }
    setSelectedBolt(null); setHintText(null); setPractice(null);
  };

  const undoPractice = () => {
    setSelectedBolt(null); setHintText(null);
    setPractice((current) => {
      const match = current?.snapshot.match;
      if (!current || !match || match.status === "finished" || !current.history.length) return current;
      return { ...current, history: current.history.slice(0, -1), snapshot: { ...current.snapshot,
        match: { ...match, myBoard: clonePracticeBoard(current.history.at(-1)!), myMoves: match.myMoves - 1, assisted: true } as Match } };
    });
  };

  const hintPractice = () => {
    const match = practice?.snapshot.match;
    if (!practice || !match || match.status === "finished") return;
    const hint = match.mode === "hanoi" ? hanoiHint(match.myBoard, match.diskCount) : sortPracticeHint(practice.config, match.myBoard);
    if (hint) {
      setSelectedBolt(hint.from);
      setHintText(`Move ${match.mode === "sort" ? "the top group" : "the top ring"} from ${hint.from + 1} to ${hint.to + 1}.`);
      setPractice({ ...practice, snapshot: { ...practice.snapshot, match: { ...match, assisted: true } } });
    } else {
      setHintText("You’ve taken a different route. Undo to return to the guided path, or reset this puzzle for step-by-step hints.");
    }
  };

  const movePractice = (from: number, to: number) => {
    setHintText(null);
    setPractice((current) => {
      const match = current?.snapshot.match;
      if (!current || !match || match.status === "finished") return current;
      const now = Date.now();
      if (match.mode === "sort") {
        const result = moveBoltSortNut(match.myBoard, from, to, match.colorCount);
        if (!result.ok) return current;
        const solved = isBoltSortSolved(result.board, match.colorCount);
        return {
          ...current,
          history: [...current.history, clonePracticeBoard(match.myBoard)].slice(-200),
          snapshot: {
            ...current.snapshot,
            serverNow: now,
            match: {
              ...match,
              myBoard: result.board,
              myMoves: match.myMoves + 1,
              status: solved ? "finished" : "playing",
              finishedAt: solved ? now : null,
              winnerId: solved ? current.snapshot.player.id : null,
            },
          },
        };
      }
      const result = moveHanoiDisk(match.myBoard, from, to, match.diskCount);
      if (!result.ok) return current;
      const solved = isHanoiSolved(result.board, match.diskCount);
      return {
        ...current,
        history: [...current.history, clonePracticeBoard(match.myBoard)].slice(-200),
        snapshot: {
          ...current.snapshot,
          serverNow: now,
          match: {
            ...match,
            myBoard: result.board,
            myMoves: match.myMoves + 1,
            status: solved ? "finished" : "playing",
            finishedAt: solved ? now : null,
            winnerId: solved ? current.snapshot.player.id : null,
          },
        },
      };
    });
  };

  const resetPractice = () => {
    setSelectedBolt(null);
    setHintText(null);
    setPractice((current) => {
      const match = current?.snapshot.match;
      if (!current || !match) return current;
      const now = Date.now();
      return {
        ...current,
        history: [],
        snapshot: {
          ...current.snapshot,
          serverNow: now,
          match: {
            ...match,
            id: `practice:${crypto.randomUUID()}`,
            assisted: false,
            status: "playing",
            startsAt: now,
            finishedAt: null,
            winnerId: null,
            myBoard: clonePracticeBoard(current.initialBoard) as never,
            myMoves: 0,
          } as Match,
        },
      };
    });
    setPracticeNow(Date.now());
  };

  return (
    <>
      {practice ? (
        <Race
          practiceTools={<div className="practice-tools">
            <div className="practice-tool-buttons"><button type="button" onClick={undoPractice} disabled={!practice.history.length || practiceNow < practice.snapshot.match!.startsAt}>↶ UNDO</button><button type="button" onClick={hintPractice} disabled={practiceNow < practice.snapshot.match!.startsAt}>? HINT</button><button type="button" onClick={pausePractice}>Ⅱ PAUSE & SAVE</button></div>
            {hintText ? <p role="status">{hintText}</p> : <small>Hints follow a guided route. Undo is available for your last 200 moves.</small>}
          </div>}
          snapshot={practice.snapshot}
          now={practiceNow}
          selectedBolt={selectedBolt}
          setSelectedBolt={setSelectedBolt}
          busy={false}
          onMove={movePractice}
          onReset={resetPractice}
          onLeave={pausePractice}
          onRematch={() => {
            const match = practice.snapshot.match!;
            beginPractice(match.mode, match.tier, practice.config.dailyDate ? practice.config : undefined);
          }}
          onToast={showToast}
        />
      ) : snapshot.match ? (
        <Race
          snapshot={snapshot}
          now={clockNow}
          selectedBolt={selectedBolt}
          setSelectedBolt={setSelectedBolt}
          busy={busy || moveReconciling || resetPending}
          onMove={handleMove}
          onReset={() => void resetCurrentBoard()}
          onLeave={() => {
            if (activeRace) setConfirmingLeave(true);
            else leaveCurrentMatch();
          }}
          onRematch={() =>
            void sendAction("rematch", { matchId: snapshot.match?.id })
          }
          onToast={showToast}
        />
      ) : (
        <Lobby
          savedPractice={savedPractice} records={records} daily={dailyChallenge(todayNow)}
          onDaily={() => { const config = dailyChallenge(); beginPractice(config.mode, config.tier, config); }}
          onResume={resumePractice} onHelp={() => setHelpOpen(true)} connection={connected} now={todayNow}
          snapshot={snapshot}
          mode={mode}
          setMode={setMode}
          difficulty={difficulty}
          setDifficulty={(value) => {
            if (mode === "sort") setSortDifficulty(value as BoltSortTierId);
            else setHanoiDifficulty(value as HanoiTierId);
          }}
          busy={busy}
          onChallenge={(playerId) =>
            void sendAction("challenge", { playerId, mode, tier: difficulty })
          }
          onCancel={(inviteId) => void sendAction("cancel-invite", { inviteId })}
          onPractice={() => beginPractice()}
          onEditName={() => setEditingName(true)}
          onToast={showToast}
        />
      )}

      {practice && practice.snapshot.match?.status !== "finished" && !snapshot.match && snapshot.incoming[0] ? <div className="practice-invite" role="status">
        <span><b>{snapshot.incoming[0].player.name} wants to race.</b><small>Your solo puzzle will be saved.</small></span>
        <button type="button" disabled={busy} onClick={() => void sendAction("respond", { inviteId: snapshot.incoming[0].id, response: "decline" })}>DECLINE</button>
        <button type="button" disabled={busy} onClick={() => { pausePractice(); void sendAction("respond", { inviteId: snapshot.incoming[0].id, response: "accept" }); }}>RACE</button>
      </div> : null}

      {!practice && !helpOpen && !snapshot.match && snapshot.incoming[0] ? (
        <InviteSheet
          invite={snapshot.incoming[0]}
          busy={busy}
          onAccept={() =>
            void sendAction("respond", {
              inviteId: snapshot.incoming[0].id,
              response: "accept",
            })
          }
          onDecline={() =>
            void sendAction("respond", {
              inviteId: snapshot.incoming[0].id,
              response: "decline",
            })
          }
        />
      ) : null}

      {!practice && !helpOpen && editingName && !snapshot.incoming[0] ? (
        <NameDialog
          player={snapshot.player}
          busy={busy}
          onClose={() => setEditingName(false)}
          onSave={async (name) => {
            const next = await sendAction("rename", { name });
            if (next) setEditingName(false);
          }}
        />
      ) : null}

      {!practice && confirmingLeave && snapshot.match ? (
        <ConfirmLeaveDialog
          opponentName={snapshot.match.opponent.name}
          onCancel={() => setConfirmingLeave(false)}
          onConfirm={() => {
            setConfirmingLeave(false);
            leaveCurrentMatch();
          }}
        />
      ) : null}

      {helpOpen && !practice && !snapshot.match ? <HelpDialog mode={mode} onClose={() => setHelpOpen(false)} /> : null}
      {!connected && snapshot.match && !practice ? <div className="connection-banner" role="status">Connection interrupted. Reconnecting to your race…</div> : null}
      {!storageAvailable && !snapshot.match && !practice ? <p className="storage-notice" role="status">Device storage is unavailable. Your progress will stay available while this page is open.</p> : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </>
  );
}
