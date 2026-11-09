'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { PENALTY_REVEAL_MS, PENALTY_SIDES, type PenaltyLastKick, type PenaltyPlayerView, type PenaltySide, type PenaltyView } from '@akukulu/shared';
import { useSession } from '@/lib/session';
import { haptic } from '@/lib/telegram';
import { Countdown } from '@/components/ui';
import { nameOf, type TableProps } from './types';

const SIDE_X: Record<PenaltySide, number> = { left: 112, center: 180, right: 248 };
const SIDE_DIR: Record<PenaltySide, number> = { left: -1, center: 0, right: 1 };
const SIDE_LABEL: Record<PenaltySide, string> = { left: 'Left', center: 'Middle', right: 'Right' };
const SPOT = { x: 180, y: 248 };
const KEEPER_HOME = { x: 180, y: 128 };
const SHIRTS = ['#e6c77f', '#3fb6d9'];
const CONFETTI = ['#2b9a5a', '#e6c77f', '#c8443c', '#ffffff'];

/** The kick, in milliseconds from the start of its animation. */
const T = { crouch: 300, strike: 520, impact: 980, end: PENALTY_REVEAL_MS };

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const range = (ms: number, from: number, to: number) => clamp((ms - from) / (to - from));
/** A quick swell that settles a little past full size. */
const pop = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2);

const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Plays a kick from start to end, returning the current time within it. */
function useKickClock(kick: PenaltyLastKick | null): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!kick) {
      setMs(0);
      return;
    }
    // Without motion, go straight to the result.
    if (prefersReducedMotion()) {
      setMs(T.impact + 700);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const elapsed = now - start;
      setMs(elapsed);
      if (elapsed < T.end) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [kick]);
  return ms;
}

const targetOf = (kick: PenaltyLastKick) => ({ x: SIDE_X[kick.aim], y: kick.aim === 'center' ? 80 : 92 });

function ballPose(kick: PenaltyLastKick | null, ms: number) {
  if (!kick || ms < T.strike) return { x: SPOT.x, y: SPOT.y, scale: 1, spin: 0, shadowX: SPOT.x, shadowY: SPOT.y + 7, shadow: 0.5 };
  const target = targetOf(kick);
  const dir = SIDE_DIR[kick.aim];
  if (ms < T.impact) {
    // Rising, curling flight towards the goal.
    const t = easeOut(range(ms, T.strike, T.impact));
    const cx = (SPOT.x + target.x) / 2 - dir * 26;
    const cy = (SPOT.y + target.y) / 2 - 30;
    const x = (1 - t) ** 2 * SPOT.x + 2 * (1 - t) * t * cx + t * t * target.x;
    const y = (1 - t) ** 2 * SPOT.y + 2 * (1 - t) * t * cy + t * t * target.y;
    return { x, y, scale: lerp(1, 0.56, t), spin: t * 900, shadowX: x, shadowY: lerp(SPOT.y + 7, 134, t), shadow: lerp(0.5, 0.18, t) };
  }
  if (kick.goal) {
    // Into the net, then dropping to the ground behind the line.
    const t = range(ms, T.impact, T.impact + 620);
    const y = t < 0.25 ? lerp(target.y, target.y - 6, t / 0.25) : lerp(target.y - 6, 124, ((t - 0.25) / 0.75) ** 2);
    return { x: target.x + dir * 3 * t, y, scale: 0.5, spin: 900 + t * 220, shadowX: target.x, shadowY: 130, shadow: 0.25 };
  }
  // Pushed away by the keeper, bouncing out into the box.
  const away = dir === 0 ? (kick.seq % 2 ? 1 : -1) : dir;
  const t = range(ms, T.impact, T.impact + 900);
  const x = target.x + away * 92 * easeOut(t);
  const ground = lerp(target.y, 184, t);
  const hop = Math.abs(Math.sin(t * Math.PI * 2)) * 30 * (1 - t);
  return { x, y: ground - hop, scale: lerp(0.56, 0.82, t), spin: 900 - t * 700, shadowX: x, shadowY: ground + 6, shadow: 0.3 };
}

function keeperPose(kick: PenaltyLastKick | null, ms: number) {
  const home = { x: KEEPER_HOME.x, y: KEEPER_HOME.y, rotate: 0, squat: 1, arms: 0.35, reach: 0 };
  if (!kick) return home;
  const crouch = range(ms, T.crouch, T.strike);
  if (ms < T.strike) return { ...home, squat: lerp(1, 0.86, crouch), arms: lerp(0.35, 0.2, crouch) };
  const dir = SIDE_DIR[kick.dive];
  const t = easeInOut(range(ms, T.strike + 30, T.impact - 20));
  const fall = range(ms, T.impact + 80, T.impact + 700);
  if (dir === 0) {
    // Holding the middle: a spring straight up with both arms high.
    const jump = Math.sin(t * Math.PI * 0.5) * 16 * (1 - fall);
    return { ...home, y: KEEPER_HOME.y - jump, squat: 1, arms: lerp(0.2, 1, t), reach: t };
  }
  // A full stretch, flattening out and landing on the ground.
  const lift = Math.sin(t * Math.PI) * 24;
  return {
    x: lerp(KEEPER_HOME.x, SIDE_X[kick.dive], t),
    y: KEEPER_HOME.y - lift * (1 - fall * 0.6) + fall * 2,
    rotate: dir * lerp(0, 74, t),
    squat: 1,
    arms: lerp(0.2, 1, t),
    reach: t,
  };
}

/** The goalkeeper. Pivots at the feet; `arms` goes from low (0) to fully overhead (1). */
function Keeper({ pose, shirt }: { pose: ReturnType<typeof keeperPose>; shirt: string }) {
  const armY = lerp(-14, -40, pose.arms);
  const armX = lerp(23, 9, pose.arms);
  const stretch = 1 + pose.reach * 0.1;
  return (
    <g transform={`translate(${pose.x} ${pose.y}) rotate(${pose.rotate}) scale(1 ${pose.squat * stretch})`}>
      <path d="M-5-18-7-1M5-18 7-1" stroke="#202a38" strokeWidth="6" strokeLinecap="round" />
      <rect x="-9" y="-40" width="18" height="24" rx="5" fill={shirt} />
      <path d={`M-8-36 ${-armX} ${armY - 2}M8-36 ${armX} ${armY - 2}`} stroke={shirt} strokeWidth="6" strokeLinecap="round" />
      <circle cx={-armX} cy={armY - 4} r="4" fill="#f5f5f5" />
      <circle cx={armX} cy={armY - 4} r="4" fill="#f5f5f5" />
      <circle cy="-47" r="7" fill="#c98f62" />
    </g>
  );
}

/** The penalty taker, seen from behind: a run-up to the ball, then the kicking leg comes through. */
function Kicker({ ms, active, shirt }: { ms: number; active: boolean; shirt: string }) {
  const run = active ? easeInOut(range(ms, 0, T.strike)) : 0;
  const x = lerp(132, 170, run);
  const y = lerp(292, 268, run);
  const stride = active && ms < T.strike ? Math.sin(ms / 34) * 7 : 0;
  const swing = active ? Math.sin(range(ms, T.strike - 110, T.strike + 190) * Math.PI) : 0;
  const lean = active ? lerp(0, -8, run) + swing * 10 : 0;
  return (
    <g transform={`translate(${x} ${y}) rotate(${lean})`}>
      <ellipse cy="1" rx="17" ry="5" fill="#000" opacity=".25" />
      <path d={`M-5-22 ${-7 - stride} -1`} stroke="#e8c39e" strokeWidth="6.5" strokeLinecap="round" />
      <path d={`M5-22 ${7 + stride + swing * 12} ${-1 - swing * 15}`} stroke="#e8c39e" strokeWidth="6.5" strokeLinecap="round" />
      <path d="M-11-30H11L9-18H-9Z" fill="#101827" />
      <rect x="-12" y="-54" width="24" height="26" rx="6" fill={shirt} />
      <path d="M-12-49-19-33M12-49 19-33" stroke={shirt} strokeWidth="6.5" strokeLinecap="round" />
      <circle cy="-62" r="8" fill="#5a3a26" />
    </g>
  );
}

function Ball({ pose }: { pose: ReturnType<typeof ballPose> }) {
  return (
    <>
      <ellipse cx={pose.shadowX} cy={pose.shadowY} rx={8 * pose.scale} ry={3 * pose.scale} fill="#000" opacity={pose.shadow} />
      <g transform={`translate(${pose.x} ${pose.y}) scale(${pose.scale}) rotate(${pose.spin})`}>
        <circle r="8" fill="#fff" stroke="#1c2430" strokeWidth="1.2" />
        <path d="M0-3.6 3.4-1.1 2.1 2.9H-2.1L-3.4-1.1Z" fill="#1c2430" />
        <path d="M0-3.6V-7.6M3.4-1.1 7.2-2.3M2.1 2.9 4.4 6.3M-2.1 2.9-4.4 6.3M-3.4-1.1-7.2-2.3" stroke="#1c2430" strokeWidth=".9" />
      </g>
    </>
  );
}

/** The net: a ball hitting it pushes the mesh out, then it wobbles and settles. */
function Net({ kick, ms }: { kick: PenaltyLastKick | null; ms: number }) {
  const hit = kick?.goal && ms > T.impact ? (ms - T.impact) / 1000 : null;
  const power = hit === null ? 0 : Math.exp(-hit * 4.2) * Math.cos(hit * 24) * 20;
  const target = kick ? targetOf(kick) : { x: 0, y: 0 };
  const bend = (x: number, y: number): [number, number] => {
    if (!power) return [x, y];
    const dx = x - target.x;
    const dy = y - target.y;
    const pull = (power * Math.exp(-(dx * dx + dy * dy) / 1500)) / 20;
    return [x - dx * pull * 0.45, y - dy * pull * 0.45 - pull * 9];
  };
  const line = (points: [number, number][]) => `M${points.map(([x, y]) => bend(x, y).map((v) => v.toFixed(1)).join(' ')).join('L')}`;
  return (
    <g stroke="#dfe7f2" strokeOpacity=".32" strokeWidth=".8" fill="none">
      {Array.from({ length: 16 }, (_, i) => {
        const x = 72 + i * 14.4;
        return <path key={`v${i}`} d={line(Array.from({ length: 9 }, (_, k) => [x, 46 + k * 10.75] as [number, number]))} />;
      })}
      {Array.from({ length: 7 }, (_, i) => {
        const y = 46 + i * 14.3;
        return <path key={`h${i}`} d={line(Array.from({ length: 17 }, (_, k) => [72 + k * 13.5, y] as [number, number]))} />;
      })}
    </g>
  );
}

/** Everything that never moves. Kept apart so the crowd isn't redrawn on every frame. */
const Stands = memo(function Stands() {
  return (
    <>
      {Array.from({ length: 5 }, (_, row) =>
        Array.from({ length: 46 }, (_, i) => (
          <circle key={`${row}-${i}`} cx={4 + i * 8 + (row % 2) * 4} cy={10 + row * 9} r="2.1" fill={['#2b9a5a', '#e6c77f', '#c8443c', '#5b6c8f'][(i * 7 + row * 3) % 4]} opacity={0.34 + row * 0.08} />
        )),
      )}
    </>
  );
});

const Grass = memo(function Grass() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} y={132 + i * 28} width="360" height="28" fill={i % 2 ? '#256b3b' : '#2c7a45'} />
      ))}
      <path d="M0 132H360M70 132 44 206H316L290 132" fill="none" stroke="#e9f3ea" strokeOpacity=".7" strokeWidth="2" />
      <circle cx={SPOT.x} cy={SPOT.y} r="2.6" fill="#e9f3ea" />
    </>
  );
});

function Confetti({ ms }: { ms: number }) {
  const t = (ms - T.impact) / 1000;
  if (t <= 0) return null;
  return (
    <g>
      {Array.from({ length: 40 }, (_, i) => {
        // Spread from the goal by fixed offsets, so each piece keeps its own path.
        const angle = ((i * 137.5) % 180) * (Math.PI / 180);
        const speed = 90 + ((i * 53) % 120);
        const x = 180 + Math.cos(angle) * speed * t * 1.35;
        const y = 70 - Math.sin(angle) * speed * t + 150 * t * t;
        const flip = Math.cos(t * 10 + i) * 4;
        return <rect key={i} x={x} y={y} width="4" height={Math.abs(flip) + 1} fill={CONFETTI[i % 4]} opacity={clamp(1.5 - t * 0.8)} transform={`rotate(${i * 31 + t * 300} ${x} ${y})`} />;
      })}
    </g>
  );
}

function Banner({ goal, ms }: { goal: boolean; ms: number }) {
  const t = range(ms, T.impact, T.impact + 300);
  if (t <= 0) return null;
  return (
    <g transform={`translate(180 186) scale(${pop(t)})`} opacity={clamp((T.end - ms) / 220)}>
      <text textAnchor="middle" fontFamily="var(--font-display), system-ui, sans-serif" fontStyle="italic" fontWeight="900" fontSize="58" fill={goal ? '#ffcf3f' : '#ffffff'} stroke="#071022" strokeWidth="7" strokeLinejoin="round" paintOrder="stroke">
        {goal ? 'GOAL!' : 'SAVED!'}
      </text>
    </g>
  );
}

function Pitch({ kick, ms, kickerShirt, keeperShirt, zones }: { kick: PenaltyLastKick | null; ms: number; kickerShirt: string; keeperShirt: string; zones: React.ReactNode }) {
  const goal = !!kick?.goal;
  const since = kick ? ms - T.impact : -1;
  const shaking = since > 0 && since < 320;
  const shake = shaking ? Math.sin(since / 16) * (goal ? 4 : 2) * (1 - since / 320) : 0;
  // The stands jump when a goal goes in.
  const crowdHop = goal && since > 0 ? Math.abs(Math.sin(since / 110)) * 3 * clamp(1 - since / 1500) : 0;
  const flash = kick && since > 0 ? clamp(1 - since / 260) : 0;
  const ball = ballPose(kick, ms);
  const keeper = keeperPose(kick, ms);
  // The ball passes behind the keeper's hands on a save, and in front of the net on a goal.
  return (
    <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-line">
      <svg viewBox="0 0 360 300" className="block w-full" aria-hidden="true">
        <defs>
          <linearGradient id="pk-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0b1224" />
            <stop offset="1" stopColor="#16264a" />
          </linearGradient>
        </defs>
        <g transform={`translate(${shake} ${shake * 0.4})`}>
          <rect x="-8" y="-8" width="376" height="140" fill="url(#pk-sky)" />
          <g transform={`translate(0 ${-crowdHop})`}>
            <Stands />
          </g>
          <Grass />
          <Net kick={kick} ms={ms} />
          <path d="M72 132V46H288V132" fill="none" stroke="#f5f7fb" strokeWidth="5" strokeLinejoin="round" />
          {kick && !kick.goal && since > -40 && since < 240 && (
            <circle cx={targetOf(kick).x} cy={targetOf(kick).y} r={8 + since / 7} fill="none" stroke="#ffffff" strokeWidth="3" opacity={clamp(1 - since / 240)} />
          )}
          <g className={kick ? undefined : 'pk-idle'}>
            <Keeper pose={keeper} shirt={keeperShirt} />
          </g>
          <Ball pose={ball} />
          <Kicker ms={ms} active={!!kick} shirt={kickerShirt} />
          {goal && <Confetti ms={ms} />}
        </g>
        {flash > 0 && <rect width="360" height="300" fill={goal ? '#ffe9a8' : '#ffffff'} opacity={flash * 0.28} />}
        {kick && <Banner goal={kick.goal} ms={ms} />}
      </svg>
      {zones}
    </div>
  );
}

function ScoreRow({ player, name, config, active }: { player: PenaltyPlayerView; name: string; config: PenaltyView['config']; active: boolean }) {
  const slots = Math.max(config.kicks, player.kicks.length);
  return (
    <div className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 transition-colors ${active ? 'bg-lime/10' : 'bg-black/20'}`}>
      <span className="min-w-0 truncate text-sm font-bold">{name}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        {Array.from({ length: slots }, (_, i) => {
          const k = player.kicks[i];
          return (
            <span
              key={`${i}-${k ?? 'none'}`}
              role="img"
              aria-label={k === 'goal' ? 'Goal' : k === 'saved' ? 'Saved' : 'Not taken'}
              className={`h-3.5 w-3.5 rounded-full border ${k === 'goal' ? 'pk-dot border-lime bg-lime' : k === 'saved' ? 'pk-dot border-danger bg-danger' : 'border-white/25'}`}
            />
          );
        })}
        <span key={player.goals} className="pk-dot ml-1 w-5 text-right font-display text-lg font-extrabold tabular-nums">
          {player.goals}
        </span>
      </div>
    </div>
  );
}

export function PenaltyTable({ state, view, act, pending, serverNow }: TableProps<PenaltyView>) {
  const { user } = useSession();
  const name = (id: string) => (id === user?.id ? 'You' : nameOf(state, id));
  const shirtOf = (id: string) => SHIRTS[Math.max(0, view.players.findIndex((p) => p.playerId === id)) % 2];

  // Each new kick plays out once; a kick that happened before this screen opened is not replayed.
  const seen = useRef(view.lastKick?.seq ?? 0);
  const [shot, setShot] = useState<PenaltyLastKick | null>(null);
  useEffect(() => {
    const kick = view.lastKick;
    if (!kick || kick.seq === seen.current) return;
    seen.current = kick.seq;
    setShot(kick);
    const done = setTimeout(() => setShot(null), PENALTY_REVEAL_MS);
    // Felt at the moment the shot is decided, not when it is taken.
    const mine = kick.kickerId === user?.id ? kick.goal : !kick.goal;
    const felt = setTimeout(() => {
      if (kick.kickerId === user?.id || kick.keeperId === user?.id) haptic(mine ? 'success' : 'error');
    }, T.impact);
    return () => {
      clearTimeout(done);
      clearTimeout(felt);
    };
  }, [view.lastKick, user?.id]);
  const ms = useKickClock(shot);

  const revealing = shot !== null;
  const canPick = view.canChoose && !revealing && !pending;
  const kicking = view.myRole === 'kicker';
  const prompt = revealing
    ? ''
    : view.phase === 'finished'
      ? `${view.winnerId ? name(view.winnerId) : 'Nobody'} ${view.winnerId === user?.id ? 'win' : 'wins'} the shootout`
      : view.myRole === null
        ? `${name(view.kickerId)} to shoot`
        : view.myChoice
          ? view.opponentReady
            ? 'Taking the kick…'
            : `Locked in: ${SIDE_LABEL[view.myChoice]}. Waiting for ${name(kicking ? view.keeperId : view.kickerId)}…`
          : kicking
            ? 'You are shooting. Tap where to aim.'
            : 'You are in goal. Tap where to dive.';

  const zones =
    canPick || (view.myChoice && !revealing) ? (
      <div className="absolute inset-x-[20%] top-[15%] grid h-[29%] grid-cols-3 gap-1">
        {PENALTY_SIDES.map((side) =>
          canPick ? (
            <button
              key={side}
              onClick={() => {
                haptic('tap');
                void act({ type: 'choose', side });
              }}
              aria-label={`${kicking ? 'Aim' : 'Dive'} ${SIDE_LABEL[side]}`}
              className="pk-zone rounded-lg border-2 border-dashed border-gold/80 bg-gold/15 text-[13px] font-extrabold text-white transition active:scale-95 active:bg-gold/40"
            >
              {SIDE_LABEL[side]}
            </button>
          ) : (
            <div key={side} className={`grid place-items-center rounded-lg text-[13px] font-extrabold text-white transition ${view.myChoice === side ? 'border-2 border-gold bg-gold/40' : 'opacity-0'}`}>
              {view.myChoice === side ? SIDE_LABEL[side] : ''}
            </div>
          ),
        )}
      </div>
    ) : null;

  const kickerId = shot ? shot.kickerId : view.kickerId;
  const keeperId = shot ? shot.keeperId : view.keeperId;
  const decided = shot && ms >= T.impact;

  return (
    <div className="mx-auto grid w-full max-w-md gap-3">
      <div className="grid gap-1.5">
        {view.players.map((p) => (
          <ScoreRow key={p.playerId} player={p} name={name(p.playerId)} config={view.config} active={view.phase !== 'finished' && !revealing && p.playerId === view.kickerId} />
        ))}
      </div>

      <Pitch kick={shot} ms={ms} kickerShirt={shirtOf(kickerId)} keeperShirt={shirtOf(keeperId)} zones={zones} />
      <span className="sr-only" aria-live="assertive">
        {decided ? (shot.goal ? 'Goal' : 'Saved') : ''}
      </span>

      <div className="grid min-h-[56px] justify-items-center gap-1.5 text-center">
        {view.suddenDeath && view.phase !== 'finished' && <span className="chip border-danger/50 text-danger">Sudden death</span>}
        <p className="text-sm font-bold" aria-live="polite">
          {prompt}
        </p>
        {view.phase !== 'finished' && !revealing && <Countdown deadline={view.turnDeadline} serverNow={serverNow} total={view.config.turnSeconds + PENALTY_REVEAL_MS / 1000} />}
      </div>
    </div>
  );
}
