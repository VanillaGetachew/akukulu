'use client';

import { LUDO, ludoAbsoluteSquare, type LudoColor, type LudoView } from '@akukulu/shared';
import { useSession } from '@/lib/session';
import { Avatar, Countdown } from '@/components/ui';
import { nameOf, type TableProps } from './types';

const COLOR: Record<LudoColor, string> = { red: '#ff5a7a', green: '#2ee67a', yellow: '#ffc94a', blue: '#5aa8ff' };

/** The 52 shared squares as [row, col], starting at red's start square and running clockwise. */
const TRACK: [number, number][] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7],
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14],
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7],
  [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0],
  [6, 0],
];

const HOME_COLUMN: Record<LudoColor, [number, number][]> = {
  red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
};

const YARD: Record<LudoColor, [number, number][]> = {
  red: [[2, 2], [4, 2], [2, 4], [4, 4]],
  green: [[11, 2], [13, 2], [11, 4], [13, 4]],
  yellow: [[11, 11], [13, 11], [11, 13], [13, 13]],
  blue: [[2, 11], [4, 11], [2, 13], [4, 13]],
};

const FINISH: Record<LudoColor, [number, number]> = { red: [6.6, 7.5], green: [7.5, 6.6], yellow: [8.4, 7.5], blue: [7.5, 8.4] };

const YARD_ORIGIN: Record<LudoColor, [number, number]> = { red: [0, 0], green: [9, 0], yellow: [9, 9], blue: [0, 9] };

/** Board coordinates (x, y) of a token's centre. */
function tokenPoint(color: LudoColor, progress: number, index: number): [number, number] {
  if (progress === LUDO.YARD) return YARD[color][index];
  if (progress === LUDO.HOME) return FINISH[color];
  if (progress >= LUDO.HOME_COLUMN_START) {
    const [r, c] = HOME_COLUMN[color][progress - LUDO.HOME_COLUMN_START];
    return [c + 0.5, r + 0.5];
  }
  const [r, c] = TRACK[ludoAbsoluteSquare(color, progress)!];
  return [c + 0.5, r + 0.5];
}

const START_COLOR: Record<number, LudoColor> = { 0: 'red', 13: 'green', 26: 'yellow', 39: 'blue' };

function Die({ value, rolling }: { value: number | null; rolling: boolean }) {
  const pips: Record<number, [number, number][]> = {
    1: [[50, 50]],
    2: [[28, 28], [72, 72]],
    3: [[28, 28], [50, 50], [72, 72]],
    4: [[28, 28], [72, 28], [28, 72], [72, 72]],
    5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
    6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
  };
  return (
    <svg viewBox="0 0 100 100" className={`h-14 w-14 drop-shadow ${rolling ? 'animate-roll' : value ? 'animate-pop' : ''}`} aria-label={value ? `Die shows ${value}` : 'Die'} key={`${value}-${rolling}`}>
      <rect x="4" y="4" width="92" height="92" rx="20" fill="#f8f7ff" />
      {(value ? pips[value] : []).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="9" fill={value === 6 ? '#12b85a' : '#1b1b26'} />
      ))}
    </svg>
  );
}

export function LudoTable({ state, view, act, pending, serverNow }: TableProps<LudoView>) {
  const { user } = useSession();
  const me = view.players.find((p) => p.playerId === user?.id);
  const myTurn = view.currentPlayerId === user?.id && view.phase !== 'finished';
  const canRoll = myTurn && view.phase === 'roll' && !pending;
  const legal = new Set(view.legalTokens);

  // Spread tokens that share a square.
  const placed: { key: string; color: LudoColor; playerId: string; token: number; x: number; y: number; movable: boolean }[] = [];
  const stacks = new Map<string, number>();
  for (const p of view.players) {
    if (p.status === 'forfeited') continue;
    p.tokens.forEach((progress, i) => {
      const [x, y] = tokenPoint(p.color, progress, i);
      const k = `${x.toFixed(2)}:${y.toFixed(2)}`;
      const n = stacks.get(k) ?? 0;
      stacks.set(k, n + 1);
      const offset = n === 0 ? [0, 0] : [[0.18, -0.18], [-0.18, 0.18], [0.18, 0.18], [-0.18, -0.18]][(n - 1) % 4];
      placed.push({
        key: `${p.playerId}-${i}`,
        color: p.color,
        playerId: p.playerId,
        token: i,
        x: x + offset[0],
        y: y + offset[1],
        movable: myTurn && view.phase === 'move' && p.playerId === user?.id && legal.has(i),
      });
    });
  }

  const ev = view.lastEvent;
  const eventText = ev
    ? `${nameOf(state, ev.playerId)} ${
        ev.kind === 'forfeit'
          ? `left the game (${ev.reason})`
          : ev.kind === 'skip'
            ? `rolled ${ev.die} — ${ev.reason}`
            : ev.kind === 'move'
              ? `rolled ${ev.die} and moved${ev.captured?.length ? ' — capture!' : ''}${ev.to === LUDO.HOME ? ' — token home!' : ''}`
              : `rolled ${ev.die}`
      }`
    : 'Match started — good luck!';

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {view.players.map((p) => {
          const turn = p.playerId === view.currentPlayerId;
          const home = p.tokens.filter((t) => t === LUDO.HOME).length;
          const info = state.players.find((x) => x.userId === p.playerId);
          return (
            <div key={p.playerId} className={`card flex items-center gap-2 px-2.5 py-2 ${turn ? 'animate-pulseRing border-lime/60' : ''} ${p.status === 'forfeited' ? 'opacity-40' : ''}`}>
              <Avatar name={info?.displayName ?? '?'} photoUrl={info?.photoUrl} size={28} ring="ring-2" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLOR[p.color] }} />
                  {info?.displayName}
                  {p.playerId === user?.id && ' (you)'}
                </div>
                <div className="text-[10px] text-muted">{p.status === 'forfeited' ? 'Forfeited' : `${home}/4 home`}{view.winnerId === p.playerId && ' · Winner'}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card mx-auto w-full max-w-[min(100%,560px)] p-2">
        <svg viewBox="0 0 15 15" className="block aspect-square w-full touch-manipulation select-none" role="img" aria-label="Ludo board">
          <rect width="15" height="15" rx="0.4" fill="#120f2e" />
          {(Object.keys(YARD_ORIGIN) as LudoColor[]).map((c) => {
            const [x, y] = YARD_ORIGIN[c];
            return (
              <g key={c}>
                <rect x={x + 0.1} y={y + 0.1} width="5.8" height="5.8" rx="0.5" fill={COLOR[c]} opacity={me?.color === c ? 0.95 : 0.75} />
                <rect x={x + 0.9} y={y + 0.9} width="4.2" height="4.2" rx="0.5" fill="#120f2e" opacity=".85" />
                {YARD[c].map(([cx, cy], i) => (
                  <circle key={i} cx={cx} cy={cy} r="0.55" fill="none" stroke={COLOR[c]} strokeWidth="0.08" opacity=".7" />
                ))}
              </g>
            );
          })}
          {TRACK.map(([r, c], i) => {
            const start = START_COLOR[i];
            const safe = LUDO.SAFE_SQUARES.includes(i);
            return (
              <g key={i}>
                <rect x={c + 0.04} y={r + 0.04} width="0.92" height="0.92" rx="0.12" fill={start ? COLOR[start] : '#2a2452'} opacity={start ? 0.85 : 1} />
                {safe && !start && (
                  <text x={c + 0.5} y={r + 0.72} fontSize="0.62" textAnchor="middle" fill="#9a95bd">★</text>
                )}
              </g>
            );
          })}
          {(Object.keys(HOME_COLUMN) as LudoColor[]).map((c) =>
            HOME_COLUMN[c].map(([r, col], i) => (
              <rect key={`${c}${i}`} x={col + 0.04} y={r + 0.04} width="0.92" height="0.92" rx="0.12" fill={COLOR[c]} opacity="0.45" />
            )),
          )}
          <polygon points="6,6 6,9 7.5,7.5" fill={COLOR.red} />
          <polygon points="6,6 9,6 7.5,7.5" fill={COLOR.green} />
          <polygon points="9,6 9,9 7.5,7.5" fill={COLOR.yellow} />
          <polygon points="6,9 9,9 7.5,7.5" fill={COLOR.blue} />
          {placed.map((t) => (
            <g
              key={t.key}
              style={{ transform: `translate(${t.x}px, ${t.y}px)`, transition: 'transform .35s cubic-bezier(.2,.8,.2,1)', cursor: t.movable ? 'pointer' : 'default' }}
              onClick={() => t.movable && void act({ type: 'move', token: t.token })}
              role={t.movable ? 'button' : undefined}
              aria-label={t.movable ? `Move ${t.color} token ${t.token + 1}` : undefined}
            >
              {t.movable && <circle r="0.55" fill="none" stroke="#2ee67a" strokeWidth="0.1" className="animate-pulse" />}
              <circle r="0.36" fill={COLOR[t.color]} stroke="#07071a" strokeWidth="0.08" />
              <circle r="0.15" fill="#ffffff" opacity=".85" />
            </g>
          ))}
        </svg>
      </div>

      <div className="card flex items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-3">
          <Die value={view.die ?? ev?.die ?? null} rolling={pending && view.phase === 'roll'} />
          <div className="min-w-0">
            <div className="text-sm font-bold">
              {view.phase === 'finished'
                ? `${nameOf(state, view.winnerId)} wins!`
                : myTurn
                  ? view.phase === 'roll'
                    ? 'Your turn — roll the die'
                    : 'Tap a highlighted token'
                  : `${nameOf(state, view.currentPlayerId)}'s turn`}
            </div>
            <div className="truncate text-xs text-muted">{eventText}</div>
            {view.phase !== 'finished' && (
              <Countdown deadline={view.turnDeadline} serverNow={serverNow} total={view.config.turnSeconds} />
            )}
          </div>
        </div>
        <button className="btn-primary min-w-24 py-3 text-base" disabled={!canRoll} onClick={() => void act({ type: 'roll' })}>
          Roll
        </button>
      </div>
      {view.config.stake > 0 && (
        <p className="text-center text-xs text-muted">Pot: {view.config.stake * view.players.length} points to the winner</p>
      )}
    </div>
  );
}
