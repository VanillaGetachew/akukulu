'use client';

import { useEffect, useRef, useState } from 'react';
import { RPS_HANDS, RPS_REVEAL_MS, type RpsHand, type RpsLastRound, type RpsPlayerView, type RpsView } from '@akukulu/shared';
import { useSession } from '@/lib/session';
import { haptic } from '@/lib/telegram';
import { Countdown } from '@/components/ui';
import { nameOf, type TableProps } from './types';

const HAND_LABEL: Record<RpsHand, string> = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' };
const HAND_TINT: Record<RpsHand, string> = { rock: '#c8443c', paper: '#3fb6d9', scissors: '#e6c77f' };
/** How long both fists shake before the hands are shown. */
const SHAKE_MS = 900;

const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A hand drawn from above the wrist: a closed fist, a flat palm or two fingers. */
export function RpsHandArt({ hand, size = 96, tint }: { hand: RpsHand; size?: number; tint?: string }) {
  const skin = '#f0c9a0';
  const edge = '#8a5a34';
  const cuff = tint ?? HAND_TINT[hand];
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="block" role="img" aria-label={HAND_LABEL[hand]}>
      <rect x="34" y="78" width="32" height="20" rx="5" fill={cuff} stroke="#0b1224" strokeOpacity=".35" strokeWidth="1.5" />
      {hand === 'rock' && (
        <g fill={skin} stroke={edge} strokeWidth="2" strokeLinejoin="round">
          <rect x="24" y="38" width="52" height="44" rx="16" />
          <rect x="25" y="28" width="13" height="26" rx="6.5" />
          <rect x="37.5" y="24" width="13" height="28" rx="6.5" />
          <rect x="50" y="25" width="13" height="27" rx="6.5" />
          <rect x="62.5" y="30" width="12" height="24" rx="6" />
          <rect x="20" y="52" width="30" height="14" rx="7" transform="rotate(-18 35 59)" />
        </g>
      )}
      {hand === 'paper' && (
        <g fill={skin} stroke={edge} strokeWidth="2" strokeLinejoin="round">
          <rect x="27" y="46" width="46" height="38" rx="13" />
          <rect x="27" y="14" width="10.5" height="44" rx="5.2" transform="rotate(-9 32 58)" />
          <rect x="39" y="6" width="10.5" height="50" rx="5.2" transform="rotate(-3 44 56)" />
          <rect x="51" y="6" width="10.5" height="50" rx="5.2" transform="rotate(3 56 56)" />
          <rect x="62.5" y="14" width="10.5" height="44" rx="5.2" transform="rotate(9 68 58)" />
          <rect x="10" y="50" width="28" height="11" rx="5.5" transform="rotate(32 24 55)" />
        </g>
      )}
      {hand === 'scissors' && (
        <g fill={skin} stroke={edge} strokeWidth="2" strokeLinejoin="round">
          <rect x="35" y="4" width="11" height="52" rx="5.5" transform="rotate(-13 40 56)" />
          <rect x="52" y="4" width="11" height="52" rx="5.5" transform="rotate(13 58 56)" />
          <rect x="26" y="42" width="48" height="42" rx="15" />
          <rect x="50" y="46" width="12" height="20" rx="6" />
          <rect x="61" y="49" width="11" height="18" rx="5.5" />
          <rect x="24" y="56" width="30" height="13" rx="6.5" transform="rotate(-14 39 62)" />
        </g>
      )}
    </svg>
  );
}

function Pips({ wins, needed }: { wins: number; needed: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`${wins} of ${needed} rounds won`}>
      {Array.from({ length: needed }, (_, i) => (
        <span key={`${i}-${i < wins}`} className={`h-3.5 w-3.5 rounded-full border ${i < wins ? 'pk-dot border-lime bg-lime' : 'border-white/25'}`} />
      ))}
    </div>
  );
}

function Side({
  label,
  wins,
  needed,
  hand,
  shaking,
  flipped,
  dimmed,
  won,
  status,
}: {
  label: string;
  /** Round wins to show: the round being revealed is not counted until the hands are out. */
  wins: number;
  needed: number;
  /** Null shows a closed fist: the throw is hidden or not made yet. */
  hand: RpsHand | null;
  shaking: boolean;
  flipped: boolean;
  dimmed: boolean;
  won: boolean;
  status: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-bold">{label}</div>
        <div className="mt-1">
          <Pips wins={wins} needed={needed} />
        </div>
        <div className="mt-1 min-h-[16px] text-[12px] font-semibold text-muted">{status}</div>
      </div>
      <div className={`grid h-[112px] w-[112px] shrink-0 place-items-center rounded-full border-2 transition-all duration-300 ${won ? 'border-lime bg-lime/15' : 'border-white/10 bg-black/25'} ${dimmed ? 'opacity-45' : ''}`}>
        <div className={flipped ? 'rotate-180' : ''}>
          <div key={`${hand ?? 'fist'}-${shaking}`} className={shaking ? 'rps-shake' : hand ? 'rps-pop' : 'rps-bob'}>
            <RpsHandArt hand={hand ?? 'rock'} size={88} tint={hand ? undefined : '#5b6c8f'} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function RpsTable({ state, view, act, pending, serverNow }: TableProps<RpsView>) {
  const { user } = useSession();
  const name = (id: string) => (id === user?.id ? 'You' : nameOf(state, id));
  // My side is at the bottom; a spectator sees seat 0 there.
  const me = view.players.find((p) => p.playerId === user?.id) ?? view.players[0];
  const other = view.players.find((p) => p !== me)!;
  const playing = me.playerId === user?.id;

  // Each new round plays out once; one that happened before this screen opened is not replayed.
  const seen = useRef(view.lastRound?.seq ?? 0);
  const [shown, setShown] = useState<RpsLastRound | null>(null);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const round = view.lastRound;
    if (!round || round.seq === seen.current) return;
    seen.current = round.seq;
    setRevealed(prefersReducedMotion());
    setShown(round);
  }, [view.lastRound]);
  // The timers hang off the round being shown, so later updates from the server cannot cancel them.
  const feel = useRef({ playing, userId: user?.id });
  feel.current = { playing, userId: user?.id };
  useEffect(() => {
    if (!shown) return;
    const reveal = setTimeout(
      () => {
        setRevealed(true);
        if (feel.current.playing) haptic(shown.winnerId === null ? 'tap' : shown.winnerId === feel.current.userId ? 'success' : 'error');
      },
      prefersReducedMotion() ? 0 : SHAKE_MS,
    );
    const done = setTimeout(() => setShown(null), RPS_REVEAL_MS);
    return () => {
      clearTimeout(reveal);
      clearTimeout(done);
    };
  }, [shown]);

  const revealing = shown !== null;
  const finished = view.phase === 'finished';
  // Once the match is over the last throw stays on the table.
  const final = finished && !revealing ? view.lastRound : null;
  const round = shown ?? final;
  const showHands = round !== null && (revealed || final !== null);
  const canPick = view.canThrow && !revealing && !pending;

  const roundText = !round || !showHands ? '' : round.winnerId === null ? 'Draw. Throw again!' : `${name(round.winnerId)} ${round.winnerId === user?.id ? 'win' : 'wins'} the round`;
  const prompt = revealing
    ? roundText
    : finished
      ? `${view.winnerId ? name(view.winnerId) : 'Nobody'} ${view.winnerId === user?.id ? 'win' : 'wins'} the match${view.finishReason === 'coin' ? ' on a coin toss' : ''}`
      : !playing
        ? 'Waiting for both players to throw…'
        : view.myHand
          ? `Locked in: ${HAND_LABEL[view.myHand]}. Waiting for ${name(other.playerId)}…`
          : 'Pick your throw. Your opponent cannot see it.';

  const winsOf = (p: RpsPlayerView) => p.wins - (revealing && !revealed && shown.winnerId === p.playerId ? 1 : 0);
  const handOf = (p: RpsPlayerView): RpsHand | null => (showHands ? round!.hands[p.playerId] ?? null : !revealing && p === me && playing ? view.myHand : null);
  const statusOf = (p: RpsPlayerView) =>
    p.status === 'forfeited' ? 'Left the match' : showHands && round ? HAND_LABEL[round.hands[p.playerId]] : revealing || finished ? '' : p === me && playing ? (view.myHand ? 'Ready' : 'Your turn') : (p === other ? view.opponentReady : false) ? 'Ready' : 'Choosing…';

  return (
    <div className="mx-auto grid w-full max-w-md gap-3">
      <div className="flex items-center justify-between text-xs font-bold text-muted">
        <span>First to {view.config.winsNeeded} wins</span>
        <span>Round {view.round + (finished || revealing ? 0 : 1)}</span>
      </div>

      <div className="rps-arena grid gap-2 rounded-2xl border border-line p-4">
        <Side
          label={name(other.playerId)}
          wins={winsOf(other)}
          needed={view.config.winsNeeded}
          hand={handOf(other)}
          shaking={revealing && !revealed}
          flipped
          dimmed={showHands && round!.winnerId !== null && round!.winnerId !== other.playerId}
          won={showHands && round!.winnerId === other.playerId}
          status={statusOf(other)}
        />
        <div className="grid min-h-[44px] place-items-center">
          {showHands && round ? (
            <span key={round.seq} className={`rps-pop font-display text-2xl font-extrabold italic ${round.winnerId === null ? 'text-fg' : round.winnerId === me.playerId ? 'text-lime' : 'text-danger'}`}>
              {round.winnerId === null ? 'DRAW' : playing ? (round.winnerId === me.playerId ? 'YOU WIN' : 'YOU LOSE') : `${name(round.winnerId).toUpperCase()} WINS`}
            </span>
          ) : (
            <span className="font-display text-lg font-extrabold text-white/35">VS</span>
          )}
        </div>
        <Side
          label={name(me.playerId)}
          wins={winsOf(me)}
          needed={view.config.winsNeeded}
          hand={handOf(me)}
          shaking={revealing && !revealed}
          flipped={false}
          dimmed={showHands && round!.winnerId !== null && round!.winnerId !== me.playerId}
          won={showHands && round!.winnerId === me.playerId}
          status={statusOf(me)}
        />
      </div>
      <span className="sr-only" aria-live="assertive">
        {showHands ? roundText : ''}
      </span>

      {playing && !finished && (
        <div className="grid grid-cols-3 gap-2">
          {RPS_HANDS.map((hand) => {
            const chosen = view.myHand === hand && !revealing;
            return (
              <button
                key={hand}
                disabled={!canPick}
                onClick={() => {
                  haptic('tap');
                  void act({ type: 'throw', hand });
                }}
                className={`grid justify-items-center gap-1 rounded-2xl border-2 px-2 py-3 text-sm font-extrabold transition active:scale-95 ${
                  chosen ? 'border-gold bg-gold/20 text-gold' : canPick ? 'pk-zone border-gold/60 text-fg' : 'border-line bg-black/20 text-muted opacity-60'
                }`}
              >
                <RpsHandArt hand={hand} size={56} />
                {HAND_LABEL[hand]}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid min-h-[48px] justify-items-center gap-1.5 text-center">
        <p className="text-sm font-bold" aria-live="polite">
          {prompt}
        </p>
        {!finished && !revealing && <Countdown deadline={view.turnDeadline} serverNow={serverNow} total={view.config.turnSeconds + RPS_REVEAL_MS / 1000} />}
      </div>
    </div>
  );
}
