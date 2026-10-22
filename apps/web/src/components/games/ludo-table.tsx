'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LUDO, ludoAbsoluteSquare, type LudoColor, type LudoView } from '@akukulu/shared';
import { useSession } from '@/lib/session';
import { Avatar } from '@/components/ui';
import { useViewportHeight, useWidth } from './card-table';
import { nameOf, type TableProps } from './types';

/** Classic board colours. */
const COLOR: Record<LudoColor, string> = { red: '#e53935', green: '#2e9e48', yellow: '#f6b80e', blue: '#1f7fdc' };
const LIGHT: Record<LudoColor, string> = { red: '#ff8a80', green: '#7be08f', yellow: '#ffe082', blue: '#82c1ff' };
const DARK: Record<LudoColor, string> = { red: '#8e1b1b', green: '#145c27', yellow: '#9a6a00', blue: '#0d4a8a' };

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

/** Yard spots as (x, y), and each yard's top-left corner (x, y). */
const YARD: Record<LudoColor, [number, number][]> = {
  red: [[2, 2], [4, 2], [2, 4], [4, 4]],
  green: [[11, 2], [13, 2], [11, 4], [13, 4]],
  yellow: [[11, 11], [13, 11], [11, 13], [13, 13]],
  blue: [[2, 11], [4, 11], [2, 13], [4, 13]],
};
const YARD_ORIGIN: Record<LudoColor, [number, number]> = { red: [0, 0], green: [9, 0], yellow: [9, 9], blue: [0, 9] };
const FINISH: Record<LudoColor, [number, number]> = { red: [6.6, 7.5], green: [7.5, 6.6], yellow: [8.4, 7.5], blue: [7.5, 8.4] };
/** The square just before each colour's start square, where the entry arrow sits, and which way it points. */
const ENTRY: Record<LudoColor, { at: [number, number]; rot: number }> = {
  red: { at: [7, 0], rot: 0 },
  green: { at: [0, 7], rot: 90 },
  yellow: { at: [7, 14], rot: 180 },
  blue: { at: [14, 7], rot: 270 },
};
const START_COLOR: Record<number, LudoColor> = { 0: 'red', 13: 'green', 26: 'yellow', 39: 'blue' };
/** Board turns so the viewer's yard is always bottom-left (blue's corner). Degrees clockwise. */
const TURN: Record<LudoColor, number> = { blue: 0, red: 270, green: 180, yellow: 90 };
const STEP_MS = 150;

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

/** Rotates a board point about the centre by `deg` (a multiple of 90, clockwise). */
function turn([x, y]: [number, number], deg: number): [number, number] {
  const k = ((deg / 90) % 4 + 4) % 4;
  let p: [number, number] = [x - 7.5, y - 7.5];
  for (let i = 0; i < k; i++) p = [-p[1], p[0]];
  return [p[0] + 7.5, p[1] + 7.5];
}

function Star({ x, y, size, fill, stroke }: { x: number; y: number; size: number; fill: string; stroke?: string }) {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? size * 0.42 : size;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    return `${x + r * Math.cos(a)},${y + r * Math.sin(a)}`;
  }).join(' ');
  return <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={stroke ? 0.04 : 0} strokeLinejoin="round" />;
}

/** A glossy pin pawn standing on (0, 0) (its base), in board units. */
function Pawn({ color }: { color: LudoColor }) {
  return (
    <g>
      {/* Soft shadow falling to the lower right. */}
      <ellipse cx="0.12" cy="0.3" rx="0.31" ry="0.14" fill="url(#pawn-shadow)" />
      {/* A pin: flared body with a rounded base, slim neck, round head. */}
      <path
        d="M -0.075 -0.3 C -0.09 -0.13 -0.26 0.03 -0.27 0.18 C -0.28 0.3 -0.15 0.34 0 0.34 C 0.15 0.34 0.28 0.3 0.27 0.18 C 0.26 0.03 0.09 -0.13 0.075 -0.3 Z"
        fill={`url(#pawn-body-${color})`}
        stroke={DARK[color]}
        strokeWidth="0.018"
      />
      <ellipse cx="0" cy="-0.3" rx="0.1" ry="0.035" fill={DARK[color]} opacity="0.55" />
      <circle cx="0" cy="-0.43" r="0.165" fill={`url(#pawn-${color})`} stroke={DARK[color]} strokeWidth="0.018" />
      {/* Highlights: a streak down the body and a spot on the head. */}
      <path d="M -0.13 0.2 C -0.14 0.07 -0.08 -0.09 -0.045 -0.2" fill="none" stroke="#fff" strokeWidth="0.04" strokeLinecap="round" opacity="0.5" />
      <ellipse cx="-0.055" cy="-0.49" rx="0.055" ry="0.038" fill="#fff" opacity="0.85" />
    </g>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[30, 30], [70, 70]],
  3: [[30, 30], [50, 50], [70, 70]],
  4: [[30, 30], [70, 30], [30, 70], [70, 70]],
  5: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]],
  6: [[30, 28], [70, 28], [30, 50], [70, 50], [30, 72], [70, 72]],
};

/** Where each value sits on the cube, and the cube turn that brings that face to the front. */
const FACES: { value: number; place: string; show: string }[] = [
  { value: 1, place: 'rotateY(0deg)', show: 'rotateY(0deg)' },
  { value: 6, place: 'rotateY(180deg)', show: 'rotateY(180deg)' },
  { value: 3, place: 'rotateY(90deg)', show: 'rotateY(-90deg)' },
  { value: 4, place: 'rotateY(-90deg)', show: 'rotateY(90deg)' },
  { value: 5, place: 'rotateX(90deg)', show: 'rotateX(-90deg)' },
  { value: 2, place: 'rotateX(-90deg)', show: 'rotateX(90deg)' },
];

/** The flat die in a player's corner (no value yet: faint pips). */
function DieFace({ value, spinning }: { value: number | null; spinning?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className={`h-full w-full ${spinning ? 'animate-roll' : value ? 'animate-pop' : ''}`} key={`${value}-${spinning}`}>
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#fbfaf5" stroke="#d6d2c4" strokeWidth="3" />
      {(value ? PIPS[value] : [[30, 30], [70, 70]]).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="9.5" fill={value ? '#1b1b26' : '#c9c4b6'} />
      ))}
    </svg>
  );
}

/**
 * The thrown die, in 3D: a cube with six pipped faces. It tumbles in the air and lands
 * with the rolled face looking straight at you (only slightly tipped), so the number is
 * easy to read.
 */
function Dice3D({ value, spinning, size }: { value: number | null; spinning?: boolean; size: number }) {
  const show = FACES.find((f) => f.value === (value ?? 5))!.show;
  return (
    <div className="dice3d" style={{ width: size, height: size }}>
      <div className={`dice3d-cube ${spinning ? 'tumbling' : ''}`} style={spinning ? undefined : { transform: `rotateX(-9deg) rotateY(11deg) ${show}` }}>
        {FACES.map((f) => (
          <div key={f.value} className="dice3d-face" style={{ transform: `${f.place} translateZ(${size / 2}px)` }}>
            <svg viewBox="0 0 100 100" className="h-full w-full">
              <defs>
                <radialGradient id={`pip-${size}`} cx="40%" cy="35%" r="65%">
                  <stop offset="0" stopColor="#4a4a58" />
                  <stop offset="1" stopColor="#101018" />
                </radialGradient>
              </defs>
              {PIPS[f.value].map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r="9.5" fill={f.value === 1 ? '#c8102e' : `url(#pip-${size})`} />
              ))}
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}

interface Throw {
  /** Release point and landing point, in screen pixels. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  spin: number;
  bx: number;
  by: number;
  key: number;
  /** The server has answered the roll. */
  resolved: boolean;
  /** The die has come down on the board (it lies flat from then on). */
  landed: boolean;
}

/** How long a throw flies before it lands (the ludo-throw animation runs 1.15 s, touching down at ~70%). */
const THROW_LAND_MS = 820;

/**
 * The die in a player's corner. Tap it to roll in place (as before), or press, drag and
 * let go to pick it up and throw it: it flies onto the board where it was thrown.
 */
function Die({
  value,
  rolling,
  active,
  onRoll,
  onThrow,
}: {
  value: number | null;
  rolling: boolean;
  active: boolean;
  onRoll: () => void;
  onThrow: (at: { x: number; y: number }, velocity: { vx: number; vy: number }) => void;
}) {
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const trail = useRef<{ x: number; y: number; t: number }[]>([]);
  const end = () => {
    start.current = null;
    setDrag(null);
  };
  return (
    <div
      role="button"
      tabIndex={active ? 0 : -1}
      aria-disabled={!active}
      aria-label={active ? 'Roll the die (tap), or drag and let go to throw it' : value ? `Die shows ${value}` : 'Die'}
      onKeyDown={(e) => active && (e.key === 'Enter' || e.key === ' ') && onRoll()}
      onPointerDown={(e) => {
        if (!active) return;
        start.current = { x: e.clientX, y: e.clientY };
        trail.current = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ dx: 0, dy: 0 });
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        trail.current = [...trail.current.slice(-5), { x: e.clientX, y: e.clientY, t: performance.now() }];
        setDrag({ dx: e.clientX - start.current.x, dy: e.clientY - start.current.y });
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const moved = Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y);
        const first = trail.current[0];
        const dt = Math.max(16, performance.now() - first.t);
        end();
        if (moved < 12) onRoll();
        else onThrow({ x: e.clientX, y: e.clientY }, { vx: (e.clientX - first.x) / dt, vy: (e.clientY - first.y) / dt });
      }}
      onPointerCancel={end}
      className={`relative z-[38] grid h-14 w-14 shrink-0 touch-none select-none place-items-center rounded-2xl bg-[#13306b] p-1.5 shadow-lg ring-2 ${active ? 'cursor-grab ring-white' : 'ring-[#2a4c9a]'} ${active && !drag ? 'animate-pulseRing' : ''}`}
      style={drag ? { transform: `translate(${drag.dx}px, ${drag.dy}px) scale(1.15) rotate(${drag.dx / 4}deg)`, cursor: 'grabbing' } : { transition: 'transform .15s' }}
    >
      <DieFace value={value} spinning={rolling} />
    </div>
  );
}

/**
 * Shown positions of every token: each move walks one square at a time instead of
 * jumping, and a captured token goes back to its yard once the capturing move is done.
 */
function useWalkingTokens(players: LudoView['players']) {
  const target = useMemo(() => Object.fromEntries(players.flatMap((p) => p.tokens.map((t, i) => [`${p.playerId}-${i}`, t]))), [players]);
  const [shown, setShown] = useState<Record<string, number>>(target);
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    const t = setInterval(() => {
      setShown((prev) => {
        const goal = targetRef.current;
        const next = { ...prev };
        let changed = false;
        const walking = Object.keys(goal).some((k) => goal[k] !== LUDO.YARD && (prev[k] ?? goal[k]) !== goal[k]);
        for (const k of Object.keys(goal)) {
          const from = prev[k] ?? goal[k];
          const to = goal[k];
          if (from === to) continue;
          changed = true;
          if (to === LUDO.YARD) {
            // Captured: wait for the capturing token to arrive, then go home.
            if (!walking) next[k] = LUDO.YARD;
          } else if (from === LUDO.YARD) next[k] = 0;
          else if (from < to) next[k] = from + 1;
          else next[k] = to;
        }
        return changed ? next : prev;
      });
    }, STEP_MS);
    return () => clearInterval(t);
  }, []);
  return shown;
}

/** One player's corner outside the board: avatar, name, and the die when it is their turn. */
function Corner({
  name,
  photoUrl,
  color,
  you,
  turn,
  home,
  out,
  winner,
  right,
  die,
}: {
  name: string | null;
  photoUrl?: string | null;
  color: LudoColor;
  you: boolean;
  turn: boolean;
  home: number;
  out: boolean;
  winner: boolean;
  right: boolean;
  die: React.ReactNode;
}) {
  return (
    <div className={`flex items-center gap-2 ${right ? 'flex-row-reverse' : ''} ${out ? 'opacity-40' : ''}`}>
      <div className={`relative grid h-14 w-14 shrink-0 place-items-center rounded-xl border-[3px] bg-[#c9d6f2] shadow-md ${turn ? 'border-white' : 'border-[#e8eefb]'}`} style={turn ? { boxShadow: `0 0 0 3px ${COLOR[color]}` } : undefined}>
        {name ? (
          <Avatar name={name} photoUrl={photoUrl} size={44} />
        ) : (
          <svg viewBox="0 0 40 40" className="h-11 w-11" aria-hidden="true">
            <circle cx="20" cy="15" r="8" fill="#f4f7ff" />
            <path d="M5 38 C5 27 12 24 20 24 C28 24 35 27 35 38 Z" fill="#f4f7ff" />
          </svg>
        )}
        {name && <span className="absolute -bottom-1.5 -right-1.5 h-4 w-4 rounded-full border-2 border-white" style={{ background: COLOR[color] }} />}
      </div>
      {name && (
        <div className={`min-w-0 ${right ? 'text-right' : ''}`}>
          <div className="max-w-[6.5rem] truncate text-xs font-extrabold text-white">{you ? 'You' : name}</div>
          <div className="text-[10px] font-semibold text-white/70">{out ? 'left' : winner ? 'Winner!' : `${home}/4 home`}</div>
        </div>
      )}
      {die}
    </div>
  );
}

export function LudoTable({ state, view, act, pending, serverNow }: TableProps<LudoView>) {
  const { user } = useSession();
  const me = view.players.find((p) => p.playerId === user?.id);
  const myTurn = view.currentPlayerId === user?.id && view.phase !== 'finished';
  const canRoll = myTurn && view.phase === 'roll' && !pending;
  const legal = new Set(view.legalTokens);
  const deg = TURN[me?.color ?? 'blue'];
  const shown = useWalkingTokens(view.players);
  const boardRef = useRef<SVGSVGElement>(null);

  // A thrown die flies from where it was let go to a spot on the board in the throw's direction.
  const [thrown, setThrown] = useState<Throw | null>(null);
  const throwDie = (at: { x: number; y: number }, v: { vx: number; vy: number }) => {
    const b = boardRef.current?.getBoundingClientRect();
    if (!b) return void act({ type: 'roll' });
    const pad = 34;
    const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
    const x1 = clamp(at.x + v.vx * 340, b.left + pad, b.right - pad);
    const y1 = clamp(at.y + v.vy * 340, b.top + pad, b.bottom - pad);
    const dir = v.vx >= 0 ? 1 : -1;
    const key = Date.now();
    setThrown({
      x0: at.x,
      y0: at.y,
      x1,
      y1,
      spin: dir * (420 + Math.random() * 240),
      bx: clamp(v.vx * 18, -16, 16),
      by: clamp(v.vy * 18, -16, 16),
      key,
      resolved: false,
      landed: false,
    });
    setTimeout(() => setThrown((t) => (t && t.key === key ? { ...t, landed: true } : t)), THROW_LAND_MS);
    void act({ type: 'roll' }).then(() => setThrown((t) => (t && t.key === key ? { ...t, resolved: true } : t)));
  };
  // The landed die stays on the board while the move is made, then is picked up again.
  // After a six (or another extra roll) it comes back to your corner quickly so you can go again.
  const settled = !!thrown?.resolved && !!thrown?.landed;
  useEffect(() => {
    if (!settled || view.phase !== 'roll') return;
    const t = setTimeout(() => setThrown(null), myTurn ? 700 : 1400);
    return () => clearTimeout(t);
  }, [settled, view.phase, view.turn, myTurn]);
  // My die is off the board and back in my corner whenever I may roll again.
  const dieInCorner = !thrown || (settled && view.phase === 'roll');

  // A little confetti burst whenever a pawn reaches home.
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  const prevShown = useRef(shown);
  useEffect(() => {
    const prev = prevShown.current;
    prevShown.current = shown;
    const arrived = Object.keys(shown).filter((k) => shown[k] === LUDO.HOME && prev[k] !== undefined && prev[k] !== LUDO.HOME);
    if (!arrived.length) return;
    const added = arrived.map((k, i) => {
      const owner = view.players.find((p) => k.startsWith(`${p.playerId}-`))!;
      const [x, y] = turn(FINISH[owner.color], deg);
      return { id: Date.now() + i, x, y };
    });
    setBursts((b) => [...b, ...added]);
    const t = setTimeout(() => setBursts((b) => b.filter((x) => !added.includes(x))), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  // A fixed board size from the screen, so it never zooms in or out during play.
  const [boxRef, boxWidth] = useWidth<HTMLDivElement>();
  const vh = useViewportHeight();
  const size = Math.max(240, Math.min(boxWidth, vh - 250, 600));

  // Tokens at their shown positions, spread when several share a square.
  const placed: { key: string; color: LudoColor; token: number; x: number; y: number; movable: boolean }[] = [];
  const stacks = new Map<string, number>();
  for (const p of view.players) {
    if (p.status === 'forfeited') continue;
    p.tokens.forEach((_, i) => {
      const key = `${p.playerId}-${i}`;
      const [x, y] = turn(tokenPoint(p.color, shown[key] ?? p.tokens[i], i), deg);
      const k = `${x.toFixed(2)}:${y.toFixed(2)}`;
      const n = stacks.get(k) ?? 0;
      stacks.set(k, n + 1);
      const offset = n === 0 ? [0, 0] : [[0.24, -0.14], [-0.24, 0.14], [0.24, 0.14], [-0.24, -0.14]][(n - 1) % 4];
      placed.push({ key, color: p.color, token: i, x: x + offset[0], y: y + offset[1], movable: myTurn && view.phase === 'move' && p.playerId === user?.id && legal.has(i) });
    });
  }
  // Lower tokens are drawn last so they overlap the ones behind them.
  placed.sort((a, b) => a.y - b.y);

  // Which colour sits in each outside corner after turning the board.
  const cornerOf = (c: LudoColor) => {
    const [x, y] = turn([YARD_ORIGIN[c][0] + 3, YARD_ORIGIN[c][1] + 3], deg);
    return `${y < 7.5 ? 't' : 'b'}${x < 7.5 ? 'l' : 'r'}`;
  };
  const corners: Record<string, LudoColor> = Object.fromEntries((Object.keys(YARD_ORIGIN) as LudoColor[]).map((c) => [cornerOf(c), c]));
  const playerOf = (c: LudoColor) => view.players.find((p) => p.color === c) ?? null;
  const dieValue = view.die ?? view.lastEvent?.die ?? null;
  const corner = (pos: string) => {
    const color = corners[pos];
    const p = playerOf(color);
    const info = p ? state.players.find((x) => x.userId === p.playerId) : null;
    const isTurn = !!p && p.playerId === view.currentPlayerId && view.phase !== 'finished';
    return (
      <Corner
        key={pos}
        name={info?.displayName ?? null}
        photoUrl={info?.photoUrl}
        color={color}
        you={p?.playerId === user?.id}
        turn={isTurn}
        home={p ? p.tokens.filter((t) => t === LUDO.HOME).length : 0}
        out={p?.status === 'forfeited'}
        winner={!!p && view.winnerId === p.playerId}
        right={pos.endsWith('r')}
        die={
          // My die leaves the corner while it is on the board after a throw.
          isTurn && !(p?.playerId === user?.id && !dieInCorner) ? (
            <Die value={dieValue} rolling={pending && view.phase === 'roll'} active={canRoll} onRoll={() => void act({ type: 'roll' })} onThrow={throwDie} />
          ) : null
        }
      />
    );
  };

  const ev = view.lastEvent;
  const status =
    view.phase === 'finished'
      ? `${nameOf(state, view.winnerId)} wins!`
      : myTurn
        ? view.phase === 'roll'
          ? 'Your turn — tap the die'
          : 'Tap a glowing pawn to move it'
        : `${nameOf(state, view.currentPlayerId)}'s turn`;
  const eventText = ev
    ? `${nameOf(state, ev.playerId)} ${
        ev.kind === 'forfeit'
          ? `left the game (${ev.reason})`
          : ev.kind === 'skip'
            ? `rolled ${ev.die} — ${ev.reason}`
            : ev.kind === 'move'
              ? `rolled ${ev.die} and moved${ev.captured?.length ? ' — capture!' : ''}${ev.to === LUDO.HOME ? ' — pawn home!' : ''}`
              : `rolled ${ev.die}`
      }`
    : 'Match started — good luck!';

  const yardLabel = (c: LudoColor) => {
    const p = playerOf(c);
    if (!p) return null;
    const [x, y] = turn([YARD_ORIGIN[c][0] + 3, YARD_ORIGIN[c][1] + 3], deg);
    const top = y < 7.5;
    return (
      <text key={`l-${c}`} x={x} y={top ? y - 2.45 : y + 2.75} fontSize="0.5" fontWeight="800" textAnchor="middle" fill="#fff" fontFamily="'Inter', 'Segoe UI', sans-serif">
        {p.playerId === user?.id ? 'YOU' : (nameOf(state, p.playerId) ?? '').slice(0, 14)}
      </text>
    );
  };

  return (
    <div className="ludo-bg fixed inset-0 z-[35] flex flex-col overflow-hidden text-white">
      {thrown && (
        // The thrown die tumbling to where it was thrown; it shows the number once the server answers.
        <div
          key={thrown.key}
          className="pointer-events-none fixed left-0 top-0 z-[38] grid h-14 w-14 place-items-center drop-shadow-[0_10px_8px_rgba(0,0,0,.4)]"
          style={
            {
              animation: 'ludo-throw 1.15s cubic-bezier(.2,.7,.3,1) both',
              '--x0': `${thrown.x0}px`,
              '--y0': `${thrown.y0}px`,
              '--x1': `${thrown.x1}px`,
              '--y1': `${thrown.y1}px`,
              '--spin': `${thrown.spin}deg`,
              '--bx': `${thrown.bx}px`,
              '--by': `${thrown.by}px`,
            } as React.CSSProperties
          }
        >
          {/* 3D only while it flies; once it lands it lies flat on one face, so the number is plain to read. */}
          {settled && dieValue ? (
            <div className="h-12 w-12 drop-shadow-[0_4px_4px_rgba(0,0,0,.35)]">
              <DieFace value={dieValue} />
            </div>
          ) : (
            <Dice3D value={null} spinning size={46} />
          )}
        </div>
      )}
      <Link href="/games/ludo" aria-label="Back to the lobby" className="absolute left-2 top-2 z-[36] grid h-8 w-8 place-items-center rounded-full bg-black/30 text-sm font-bold">
        ←
      </Link>
      <div className="mx-auto flex min-h-0 w-full max-w-[600px] flex-1 flex-col justify-center px-2 pt-10">
        <div className="mb-2 flex items-start justify-between">
          {corner('tl')}
          {corner('tr')}
        </div>
        <div ref={boxRef} className="w-full">
          {/* overflow visible: a pawn standing on the top row reaches above the board's edge. */}
          <svg
            ref={boardRef}
            viewBox="0 0 15 15"
            width={size}
            height={size}
            className="mx-auto block touch-manipulation select-none"
            style={{ overflow: 'visible' }}
            role="img"
            aria-label="Ludo board"
          >
            <defs>
              {(Object.keys(COLOR) as LudoColor[]).map((c) => (
                <g key={c}>
                  <radialGradient id={`pawn-${c}`} cx="35%" cy="30%" r="75%">
                    <stop offset="0" stopColor={LIGHT[c]} />
                    <stop offset="0.55" stopColor={COLOR[c]} />
                    <stop offset="1" stopColor={DARK[c]} />
                  </radialGradient>
                  <linearGradient id={`pawn-body-${c}`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor={LIGHT[c]} />
                    <stop offset="0.4" stopColor={COLOR[c]} />
                    <stop offset="1" stopColor={DARK[c]} />
                  </linearGradient>
                </g>
              ))}
              <radialGradient id="pawn-shadow" cx="50%" cy="50%" r="50%">
                <stop offset="0" stopColor="#000" stopOpacity="0.38" />
                <stop offset="1" stopColor="#000" stopOpacity="0" />
              </radialGradient>
            </defs>
            <g transform={`rotate(${deg} 7.5 7.5)`}>
              <rect width="15" height="15" rx="0.45" fill="#fff" stroke="#163a7a" strokeWidth="0.08" />
              {/* Yards: a coloured corner with a rounded white box and four spots. */}
              {(Object.keys(YARD_ORIGIN) as LudoColor[]).map((c) => {
                const [x, y] = YARD_ORIGIN[c];
                return (
                  <g key={c}>
                    <rect x={x} y={y} width="6" height="6" rx={0.45} fill={COLOR[c]} />
                    <rect x={x + 1} y={y + 1} width="4" height="4" rx="0.45" fill="#fff" stroke={DARK[c]} strokeWidth="0.05" />
                    {YARD[c].map(([cx, cy], i) => (
                      <circle key={i} cx={cx} cy={cy} r="0.42" fill="#cfd3da" />
                    ))}
                  </g>
                );
              })}
              {/* Track squares, home columns, start squares, stars and entry arrows. */}
              {TRACK.map(([r, c], i) => (
                <rect key={i} x={c} y={r} width="1" height="1" fill="#fff" stroke="#b9c2cf" strokeWidth="0.035" />
              ))}
              {(Object.keys(HOME_COLUMN) as LudoColor[]).map((c) =>
                HOME_COLUMN[c].map(([r, col], i) => <rect key={`${c}${i}`} x={col} y={r} width="1" height="1" fill={COLOR[c]} stroke="#b9c2cf" strokeWidth="0.035" />),
              )}
              {LUDO.SAFE_SQUARES.filter((i) => !START_COLOR[i]).map((i) => {
                const [r, c] = TRACK[i];
                return <rect key={`g${i}`} x={c + 0.05} y={r + 0.05} width="0.9" height="0.9" fill="#d7dbe2" />;
              })}
              {(Object.keys(ENTRY) as LudoColor[]).map((c) => {
                const { at, rot } = ENTRY[c];
                return (
                  <path
                    key={`e${c}`}
                    d="M -0.17 -0.25 L 0.13 0 L -0.17 0.25"
                    fill="none"
                    stroke={COLOR[c]}
                    strokeWidth="0.13"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    transform={`translate(${at[1] + 0.5} ${at[0] + 0.5}) rotate(${rot})`}
                  />
                );
              })}
              {/* Centre: the four home triangles. */}
              <polygon points="6,6 6,9 7.5,7.5" fill={COLOR.red} />
              <polygon points="6,6 9,6 7.5,7.5" fill={COLOR.green} />
              <polygon points="9,6 9,9 7.5,7.5" fill={COLOR.yellow} />
              <polygon points="6,9 9,9 7.5,7.5" fill={COLOR.blue} />
            </g>
            {/* Safe-square stars, drawn upright after turning the board: a start square shows a star in
                its colour, the other safe squares a white star on grey. */}
            {LUDO.SAFE_SQUARES.map((i) => {
              const [r, c] = TRACK[i];
              const [x, y] = turn([c + 0.5, r + 0.5], deg);
              const start = START_COLOR[i];
              return start ? (
                <Star key={`s${i}`} x={x} y={y} size={0.38} fill={COLOR[start]} stroke={DARK[start]} />
              ) : (
                <Star key={`s${i}`} x={x} y={y} size={0.36} fill="#fff" />
              );
            })}
            {(Object.keys(YARD_ORIGIN) as LudoColor[]).map(yardLabel)}
            {placed.map((t) => (
              <g
                key={t.key}
                style={{ transform: `translate(${t.x}px, ${t.y + 0.02}px)`, transition: `transform ${STEP_MS - 20}ms ease-out`, cursor: t.movable ? 'pointer' : 'default' }}
                onClick={() => t.movable && void act({ type: 'move', token: t.token })}
                role={t.movable ? 'button' : undefined}
                aria-label={t.movable ? `Move ${t.color} pawn ${t.token + 1}` : undefined}
              >
                {/* Pawns a quarter bigger; one you can move stands in a gently breathing ring. */}
                <g transform="scale(1.25)">
                  {t.movable && <ellipse cy="0.29" rx="0.36" ry="0.17" fill="rgba(255,255,255,.28)" stroke="#fff" strokeWidth="0.045" className="ludo-ring" />}
                  <Pawn color={t.color} />
                </g>
              </g>
            ))}
            {/* Confetti when a pawn gets home. */}
            {bursts.map((b) => (
              <g key={b.id} transform={`translate(${b.x} ${b.y})`} aria-hidden="true">
                {Array.from({ length: 22 }, (_, i) => {
                  const a = (Math.PI * 2 * i) / 22;
                  const dist = 1.1 + (i % 3) * 0.45;
                  return (
                    <rect
                      key={i}
                      x="-0.07"
                      y="-0.04"
                      width="0.14"
                      height="0.08"
                      rx="0.02"
                      fill={(['#e53935', '#2e9e48', '#f6b80e', '#1f7fdc', '#ffffff'] as const)[i % 5]}
                      style={
                        {
                          animation: `ludo-confetti 1.1s cubic-bezier(.15,.7,.3,1) ${(i % 4) * 0.04}s both`,
                          '--dx': `${Math.cos(a) * dist}px`,
                          '--dy': `${Math.sin(a) * dist + 0.5}px`,
                          '--r': `${(i % 2 ? 1 : -1) * 540}deg`,
                        } as React.CSSProperties
                      }
                    />
                  );
                })}
              </g>
            ))}
          </svg>
        </div>
        <div className="mt-2 flex items-end justify-between">
          {corner('bl')}
          {corner('br')}
        </div>
      </div>
      <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-[600px] rounded-xl bg-[#0d2457]/80 px-3 py-2 shadow-inner">
          <div className="flex items-center justify-between gap-2 text-sm font-bold">
            <span className="truncate">{status}</span>
            {view.phase !== 'finished' && <TurnClock deadline={view.turnDeadline} serverNow={serverNow} total={view.config.turnSeconds} />}
          </div>
          <div className="truncate text-xs text-white/70">{eventText}</div>
          {view.config.stake > 0 && <div className="text-[11px] text-white/60">Pot: {view.config.stake * view.players.length} points to the winner</div>}
        </div>
      </div>
    </div>
  );
}

/** A small countdown: seconds left and a thin bar. */
function TurnClock({ deadline, serverNow, total }: { deadline: number | null; serverNow: () => number; total: number }) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(t);
  }, [serverNow]);
  const left = deadline ? Math.max(0, deadline - now) : 0;
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/20">
        <span className="block h-full rounded-full bg-white transition-[width] duration-200" style={{ width: `${Math.min(100, (left / (total * 1000)) * 100)}%` }} />
      </span>
      <span className="w-8 text-right tabular-nums">{Math.ceil(left / 1000)}s</span>
    </span>
  );
}
