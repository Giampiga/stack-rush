"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BOLT_CAPACITY,
  BOLT_COLORS,
  BOLT_SORT_TIERS,
  boltSortProgress,
  getBoltSortProgress,
  isBoltSortSolved,
  isLockedBolt,
  listLegalBoltMoves,
  moveBoltSortNut,
  type BoltColor,
  type BoltSortBoard,
  type BoltSortTierId,
} from "@/lib/bolt-sort";

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
  tier: BoltSortTierId;
  colorCount: number;
  createdAt: number;
  player: Player;
};

type Match = {
  id: string;
  tier: BoltSortTierId;
  status: "countdown" | "playing" | "finished" | "abandoned";
  colorCount: number;
  startsAt: number;
  finishedAt: number | null;
  winnerId: string | null;
  myBoard: BoltSortBoard;
  opponentBoard: BoltSortBoard;
  myMoves: number;
  opponentMoves: number;
  myRematch: boolean;
  opponentRematch: boolean;
  opponent: Player & { online: boolean };
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
    <div className="brand" aria-label="Peg Rush">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>PEG RUSH</span>
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

function DifficultyPicker({
  value,
  onChange,
}: {
  value: BoltSortTierId;
  onChange: (value: BoltSortTierId) => void;
}) {
  const levels = Object.values(BOLT_SORT_TIERS);
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
          <strong>{level.colorCount}</strong>
          <span>{level.label.toUpperCase()}</span>
          <small>{level.colorCount + 2} BOLTS</small>
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
  difficulty,
  setDifficulty,
  busy,
  onChallenge,
  onCancel,
  onEditName,
  onToast,
}: {
  snapshot: Snapshot;
  difficulty: BoltSortTierId;
  setDifficulty: (value: BoltSortTierId) => void;
  busy: boolean;
  onChallenge: (playerId: string) => void;
  onCancel: (inviteId: string) => void;
  onEditName: () => void;
  onToast: (message: string) => void;
}) {
  const outgoing = snapshot.outgoing[0];
  const availableCount = snapshot.online.filter((player) => player.available).length;

  const shareLounge = async () => {
    const shareData = {
      title: "Peg Rush",
      text: "Race me in a live color-sort sprint—no account needed.",
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
            Same scramble. Same countdown. First to sort every color takes the win.
          </p>
        </div>
        <button type="button" className="share-button" onClick={shareLounge}>
          <UiIcon name="share" /> INVITE A FRIEND
        </button>
      </section>

      <div className="lobby-grid">
        <section className="lounge-panel">
          <div className="section-heading">
            <div>
              <span className="section-kicker">01 · CHOOSE YOUR RACE</span>
              <h2>HOW MANY COLORS?</h2>
            </div>
            <span className="par-note">MORE COLORS = BIGGER SCRAMBLE</span>
          </div>
          <DifficultyPicker value={difficulty} onChange={setDifficulty} />

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
                  Waiting for {outgoing.player.name} · {outgoing.colorCount} colors
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
            <h2>STACK SMART.<br />MOVE FAST.</h2>
            <ol>
              <li>
                <span>1</span>
                <p><b>TAP</b> a bolt to lift its top nut.</p>
              </li>
              <li>
                <span>2</span>
                <p><b>PLACE</b> it on an empty bolt or the same color.</p>
              </li>
              <li>
                <span>3</span>
                <p><b>SORT</b> four of every color before your rival.</p>
              </li>
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
                      selectedBolt === boltIndex && index === bolt.length - 1
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
            <span key={boltIndex} className={classes}>
              {contents}
            </span>
          );
        }
        return (
          <button
            key={boltIndex}
            type="button"
            className={classes}
            onClick={() => onBolt?.(boltIndex)}
            disabled={!interactive}
            aria-pressed={selectedBolt === boltIndex}
            aria-label={`Bolt ${boltIndex + 1} of ${board.length}. ${stackSummary} ${
              topNut
                ? `Top nut ${topNut}, marker ${nutIndex(topNut) + 1}.`
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
        <span className="result-kicker">{won ? "SORT SECURED" : "RACE COMPLETE"}</span>
        <h2 id="result-title">
          {won ? "YOU SORTED IT!" : `${match.opponent.name} GOT THERE FIRST`}
        </h2>
        <p>
          {won
            ? `A ${formatTime(elapsed)} finish in ${match.myMoves} moves.`
            : `You made ${match.myMoves} moves and reached ${myProgress}%.`}
        </p>
        <div className="result-score">
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
        </div>
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
                : "RACE AGAIN"}
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

function Race({
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
  const match = snapshot.match!;
  const [invalidBolt, setInvalidBolt] = useState<number | null>(null);
  const invalidTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdown = Math.max(
    0,
    Math.min(3, Math.ceil((match.startsAt - now) / 1_000)),
  );
  const ended = match.status === "finished" || match.status === "abandoned";
  const playable = !ended && now >= match.startsAt && !busy;
  const elapsed = (match.finishedAt ?? now) - match.startsAt;
  const myProgressInfo = getBoltSortProgress(match.myBoard, match.colorCount);
  const myProgress = myProgressInfo.percent;
  const opponentProgress = boltSortProgress(match.opponentBoard, match.colorCount);
  const deadlocked =
    !ended &&
    !isBoltSortSolved(match.myBoard, match.colorCount) &&
    listLegalBoltMoves(match.myBoard, match.colorCount).length === 0;

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
    <main className="race-shell">
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

      <section className="opponent-strip">
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
      </section>

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
            <b>{deadlocked ? "NO MOVES LEFT" : selectedBolt !== null ? "NUT LIFTED" : "YOUR MOVE"}</b>
            <span>
              {deadlocked
                ? "Reset to the shared starting scramble"
                : selectedBolt !== null
                ? "Tap an empty bolt or the same color"
                : "Tap any stack to lift its top nut"}
            </span>
          </div>
          {deadlocked ? (
            <button
              type="button"
              onClick={() => {
                setSelectedBolt(null);
                onReset();
              }}
              disabled={busy}
            >
              RESET
            </button>
          ) : selectedBolt !== null ? (
            <button type="button" onClick={() => setSelectedBolt(null)}>CANCEL</button>
          ) : null}
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
          {invite.colorCount} colors · {invite.colorCount + 2} bolts · shared countdown
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
        <Avatar player={{ ...player, name: name || player.name }} />
        <span className="section-kicker">YOUR GUEST NAME</span>
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

export function GameApp() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<BoltSortTierId>("endurance");
  const [busy, setBusy] = useState(false);
  const [moveReconciling, setMoveReconciling] = useState(false);
  const [selectedBolt, setSelectedBolt] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
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
    if (snapshotRef.current?.match?.id !== next.match?.id) {
      moveQueueRef.current = [];
      setSelectedBolt(null);
      setConfirmingLeave(false);
      setMoveReconciling(false);
    }
    if (next.incoming.length) setEditingName(false);
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
            current.match.myMoves > next.match.myMoves
          ) {
            next = {
              ...next,
              match: {
                ...next.match,
                myBoard: current.match.myBoard,
                myMoves: current.match.myMoves,
              },
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
    const local = moveBoltSortNut(match.myBoard, from, to, match.colorCount);
    if (!local.ok) return;
    applySnapshot({
      ...current,
      match: { ...match, myBoard: local.board, myMoves: match.myMoves + 1 },
    });
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

  return (
    <>
      {snapshot.match ? (
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
          difficulty={difficulty}
          setDifficulty={setDifficulty}
          busy={busy}
          onChallenge={(playerId) =>
            void sendAction("challenge", { playerId, tier: difficulty })
          }
          onCancel={(inviteId) => void sendAction("cancel-invite", { inviteId })}
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

      {editingName && !snapshot.incoming[0] ? (
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

      {confirmingLeave && snapshot.match ? (
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
