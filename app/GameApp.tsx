"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BOLT_CAPACITY,
  BOLT_COLORS,
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
  isHanoiSolved,
  moveHanoiDisk,
  type HanoiBoard,
  type HanoiTierId,
} from "@/lib/hanoi";
import { raceElapsed } from "@/lib/race-timer";

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

function formatTime(milliseconds: number) {
  const safe = Math.max(0, milliseconds);
  const minutes = Math.floor(safe / 60_000);
  const seconds = ((safe % 60_000) / 1_000).toFixed(1);
  return minutes ? `${minutes}:${seconds.padStart(4, "0")}` : `${seconds}s`;
}

function recordLabel(player: Player) {
  if (!player.races) return "New racer";
  return `${player.wins} win${player.wins === 1 ? "" : "s"} · ${player.races} races`;
}

function ModePicker({ value, onChange }: { value: GameMode; onChange: (value: GameMode) => void }) {
  return (
    <div className="mode-picker" role="radiogroup" aria-label="Puzzle mode">
      <button type="button" role="radio" aria-checked={value === "sort"} className={value === "sort" ? "active" : ""} onClick={() => onChange("sort")}>
        <span aria-hidden="true">⬢</span><b>NUTS &amp; BOLTS</b><small>COLOR STACKS</small>
      </button>
      <button type="button" role="radio" aria-checked={value === "hanoi"} className={value === "hanoi" ? "active" : ""} onClick={() => onChange("hanoi")}>
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
    <div className="difficulty" role="radiogroup" aria-label="Race difficulty">
      {levels.map((level) => (
        <button
          key={level.id}
          type="button"
          role="radio"
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
}: {
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
          <span className="live-pill">
            <UiIcon name="wifi" /> LIVE
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
            PICK A RIVAL.
            <br />
            <em>RACE THE PUZZLE.</em>
          </h1>
          <p>
            Same puzzle. Same countdown. First to finish takes the win.
          </p>
        </div>
        <div className="hero-actions">
          <button type="button" className="practice-button" onClick={onPractice} disabled={busy || Boolean(outgoing)}>
            <UiIcon name="zap" /> PRACTICE SOLO
          </button>
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

          <div className="rivals-heading">
            <div>
              <span className="section-kicker">02 · CHOOSE YOUR RIVAL</span>
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
                  busy={busy || Boolean(outgoing)}
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
          <div className="your-record">
            <span className="section-kicker">YOUR RUN</span>
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
              <UiIcon name="zap" /> NO HINTS. NO PAUSES. PURE RACE.
            </div>
          </div>
        </aside>
      </div>

      <footer className="lobby-footer">
        <span>NO ACCOUNT. JUST RACE.</span>
        <span>SERVER-CHECKED MOVES · LIVE OPPONENT PROGRESS</span>
      </footer>
    </main>
  );
}

function nutIndex(nut: BoltColor) {
  return BOLT_COLORS.indexOf(nut);
}

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
              .map((nut) => `${nut}, marker ${nutIndex(nut) + 1}`)
              .join(", ")}.`
          : "Empty.";
        const contents = (
          <>
            <span className="bolt-rod" />
            <span className="nut-stack">
              {bolt.map((nut, index) => {
                const color = nutIndex(nut);
                return (
                  <span
                    key={`${nut}-${index}`}
                    className={`game-nut nut-${color}${
                      selectedBolt === boltIndex && index >= bolt.length - groupSize
                        ? " lifted"
                        : ""
                    }`}
                  >
                    <i>{color + 1}</i>
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
                ? `Top group ${groupSize} ${topNut} nut${groupSize === 1 ? "" : "s"}, marker ${nutIndex(topNut) + 1}.`
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
        <span className="result-kicker">{match.practice ? "PRACTICE COMPLETE" : won ? (match.mode === "sort" ? "SORT SECURED" : "TOWER SECURED") : "RACE COMPLETE"}</span>
        <h2 id="result-title">
          {won ? (match.mode === "sort" ? "YOU SORTED IT!" : "YOU BUILT IT!") : `${match.opponent.name} GOT THERE FIRST`}
        </h2>
        <p>
          {won
            ? `A ${formatTime(elapsed)} finish in ${match.myMoves} moves.`
            : `You made ${match.myMoves} moves and reached ${myProgress}%.`}
        </p>
        {match.practice ? <div className="practice-result-summary"><b>{formatTime(elapsed)}</b><span>{match.myMoves} MOVES</span></div> : <div className="result-score">
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
                : match.practice ? "TRY ANOTHER" : "RACE AGAIN"}
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
    <div className={`hanoi-board${mini ? " mini-hanoi-board" : ""}`} role={mini ? undefined : "group"} aria-label={mini ? undefined : `${diskCount}-ring Tower of Hanoi board`} aria-hidden={mini || undefined}>
      {board.map((peg, pegIndex) => {
        const contents = <><span className="hanoi-rod" /><span className="ring-stack">{peg.map((disk, index) => <span key={disk} className={`hanoi-ring ring-${disk}${selectedPeg === pegIndex && index === peg.length - 1 ? " lifted" : ""}`} style={{ width: `${32 + (disk / diskCount) * 64}%` }}><i>{disk}</i></span>)}</span><span className="hanoi-base" /></>;
        if (mini) return <span key={pegIndex} className="hanoi-peg">{contents}</span>;
        return <button key={pegIndex} type="button" className={`hanoi-peg${selectedPeg === pegIndex ? " selected" : ""}${invalidPeg === pegIndex ? " invalid" : ""}`} disabled={!interactive} onClick={() => onPeg?.(pegIndex)} aria-pressed={selectedPeg === pegIndex} aria-label={`Tower ${pegIndex + 1}. ${peg.length ? `Bottom to top: ${peg.join(", ")}.` : "Empty."}`}>{contents}</button>;
      })}
    </div>
  );
}

function HanoiRace({
  snapshot, now, selectedPeg, setSelectedPeg, busy, onMove, onReset, onLeave, onRematch, onToast,
}: {
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
    {match.practice ? <section className="practice-strip"><UiIcon name="zap" /><div><span>SOLO PRACTICE</span><b>LEARN THE PATTERN · NO STATS COUNTED</b></div></section> : <section className="opponent-strip"><div className="opponent-identity"><Avatar player={match.opponent} small /><div><span>YOUR RIVAL</span><strong>{match.opponent.name}</strong></div><i className={match.opponent.online ? "online" : "offline"}>{match.opponent.online ? "LIVE" : "RECONNECTING"}</i></div><div className="opponent-mini" role="img" aria-label={`Opponent tower, ${opponentProgress} percent complete`}><HanoiBoardView board={match.opponentBoard} diskCount={match.diskCount} selectedPeg={null} interactive={false} mini /></div><div className="opponent-stats"><strong>{opponentProgress}%</strong><span>{match.opponentMoves} MOVES</span></div></section>}
    <section className="race-stage"><div className="race-stats"><div><span>TIME</span><strong>{formatTime(elapsed)}</strong></div><div className="race-status-center"><span className="progress-track" role="progressbar" aria-label="Tower complete" aria-valuemin={0} aria-valuemax={100} aria-valuenow={myProgress}><i style={{ width: `${myProgress}%` }} /></span><b>{match.myBoard[2].length} / {match.diskCount} RINGS ON GOAL</b></div><div><span>MOVES</span><strong>{match.myMoves}</strong></div></div>
      <div className="board-wrap"><span className="you-badge">YOUR BOARD</span><HanoiBoardView board={match.myBoard} diskCount={match.diskCount} selectedPeg={selectedPeg} invalidPeg={invalidPeg} interactive={playable} onPeg={handlePeg} /></div>
      <div className="move-prompt" aria-live="polite"><span className={`prompt-icon${selectedPeg !== null ? " active" : ""}`}>{selectedPeg !== null ? <UiIcon name="check" /> : <span>1</span>}</span><div><b>{selectedPeg !== null ? "RING LIFTED" : "YOUR MOVE"}</b><span>{selectedPeg !== null ? "Tap an empty tower or a larger ring" : "Tap a tower to lift its top ring"}</span></div><div className="prompt-actions">{selectedPeg !== null ? <button type="button" onClick={() => setSelectedPeg(null)}>CANCEL</button> : null}<button type="button" onClick={() => { setSelectedPeg(null); onReset(); }} disabled={busy}>RESET</button></div></div>
    </section>
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
}: {
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

      {match.practice ? <section className="practice-strip"><UiIcon name="zap" /><div><span>SOLO PRACTICE</span><b>TEST THE SCRAMBLE · RESET ANYTIME</b></div></section> : <section className="opponent-strip">
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
                ? "Reset to the shared starting scramble"
                : selectedBolt !== null
                ? "Place the full matching group where it fits"
                : "Tap any stack to lift its matching top group"}
            </span>
          </div>
          <div className="prompt-actions">
            {!deadlocked && selectedBolt !== null ? <button type="button" onClick={() => setSelectedBolt(null)}>CANCEL</button> : null}
            <button type="button" onClick={() => { setSelectedBolt(null); onReset(); }} disabled={busy}>RESET</button>
          </div>
        </div>
      </section>

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

function clonePracticeBoard(board: BoltSortBoard | HanoiBoard): BoltSortBoard | HanoiBoard {
  return board.map((stack) => [...stack]) as BoltSortBoard | HanoiBoard;
}

function createPracticeSession(
  player: Player,
  mode: GameMode,
  tier: BoltSortTierId | HanoiTierId,
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
      `practice:${crypto.randomUUID()}`,
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
    };
  }
  return {
    initialBoard: clonePracticeBoard(initialBoard),
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
  const [sortDifficulty, setSortDifficulty] = useState<BoltSortTierId>("endurance");
  const [hanoiDifficulty, setHanoiDifficulty] = useState<HanoiTierId>("classic");
  const [busy, setBusy] = useState(false);
  const [moveReconciling, setMoveReconciling] = useState(false);
  const [selectedBolt, setSelectedBolt] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [practice, setPractice] = useState<PracticeSession | null>(null);
  const [practiceNow, setPracticeNow] = useState(0);
  const [clockNow, setClockNow] = useState(0);
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
    if (next.incoming.length) setEditingName(false);
    if (next.match) setPractice(null);
    snapshotRef.current = next;
    clockOffsetRef.current = next.serverNow - Date.now();
    setClockNow(next.serverNow);
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
            showToast("Connection interrupted. Reconnecting…");
          } finally {
            setMoveReconciling(false);
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
          // Presence is best effort; the next scheduled poll retries.
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

  if (!snapshot) {
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
    setMoveReconciling(true);
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
      await sendAction("reset", {
        matchId: match.id,
        expectedMoves: match.myMoves,
      });
    } finally {
      setMoveReconciling(false);
    }
  };

  const activeRace = snapshot.match && !["finished", "abandoned"].includes(snapshot.match.status);
  const difficulty = mode === "sort" ? sortDifficulty : hanoiDifficulty;

  const beginPractice = (
    practiceMode: GameMode = mode,
    practiceTier: BoltSortTierId | HanoiTierId = difficulty,
  ) => {
    setSelectedBolt(null);
    const session = createPracticeSession(snapshot.player, practiceMode, practiceTier);
    setPracticeNow(session.snapshot.serverNow);
    setPractice(session);
  };

  const movePractice = (from: number, to: number) => {
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
    setPractice((current) => {
      const match = current?.snapshot.match;
      if (!current || !match) return current;
      const now = Date.now();
      return {
        ...current,
        snapshot: {
          ...current.snapshot,
          serverNow: now,
          match: {
            ...match,
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
          snapshot={practice.snapshot}
          now={practiceNow}
          selectedBolt={selectedBolt}
          setSelectedBolt={setSelectedBolt}
          busy={false}
          onMove={movePractice}
          onReset={resetPractice}
          onLeave={() => {
            setSelectedBolt(null);
            setPractice(null);
          }}
          onRematch={() => {
            const match = practice.snapshot.match!;
            beginPractice(match.mode, match.tier);
          }}
          onToast={showToast}
        />
      ) : snapshot.match ? (
        <Race
          snapshot={snapshot}
          now={clockNow}
          selectedBolt={selectedBolt}
          setSelectedBolt={setSelectedBolt}
          busy={busy || moveReconciling}
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

      {!snapshot.match && snapshot.incoming[0] ? (
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

      {!practice && editingName && !snapshot.incoming[0] ? (
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

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </>
  );
}
