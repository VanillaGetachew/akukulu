'use client';

import Link from 'next/link';
import { useState } from 'react';
import { HIDDEN_CARD, type BlackjackHandResult, type BlackjackView, type Card } from '@akukulu/shared';
import { useSession } from '@/lib/session';
import { CardBack, CardFace } from '@/components/card-face';
import { Coin, Countdown, Points } from '@/components/ui';
import { useWidth } from './card-table';
import type { TableProps } from './types';

const RESULT: Record<BlackjackHandResult, { label: string; tone: string }> = {
  blackjack: { label: 'Blackjack', tone: 'bg-gold text-ink' },
  win: { label: 'Win', tone: 'bg-lime text-ink' },
  push: { label: 'Push', tone: 'bg-white/85 text-ink' },
  lose: { label: 'Lose', tone: 'bg-danger text-white' },
  bust: { label: 'Bust', tone: 'bg-danger text-white' },
};

/** Casino chip colours by how many minimum bets it is worth. */
const CHIP = [
  { fill: '#c42a2a', edge: '#ffffff' },
  { fill: '#2563c9', edge: '#ffffff' },
  { fill: '#138a52', edge: '#ffffff' },
  { fill: '#171a21', edge: '#e6c77f' },
];

function CasinoChip({ value, tone, size = 56, selected }: { value: number; tone: number; size?: number; selected?: boolean }) {
  const c = CHIP[tone % CHIP.length];
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden className={`transition duration-150 ${selected ? '-translate-y-1.5 drop-shadow-[0_8px_10px_rgba(0,0,0,.5)]' : 'drop-shadow-[0_3px_4px_rgba(0,0,0,.45)]'}`}>
      <circle cx="30" cy="30" r="28" fill={c.fill} stroke={selected ? '#e6c77f' : 'rgba(0,0,0,.35)'} strokeWidth={selected ? 3 : 1.5} />
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x="27" y="2.5" width="6" height="9" rx="1.2" fill={c.edge} transform={`rotate(${i * 45} 30 30)`} />
      ))}
      <circle cx="30" cy="30" r="17" fill={c.fill} stroke={c.edge} strokeWidth="1.4" strokeDasharray="3 2.4" />
      <text x="30" y="35" textAnchor="middle" fontFamily="var(--font-display), sans-serif" fontWeight="700" fontSize={value >= 1000 ? 12 : 15} fill="#fff">
        {value >= 1000 ? `${value / 1000}K` : value}
      </text>
    </svg>
  );
}

/** A dealt card, at any width. */
function TableCard({ card, width, delay }: { card: Card; width: number; delay: number }) {
  return (
    <div className="animate-dealIn shrink-0 rounded-[8px] shadow-[0_3px_6px_rgba(0,0,0,.35),0_12px_24px_-10px_rgba(0,0,0,.6)]" style={{ width, height: width * 1.4, animationDelay: `${delay}ms` }}>
      {card === HIDDEN_CARD ? <CardBack width={width} /> : <CardFace card={card} width={width} />}
    </div>
  );
}

/** Cards fanned with a fixed overlap so a long hand still fits. */
function Hand({ cards, width }: { cards: Card[]; width: number }) {
  const overlap = Math.round(width * 0.42);
  return (
    <div className="flex justify-center" style={{ minHeight: width * 1.4 }}>
      {cards.map((c, i) => (
        <div key={`${i}-${c}`} style={{ marginLeft: i ? -overlap : 0, transform: `rotate(${(i - (cards.length - 1) / 2) * 3}deg) translateY(${Math.abs(i - (cards.length - 1) / 2) * 2}px)` }}>
          <TableCard card={c} width={width} delay={i * 120} />
        </div>
      ))}
    </div>
  );
}

function Total({ children, tone = 'dark' }: { children: React.ReactNode; tone?: 'dark' | 'light' }) {
  return (
    <span className={`inline-flex h-7 min-w-[36px] items-center justify-center rounded-full px-2.5 text-[13px] font-bold tabular-nums ${tone === 'dark' ? 'bg-black/45 text-white ring-1 ring-white/15' : 'bg-white text-ink'}`}>
      {children}
    </span>
  );
}

export function BlackjackTable({ view, act, pending, serverNow }: TableProps<BlackjackView>) {
  const { user } = useSession();
  const { minBet, maxBet } = view.config;
  const balance = user?.balance ?? 0;
  const chips = [minBet, minBet * 2, minBet * 5, minBet * 10].filter((c) => c <= maxBet);
  const [bet, setBet] = useState(minBet);
  const finished = view.phase === 'finished';
  const [boxRef, boxW] = useWidth<HTMLDivElement>();
  // Cards scale with the table: about a fifth of its width, 58–92px.
  const cardW = Math.round(Math.max(58, Math.min(108, boxW * 0.21)));
  const payout = view.config.blackjackPayout === 1.5 ? '3 to 2' : '6 to 5';

  return (
    <div className="felt fixed inset-0 z-table flex flex-col overflow-hidden text-white">
      {/* Top: back to the Blackjack lobby, the round, and my balance. */}
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2" style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}>
        <Link href="/games/blackjack" aria-label="Back to the Blackjack lobby" className="grid h-10 w-10 place-items-center rounded-full bg-black/35 text-lg font-bold ring-1 ring-white/10 transition hover:bg-black/50">
          ←
        </Link>
        <div className="min-w-0 text-[13px] leading-tight">
          <div className="font-semibold">Round {view.round || 1}</div>
          <div className="text-white/60">
            {view.config.decks}-deck shoe, {view.shoeRemaining} cards left
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ring-1 ring-white/10 ${view.sessionNet > 0 ? 'bg-lime/15 text-lime' : view.sessionNet < 0 ? 'bg-danger/15 text-[#ffb3c0]' : 'bg-black/30 text-white/70'}`} title="This session">
            <Points value={view.sessionNet} signed />
          </span>
          <span className="flex h-10 items-center gap-1.5 rounded-full bg-black/35 px-3 text-sm font-bold tabular-nums ring-1 ring-gold/30">
            <Coin className="h-4 w-4" />
            <Points value={balance} />
          </span>
        </div>
      </div>

      {/* The table. */}
      <div ref={boxRef} className="relative mx-auto flex min-h-0 w-full max-w-[640px] flex-1 flex-col items-center justify-around px-4">
        {/* Dealer */}
        <div className="grid place-items-center gap-2.5">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-white/75">
            Dealer
            {view.dealer.total !== null && <Total>{view.dealer.revealed ? view.dealer.total : `${view.dealer.total} + ?`}</Total>}
          </div>
          <Hand cards={view.dealer.cards} width={cardW} />
        </div>

        {/* House rules printed on the felt, on a gentle arc. */}
        <svg viewBox="0 0 400 70" className="pointer-events-none w-full max-w-[460px]" aria-label={`Blackjack pays ${payout}. Dealer ${view.config.dealerHitsSoft17 ? 'hits' : 'stands on'} soft 17.`}>
          <defs>
            <path id="bj-arc" d="M20 18 Q200 70 380 18" />
          </defs>
          <path d="M14 10 Q200 66 386 10" fill="none" stroke="#e6c77f" strokeOpacity=".45" strokeWidth="1.2" />
          <path d="M26 30 Q200 82 374 30" fill="none" stroke="#e6c77f" strokeOpacity=".25" strokeWidth=".8" />
          <text fontFamily="var(--font-display), sans-serif" fontSize="15" fontWeight="700" letterSpacing="2.5" fill="#e6c77f" fillOpacity=".85">
            <textPath href="#bj-arc" startOffset="50%" textAnchor="middle">
              BLACKJACK PAYS {payout.toUpperCase()}
            </textPath>
          </text>
          <text x="200" y="66" textAnchor="middle" fontFamily="var(--font-body), sans-serif" fontSize="11" fontWeight="600" fill="#fff" fillOpacity=".5">
            Dealer {view.dealer && view.config.dealerHitsSoft17 ? 'hits' : 'stands on'} soft 17
          </text>
        </svg>

        {/* My hands */}
        <div className="flex flex-wrap items-end justify-center gap-x-5 gap-y-3">
          {view.hands.length === 0 && (
            <div className="grid place-items-center gap-2 py-6 text-center">
              <div className="grid h-[76px] w-[76px] place-items-center rounded-full border-2 border-dashed border-white/30 text-[13px] font-semibold text-white/60">Bet</div>
              <p className="text-sm text-white/60">Pick a chip and deal</p>
            </div>
          )}
          {view.hands.map((h, i) => {
            const active = view.activeHand === i && view.phase === 'playerTurn';
            return (
              <div key={i} className={`grid place-items-center gap-2 rounded-2xl px-2 pb-2 pt-3 transition ${active ? 'bg-black/20 ring-2 ring-gold/70' : ''}`}>
                <div className="relative">
                  <Hand cards={h.cards} width={view.hands.length > 1 ? Math.round(cardW * 0.82) : cardW} />
                  {h.result && <span className={`absolute -top-3 left-1/2 -translate-x-1/2 animate-pop whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold shadow ${RESULT[h.result].tone}`}>{RESULT[h.result].label}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Total tone="light">{h.soft && h.total <= 21 ? `Soft ${h.total}` : h.total}</Total>
                  <span className="flex items-center gap-1 rounded-full bg-black/35 px-2 py-1 text-xs font-bold tabular-nums text-gold">
                    <Coin className="h-3.5 w-3.5" /> {h.bet}
                    {h.doubled && ' ×2'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {view.lastRoundNet !== null && view.phase === 'roundOver' && (
          <div className={`animate-rise rounded-full px-4 py-1.5 text-sm font-bold shadow-lift ${view.lastRoundNet > 0 ? 'bg-lime text-ink' : view.lastRoundNet < 0 ? 'bg-black/50 text-[#ffb3c0]' : 'bg-black/40 text-white'}`}>
            {view.lastRoundNet > 0 ? `You won ${view.lastRoundNet} points` : view.lastRoundNet < 0 ? `You lost ${Math.abs(view.lastRoundNet)} points` : 'Push. Your bet comes back'}
          </div>
        )}
      </div>

      {/* Bottom dock: my moves, the chip rack, or the end of the session. */}
      <div className="shrink-0 border-t border-white/10 bg-ink/75 px-3 pt-3 backdrop-blur-md" style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}>
        <div className="mx-auto grid max-w-[560px] gap-3">
          {view.phase === 'playerTurn' && (
            <>
              <div className="flex items-center justify-between text-[13px] text-white/70">
                <span className="font-semibold">{view.hands.length > 1 ? `Hand ${(view.activeHand ?? 0) + 1} of ${view.hands.length}` : 'Your move'}</span>
                <Countdown deadline={view.turnDeadline} serverNow={serverNow} total={view.config.turnSeconds} />
              </div>
              <div className="grid grid-cols-4 gap-2">
                <button className="btn-primary px-2" disabled={pending || !view.legal.hit} onClick={() => void act({ type: 'hit' })}>
                  Hit
                </button>
                <button className="btn-gold px-2" disabled={pending || !view.legal.stand} onClick={() => void act({ type: 'stand' })}>
                  Stand
                </button>
                <button className="btn-ghost px-2" disabled={pending || !view.legal.double} onClick={() => void act({ type: 'double' })}>
                  Double
                </button>
                <button className="btn-ghost px-2" disabled={pending || !view.legal.split} onClick={() => void act({ type: 'split' })}>
                  Split
                </button>
              </div>
            </>
          )}

          {view.legal.bet && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-white/70">Your bet</span>
                <span className="flex items-center gap-1.5 text-lg font-bold tabular-nums">
                  <Coin className="h-5 w-5" /> {bet.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-center gap-3" role="radiogroup" aria-label="Bet size">
                {chips.map((c, i) => (
                  <button key={c} role="radio" aria-checked={bet === c} aria-label={`${c} points`} onClick={() => setBet(c)} disabled={c > balance} className="rounded-full disabled:opacity-30">
                    <CasinoChip value={c} tone={i} selected={bet === c} />
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <button className="btn-primary" disabled={pending || bet > balance} onClick={() => void act({ type: 'bet', amount: bet })}>
                  Deal {bet.toLocaleString()}
                </button>
                <button className="btn-quiet" disabled={pending} onClick={() => void act({ type: 'leave' })}>
                  Leave table
                </button>
              </div>
              <div className="flex justify-center">
                <Countdown deadline={view.turnDeadline} serverNow={serverNow} total={view.config.idleSeconds} />
              </div>
            </>
          )}

          {view.phase === 'roundOver' && !view.legal.bet && <p className="py-3 text-center text-sm text-white/60">Next round coming up…</p>}

          {finished && (
            <div className="grid place-items-center gap-2 py-2 text-center">
              <div className="font-display text-lg font-bold">Table closed</div>
              <div className="text-sm text-white/70">
                You finished <Points value={view.sessionNet} signed /> points over {view.round} round{view.round === 1 ? '' : 's'}.
              </div>
              <Link href="/games/blackjack" className="btn-primary mt-1 w-full max-w-xs">
                Sit at a new table
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
