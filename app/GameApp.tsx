"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  moveHanoiDisk,
  perfectMoveCount,
  solvedProgress,
  type HanoiBoard,
} from "@/lib/hanoi";

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
  diskCount: number;
  createdAt: number;
  player: Player;
};

type Match = {
  id: string;
  status: "countdown" | "playing" | "finished" | "abandoned";
  diskCount: number;
  startsAt: number;
  finishedAt: number | null;
  winnerId: string | null;
  myBoard: HanoiBoard;
  opponentBoard: HanoiBoard;
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

class RequestError extends Error {
  constructor(
    message: string,
    readonly code = "REQUEST_FAILED",
  ) {
    super(message);
  }
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
  value: number;
  onChange: (value: number) => void;
}) {
  const levels = [
    { disks: 3, label: "QUICK", par: 7 },
    { disks: 4, label: "CLASSIC", par: 15 },
    { disks: 5, label: "EXPERT", par: 31 },
  ];
  return (
    <div className="difficulty" role="radiogroup" aria-label="Race difficulty">
      {levels.map((level) => (
        <button
          key={level.disks}
          type="button"
          role="radio"
          aria-checked={value === level.disks}
          className={value === level.disks ? "active" : ""}
          onClick={() => onChange(level.disks)}
        >
          <strong>{level.disks}</strong>
          <span>{level.label}</span>
          <small>PAR {level.par}</small>
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
  difficulty: number;
  setDifficulty: (value: number) => void;
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
      text: "Race me in Tower of Hanoi—no account needed.",
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
            Same rings. Same countdown. First to rebuild the tower takes the win.
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
              <h2>HOW MANY RINGS?</h2>
            </div>
            <span className="par-note">FEWER MOVES = CLEANER WIN</span>
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
              <span className="waiting-rings" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <div>
                <strong>CHALLENGE SENT</strong>
                <span>
                  Waiting for {outgoing.player.name} · {outgoing.diskCount} rings
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
                <span className="empty-tower" aria-hidden="true">
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
                <p><b>TAP</b> a peg to lift its top ring.</p>
              </li>
              <li>
                <span>2</span>
                <p><b>PLACE</b> it on an empty peg or a larger ring.</p>
              </li>
              <li>
                <span>3</span>
                <p><b>BUILD</b> the full tower on the right peg first.</p>
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

function HanoiBoardView({
  board,
  diskCount,
  selectedPeg,
  interactive,
  onPeg,
  mini = false,
}: {
  board: HanoiBoard;
  diskCount: number;
  selectedPeg: number | null;
  interactive: boolean;
  onPeg?: (peg: number) => void;
  mini?: boolean;
}) {
  const pegNames = ["start", "middle", "goal"];
  return (
    <div className={`hanoi-board${mini ? " mini-board" : ""}`}>
      {board.map((peg, pegIndex) => {
        const topDisk = peg.at(-1);
        return (
          <button
            key={pegIndex}
            type="button"
            className={`peg-zone${selectedPeg === pegIndex ? " selected" : ""}${
              pegIndex === 2 ? " goal-peg" : ""
            }`}
            onClick={() => onPeg?.(pegIndex)}
            disabled={!interactive}
            aria-label={`${pegNames[pegIndex]} peg, ${peg.length} ring${
              peg.length === 1 ? "" : "s"
            }${topDisk ? `, top ring ${topDisk}` : ""}`}
          >
            <span className="peg-rod" />
            <span className="disk-stack">
              {peg.map((disk, index) => (
                <span
                  key={disk}
                  className={`game-disk disk-${(disk - 1) % 5}${
                    selectedPeg === pegIndex && index === peg.length - 1
                      ? " lifted"
                      : ""
                  }`}
                  style={{
                    width: `${36 + (disk / diskCount) * 62}%`,
                    "--disk-order": index,
                  } as React.CSSProperties}
                >
                  <i>{disk}</i>
                </span>
              ))}
            </span>
            {!mini ? (
              <span className="peg-label">
                {pegIndex === 0 ? "START" : pegIndex === 1 ? "SWAP" : "FINISH"}
              </span>
            ) : null}
          </button>
        );
      })}
      <span className="board-base" />
    </div>
  );
}

function Race({
  snapshot,
  now,
  selectedPeg,
  setSelectedPeg,
  busy,
  onMove,
  onLeave,
  onRematch,
  onToast,
}: {
  snapshot: Snapshot;
  now: number;
  selectedPeg: number | null;
  setSelectedPeg: (value: number | null) => void;
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onLeave: () => void;
  onRematch: () => void;
  onToast: (message: string) => void;
}) {
  const match = snapshot.match!;
  const countdown = Math.max(
    0,
    Math.min(3, Math.ceil((match.startsAt - now) / 1_000)),
  );
  const ended = match.status === "finished" || match.status === "abandoned";
  const playable = !ended && now >= match.startsAt && !busy;
  const elapsed = (match.finishedAt ?? now) - match.startsAt;
  const myProgress = solvedProgress(match.myBoard, match.diskCount);
  const opponentProgress = solvedProgress(match.opponentBoard, match.diskCount);
  const won = ended && match.winnerId === snapshot.player.id;

  const handlePeg = (peg: number) => {
    if (!playable) return;
    if (selectedPeg === null) {
      if (!match.myBoard[peg].length) {
        onToast("That peg is empty.");
        return;
      }
      setSelectedPeg(peg);
      return;
    }
    if (selectedPeg === peg) {
      setSelectedPeg(null);
      return;
    }
    const localResult = moveHanoiDisk(
      match.myBoard,
      selectedPeg,
      peg,
      match.diskCount,
    );
    if (!localResult.ok) {
      onToast(localResult.reason);
      return;
    }
    const from = selectedPeg;
    setSelectedPeg(null);
    onMove(from, peg);
  };

  return (
    <main className="race-shell">
      <header className="race-topbar">
        <button type="button" className="icon-button" onClick={onLeave} aria-label="Leave race">
          <UiIcon name="back" />
        </button>
        <Brand />
        <div className="race-kind">
          <span>{match.diskCount} RINGS</span>
          <b>PAR {perfectMoveCount(match.diskCount)}</b>
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
        <div className="opponent-mini">
          <HanoiBoardView
            board={match.opponentBoard}
            diskCount={match.diskCount}
            selectedPeg={null}
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
            <span className="progress-track"><i style={{ width: `${myProgress}%` }} /></span>
            <b>{myProgress === 100 ? "TOWER COMPLETE" : "BUILD ON THE RIGHT"}</b>
          </div>
          <div>
            <span>MOVES</span>
            <strong>{match.myMoves}</strong>
          </div>
        </div>

        <div className="board-wrap">
          <span className="you-badge">YOUR BOARD</span>
          <HanoiBoardView
            board={match.myBoard}
            diskCount={match.diskCount}
            selectedPeg={selectedPeg}
            interactive={playable}
            onPeg={handlePeg}
          />
        </div>

        <div className="move-prompt" aria-live="polite">
          <span className={`prompt-icon${selectedPeg !== null ? " active" : ""}`}>
            {selectedPeg !== null ? <UiIcon name="check" /> : <span>1</span>}
          </span>
          <div>
            <b>{selectedPeg !== null ? "RING LIFTED" : "YOUR MOVE"}</b>
            <span>
              {selectedPeg !== null
                ? "Tap its destination peg"
                : "Tap any stack to lift its top ring"}
            </span>
          </div>
          {selectedPeg !== null ? (
            <button type="button" onClick={() => setSelectedPeg(null)}>CANCEL</button>
          ) : null}
        </div>
      </section>

      {countdown > 0 && !ended ? (
        <div className="countdown-overlay" role="status" aria-live="assertive">
          <div className="countdown-card">
            <span>GET READY</span>
            <strong key={countdown}>{countdown}</strong>
            <p>Same board. First tower wins.</p>
          </div>
        </div>
      ) : null}

      {ended ? (
        <div className="result-overlay" role="dialog" aria-modal="true" aria-labelledby="result-title">
          <div className={`result-card${won ? " won" : ""}`}>
            <div className="result-burst" aria-hidden="true"><i /><i /><i /><i /><i /></div>
            <span className="result-icon">
              {won ? <UiIcon name="trophy" /> : <UiIcon name="swords" />}
            </span>
            <span className="result-kicker">{won ? "TOWER SECURED" : "RACE COMPLETE"}</span>
            <h2 id="result-title">{won ? "YOU STACKED IT!" : `${match.opponent.name} GOT THERE FIRST`}</h2>
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
            <button
              type="button"
              className="primary-result"
              onClick={onRematch}
              disabled={busy || match.myRematch}
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
          </div>
        </div>
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
  return (
    <div className="sheet-backdrop">
      <section className="invite-sheet" role="dialog" aria-modal="true" aria-labelledby="invite-title">
        <div className="invite-versus">
          <Avatar player={invite.player} />
          <span><UiIcon name="swords" /></span>
          <span className="mystery-avatar">YOU</span>
        </div>
        <span className="section-kicker">INCOMING CHALLENGE</span>
        <h2 id="invite-title">{invite.player.name} WANTS TO RACE</h2>
        <p>
          {invite.diskCount} rings · par {perfectMoveCount(invite.diskCount)} · shared countdown
        </p>
        <div className="invite-actions">
          <button type="button" className="decline-button" onClick={onDecline} disabled={busy}>
            <UiIcon name="close" /> DECLINE
          </button>
          <button type="button" className="accept-button" onClick={onAccept} disabled={busy}>
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
  return (
    <div className="sheet-backdrop">
      <form
        className="name-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-title"
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

export function GameApp() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState(4);
  const [busy, setBusy] = useState(false);
  const [selectedPeg, setSelectedPeg] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [clockNow, setClockNow] = useState(0);
  const snapshotRef = useRef<Snapshot | null>(null);
  const busyRef = useRef(false);
  const clockOffsetRef = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applySnapshot = useCallback((next: Snapshot) => {
    if (snapshotRef.current?.match?.id !== next.match?.id) {
      setSelectedPeg(null);
      setConfirmingLeave(false);
    }
    snapshotRef.current = next;
    clockOffsetRef.current = next.serverNow - Date.now();
    setClockNow(next.serverNow);
    setSnapshot(next);
  }, []);

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
      try {
        const next = await gameRequest(action, payload);
        applySnapshot(next);
        return next;
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Try that again.");
        if (action === "move") {
          try {
            applySnapshot(await gameRequest("sync"));
          } catch {
            // The next poll will retry reconciliation.
          }
        }
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [applySnapshot, showToast],
  );

  useEffect(() => {
    let cancelled = false;
    gameRequest("session")
      .then((next) => {
        if (!cancelled) applySnapshot(next);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadingError(error instanceof Error ? error.message : "Couldn’t enter the lounge.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applySnapshot]);

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
      if (document.visibilityState === "visible" && !busyRef.current) {
        try {
          applySnapshot(await gameRequest("sync"));
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
  }, [hasSnapshot, applySnapshot]);

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
        <div className="loading-stack" aria-hidden="true"><i /><i /><i /><i /></div>
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
    const local = moveHanoiDisk(match.myBoard, from, to, match.diskCount);
    if (!local.ok) return;
    applySnapshot({
      ...current,
      match: { ...match, myBoard: local.board, myMoves: match.myMoves + 1 },
    });
    void sendAction("move", {
      matchId: match.id,
      from,
      to,
      expectedMoves: match.myMoves,
    });
  };

  const activeRace = snapshot.match && !["finished", "abandoned"].includes(snapshot.match.status);

  return (
    <>
      {snapshot.match ? (
        <Race
          snapshot={snapshot}
          now={clockNow}
          selectedPeg={selectedPeg}
          setSelectedPeg={setSelectedPeg}
          busy={busy}
          onMove={handleMove}
          onLeave={() => {
            if (activeRace) setConfirmingLeave(true);
            else void sendAction("leave-match");
          }}
          onRematch={() => void sendAction("rematch")}
          onToast={showToast}
        />
      ) : (
        <Lobby
          snapshot={snapshot}
          difficulty={difficulty}
          setDifficulty={setDifficulty}
          busy={busy}
          onChallenge={(playerId) =>
            void sendAction("challenge", { playerId, diskCount: difficulty })
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

      {editingName ? (
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

      {confirmingLeave ? (
        <div className="sheet-backdrop">
          <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="leave-title">
            <span className="warning-icon">!</span>
            <h2 id="leave-title">LEAVE THE RACE?</h2>
            <p>Leaving now awards the win to {snapshot.match?.opponent.name}.</p>
            <div>
              <button type="button" onClick={() => setConfirmingLeave(false)}>KEEP RACING</button>
              <button
                type="button"
                className="danger-button"
                onClick={() => {
                  setConfirmingLeave(false);
                  void sendAction("leave-match");
                }}
              >
                FORFEIT
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </>
  );
}
