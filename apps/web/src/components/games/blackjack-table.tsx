'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { BlackjackHandResult, BlackjackView } from '@akukulu/shared';
import { useSession } from '@/lib/session';
import { Coin, Countdown, PlayingCard, Points } from '@/components/ui';
import type { TableProps } from './types';

const RESULT: Record<BlackjackHandResult, { label: string; tone: string }> = {
  blackjack: { label: 'Blackjack!', tone: 'bg-gold text-ink' },
  win: { label: 'Win', tone: 'bg-lime text-ink' },
  push: { label: 'Push', tone: 'bg-white/20 text-fg' },
  lose: { label: 'Lose', tone: 'bg-danger text-white' },
  bust: { label: 'Bust', tone: 'bg-danger text-white' },
};

export function BlackjackTable({ view, act, pending, serverNow }: TableProps<BlackjackView>) {
  const { user } = useSession();
  const { minBet, maxBet } = view.config;
  const balance = user?.balance ?? 0;
  const chips = [minBet, minBet * 2, minBet * 5, minBet * 10].filter((c) => c <= maxBet);
  const [bet, setBet] = useState(minBet);
  const finished = view.phase === 'finished';

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between text-xs font-bold text-muted">
        <span>Round {view.round || '–'} · {view.config.decks}-deck shoe ({view.shoeRemaining} left)</span>
        <span>
          Session{' '}
          <span className={view.sessionNet > 0 ? 'text-lime' : view.sessionNet < 0 ? 'text-danger' : ''}>
            <Points value={view.sessionNet} signed />
          </span>
        </span>
      </div>

      <div className="felt grid gap-6 rounded-[2.5rem] border-4 border-[#3a2a12] px-4 py-6 shadow-card">
        <div className="grid place-items-center gap-2">
          <div className="text-xs font-bold uppercase tracking-widest text-white/60">
            Dealer {view.dealer.total !== null && <span className="ml-1 rounded bg-black/40 px-1.5 py-0.5 text-fg">{view.dealer.revealed ? view.dealer.total : `${view.dealer.total} + ?`}</span>}
          </div>
          <div className="flex min-h-24 gap-1.5">
            {view.dealer.cards.map((c, i) => (
              <PlayingCard key={`${i}-${c}`} card={c} size="lg" delay={i * 120} />
            ))}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gold/80">
            Blackjack pays {view.config.blackjackPayout === 1.5 ? '3:2' : '6:5'} · Dealer {view.config.dealerHitsSoft17 ? 'hits' : 'stands on'} soft 17
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-4">
          {view.hands.length === 0 && <div className="py-8 text-sm text-white/50">Place a bet to deal</div>}
          {view.hands.map((h, i) => (
            <div key={i} className={`grid place-items-center gap-2 rounded-2xl p-2 ${view.activeHand === i ? 'bg-lime/10 ring-2 ring-lime/70' : ''}`}>
              <div className="flex gap-1.5">
                {h.cards.map((c, j) => (
                  <PlayingCard key={`${j}-${c}`} card={c} size="lg" delay={j * 120} />
                ))}
              </div>
              <div className="flex items-center gap-2 text-xs font-bold">
                <span className="rounded bg-black/40 px-1.5 py-0.5">{h.soft && h.total <= 21 ? `soft ${h.total}` : h.total}</span>
                <span className="flex items-center gap-1 text-gold">
                  <Coin className="h-3 w-3" /> {h.bet}
                  {h.doubled && ' ×2'}
                </span>
                {h.result && <span className={`animate-pop rounded px-1.5 py-0.5 ${RESULT[h.result].tone}`}>{RESULT[h.result].label}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {view.lastRoundNet !== null && view.phase === 'roundOver' && (
        <div className={`text-center text-sm font-bold ${view.lastRoundNet > 0 ? 'text-lime' : view.lastRoundNet < 0 ? 'text-danger' : 'text-muted'}`}>
          {view.lastRoundNet > 0 ? 'You won ' : view.lastRoundNet < 0 ? 'You lost ' : 'Push — '}
          {Math.abs(view.lastRoundNet)} points
        </div>
      )}

      {view.phase === 'playerTurn' && (
        <div className="card grid gap-2 p-3">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{view.hands.length > 1 ? `Playing hand ${(view.activeHand ?? 0) + 1} of ${view.hands.length}` : 'Your move'}</span>
            <Countdown deadline={view.turnDeadline} serverNow={serverNow} total={view.config.turnSeconds} />
          </div>
          <div className="grid grid-cols-4 gap-2">
            <button className="btn-primary" disabled={pending || !view.legal.hit} onClick={() => void act({ type: 'hit' })}>
              Hit
            </button>
            <button className="btn-ghost" disabled={pending || !view.legal.stand} onClick={() => void act({ type: 'stand' })}>
              Stand
            </button>
            <button className="btn-ghost" disabled={pending || !view.legal.double} onClick={() => void act({ type: 'double' })}>
              Double
            </button>
            <button className="btn-ghost" disabled={pending || !view.legal.split} onClick={() => void act({ type: 'split' })}>
              Split
            </button>
          </div>
        </div>
      )}

      {view.legal.bet && (
        <div className="card grid gap-3 p-3">
          <div className="flex items-center justify-between text-xs font-bold text-muted">
            <span>Your bet</span>
            <span className="flex items-center gap-1 text-base text-fg">
              <Coin /> {bet}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {chips.map((c) => (
              <button
                key={c}
                onClick={() => setBet(c)}
                disabled={c > balance}
                className={`grid aspect-square place-items-center rounded-full border-4 border-dashed text-sm font-black transition disabled:opacity-30 ${bet === c ? 'border-white bg-violet shadow-glow' : 'border-white/40 bg-panel2'}`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-primary" disabled={pending || bet > balance} onClick={() => void act({ type: 'bet', amount: bet })}>
              Deal
            </button>
            <button className="btn-ghost" disabled={pending} onClick={() => void act({ type: 'leave' })}>
              Leave table
            </button>
          </div>
          <Countdown deadline={view.turnDeadline} serverNow={serverNow} total={view.config.idleSeconds} />
        </div>
      )}

      {finished && (
        <div className="card grid place-items-center gap-2 p-4 text-center">
          <div className="font-display text-lg font-extrabold">Session closed</div>
          <div className="text-sm text-muted">
            Net result: <Points value={view.sessionNet} signed /> points over {view.round} round{view.round === 1 ? '' : 's'}
          </div>
          <Link href="/games/blackjack" className="btn-primary">
            New table
          </Link>
        </div>
      )}
    </div>
  );
}
