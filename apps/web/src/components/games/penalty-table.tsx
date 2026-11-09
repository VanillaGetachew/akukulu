'use client';

import { useEffect, useRef, useState } from 'react';
import { PENALTY_REVEAL_MS, PENALTY_SIDES, type PenaltyLastKick, type PenaltyPlayerView, type PenaltySide, type PenaltyView } from '@akukulu/shared';
import { useSession } from '@/lib/session';
import { haptic } from '@/lib/telegram';
import { Countdown } from '@/components/ui';
import { nameOf, type TableProps } from './types';

const SIDE_X: Record<PenaltySide, number> = { left: 112, center: 180, right: 248 };
const SIDE_LABEL: Record<PenaltySide, string> = { left: 'Left', center: 'Middle', right: 'Right' };
const SPOT = { x: 180, y: 248 };
const GOAL_Y = 96;

/** The keeper: a simple figure, leaning towards the side they dive to. */
function Keeper({ dive, shirt }: { dive: PenaltySide | null; shirt: string }) {
  const x = dive ? SIDE_X[dive] : 180;
  const lean = dive === 'left' ? -38 : dive === 'right' ? 38 : 0;
  return (
    <g style={{ transform: `translate(${x}px, 112px) rotate(${lean}deg)`, transition: 'transform .42s cubic-bezier(.2,.8,.3,1)' }}>
      <circle cx="0" cy="-30" r="7" fill="#e8c39e" />
      <rect x="-9" y="-23" width="18" height="23" rx="5" fill={shirt} />
      <path d="M-9-20-22-32M9-20 22-32" stroke={shirt} strokeWidth="6" strokeLinecap="round" />
      <circle cx="-23" cy="-33" r="3.6" fill="#f5f5f5" />
      <circle cx="23" cy="-33" r="3.6" fill="#f5f5f5" />
      <path d="M-5 0-7 16M5 0 7 16" stroke="#202a38" strokeWidth="6" strokeLinecap="round" />
    </g>
  );
}

function Ball({ kick, shooting }: { kick: PenaltyLastKick | null; shooting: boolean }) {
  // A saved shot stops at the keeper; a goal carries on into the net.
  const to = kick && shooting ? { x: SIDE_X[kick.aim], y: kick.goal ? GOAL_Y - 22 : GOAL_Y + 10 } : SPOT;
  return (
    <g style={{ transform: `translate(${to.x}px, ${to.y}px) scale(${shooting ? 0.62 : 1})`, transition: shooting ? 'transform .42s ease-out' : 'none' }}>
      <circle r="8" fill="#fff" stroke="#1c2430" strokeWidth="1.2" />
      <path d="M0-3.6 3.4-1.1 2.1 2.9H-2.1L-3.4-1.1Z" fill="#1c2430" />
    </g>
  );
}

function Pitch({ kick, shooting, zones }: { kick: PenaltyLastKick | null; shooting: boolean; zones: React.ReactNode }) {
  return (
    <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-line">
      <svg viewBox="0 0 360 300" className="block w-full" aria-hidden="true">
        <defs>
          <linearGradient id="pk-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0b1224" />
            <stop offset="1" stopColor="#16264a" />
          </linearGradient>
        </defs>
        <rect width="360" height="132" fill="url(#pk-sky)" />
        {/* Stands: rows of small dots in the Ethiopian flag colours. */}
        {Array.from({ length: 5 }, (_, row) =>
          Array.from({ length: 46 }, (_, i) => (
            <circle key={`${row}-${i}`} cx={4 + i * 8 + (row % 2) * 4} cy={10 + row * 9} r="2.1" fill={['#2b9a5a', '#e6c77f', '#c8443c', '#5b6c8f'][(i * 7 + row * 3) % 4]} opacity={0.34 + row * 0.08} />
          )),
        )}
        {Array.from({ length: 6 }, (_, i) => (
          <rect key={i} y={132 + i * 28} width="360" height="28" fill={i % 2 ? '#256b3b' : '#2c7a45'} />
        ))}
        <path d="M0 132H360M70 132 44 206H316L290 132" fill="none" stroke="#e9f3ea" strokeOpacity=".7" strokeWidth="2" />
        <circle cx={SPOT.x} cy={SPOT.y} r="2.6" fill="#e9f3ea" />
        {/* Net and frame. */}
        <g stroke="#dfe7f2" strokeOpacity=".3" strokeWidth=".8">
          {Array.from({ length: 16 }, (_, i) => (
            <path key={i} d={`M${72 + i * 14.4} 46V132`} />
          ))}
          {Array.from({ length: 7 }, (_, i) => (
            <path key={i} d={`M72 ${46 + i * 14.3}H288`} />
          ))}
        </g>
        <path d="M72 132V46H288V132" fill="none" stroke="#f5f7fb" strokeWidth="5" strokeLinejoin="round" />
        <Keeper dive={shooting && kick ? kick.dive : null} shirt="#e6c77f" />
        <Ball kick={kick} shooting={shooting} />
      </svg>
      {zones}
    </div>
  );
}

function ScoreRow({ player, name, config, active }: { player: PenaltyPlayerView; name: string; config: PenaltyView['config']; active: boolean }) {
  const slots = Math.max(config.kicks, player.kicks.length);
  return (
    <div className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 ${active ? 'bg-lime/10' : 'bg-black/20'}`}>
      <span className="min-w-0 truncate text-sm font-bold">{name}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        {Array.from({ length: slots }, (_, i) => {
          const k = player.kicks[i];
          return (
            <span
              key={i}
              role="img"
              aria-label={k === 'goal' ? 'Goal' : k === 'saved' ? 'Saved' : 'Not taken'}
              className={`h-3.5 w-3.5 rounded-full border ${k === 'goal' ? 'border-lime bg-lime' : k === 'saved' ? 'border-danger bg-danger' : 'border-white/25'}`}
            />
          );
        })}
        <span className="ml-1 w-5 text-right font-display text-lg font-extrabold tabular-nums">{player.goals}</span>
      </div>
    </div>
  );
}

export function PenaltyTable({ state, view, act, pending, serverNow }: TableProps<PenaltyView>) {
  const { user } = useSession();
  const name = (id: string) => (id === user?.id ? 'You' : nameOf(state, id));

  // Each new kick plays out once; a kick that happened before this screen opened is not replayed.
  const seen = useRef(view.lastKick?.seq ?? 0);
  const [shot, setShot] = useState<PenaltyLastKick | null>(null);
  const [shooting, setShooting] = useState(false);
  useEffect(() => {
    const kick = view.lastKick;
    if (!kick || kick.seq === seen.current) return;
    seen.current = kick.seq;
    setShot(kick);
    setShooting(false);
    const go = setTimeout(() => setShooting(true), 60);
    const done = setTimeout(() => {
      setShot(null);
      setShooting(false);
    }, PENALTY_REVEAL_MS);
    const mine = kick.kickerId === user?.id ? kick.goal : !kick.goal;
    if (kick.kickerId === user?.id || kick.keeperId === user?.id) haptic(mine ? 'success' : 'error');
    return () => {
      clearTimeout(go);
      clearTimeout(done);
    };
  }, [view.lastKick, user?.id]);

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

  const zones = canPick ? (
    <div className="absolute inset-x-[20%] top-[15%] grid h-[29%] grid-cols-3 gap-1">
      {PENALTY_SIDES.map((side) => (
        <button
          key={side}
          onClick={() => void act({ type: 'choose', side })}
          aria-label={`${kicking ? 'Aim' : 'Dive'} ${SIDE_LABEL[side]}`}
          className="rounded-lg border-2 border-dashed border-gold/80 bg-gold/15 text-[13px] font-extrabold text-white transition active:scale-95 active:bg-gold/40"
        >
          {SIDE_LABEL[side]}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="mx-auto grid w-full max-w-md gap-3">
      <div className="grid gap-1.5">
        {view.players.map((p) => (
          <ScoreRow key={p.playerId} player={p} name={name(p.playerId)} config={view.config} active={view.phase !== 'finished' && !revealing && p.playerId === view.kickerId} />
        ))}
      </div>

      <div className="relative">
        <Pitch kick={shot} shooting={shooting} zones={zones} />
        {revealing && shooting && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-live="assertive">
            <span className={`animate-dealIn font-display text-5xl font-black italic drop-shadow-[0_3px_8px_rgba(0,0,0,.7)] ${shot.goal ? 'text-gold' : 'text-white'}`}>{shot.goal ? 'GOAL!' : 'SAVED!'}</span>
          </div>
        )}
      </div>

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
