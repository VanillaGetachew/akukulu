'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PokerPlayerView, PokerView } from '@akukulu/shared';
import { useSession } from '@/lib/session';
import { Avatar, PlayingCard } from '@/components/ui';
import { useViewportHeight, useWidth } from './card-table';
import { nameOf, type TableProps } from './types';

const PHASE_LABEL: Record<string, string> = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
  handComplete: 'Hand complete',
  finished: 'Table closed',
};

/** 1st, 2nd, 3rd, 4th, … 11th, 12th, 13th, 21st. */
const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
};

function useNow(serverNow: () => number, every = 250) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), every);
    return () => clearInterval(t);
  }, [serverNow, every]);
  return now;
}

/** A small stack of casino chips with the amount. */
function Chips({ amount, big }: { amount: number; big?: boolean }) {
  const colors = amount >= 1000 ? ['#7c3aed', '#f6b80e', '#e53935'] : amount >= 100 ? ['#1f7fdc', '#2e9e48', '#e53935'] : ['#2e9e48', '#e53935'];
  const n = Math.min(4, 1 + Math.floor(Math.log10(Math.max(1, amount))));
  return (
    <div className="flex items-center gap-1">
      <div className="relative" style={{ width: big ? 26 : 20, height: (big ? 26 : 20) + n * 3 }}>
        {Array.from({ length: n }, (_, i) => (
          <svg key={i} viewBox="0 0 40 40" className="absolute left-0" style={{ bottom: i * 3, width: big ? 26 : 20, height: big ? 26 : 20 }}>
            <circle cx="20" cy="20" r="18" fill={colors[i % colors.length]} stroke="#fff" strokeWidth="2" />
            <circle cx="20" cy="20" r="12" fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="5 5" opacity="0.9" />
            <circle cx="20" cy="20" r="7" fill="#fff" opacity="0.92" />
          </svg>
        ))}
      </div>
      <span className={`rounded-full bg-black/55 px-1.5 font-black tabular-nums text-white ${big ? 'text-sm' : 'text-[11px]'}`}>{amount.toLocaleString()}</span>
    </div>
  );
}

/** Seat: avatar with a countdown ring when it is their turn, and a name / stack pill. */
function Seat({
  p,
  name,
  photoUrl,
  you,
  turn,
  left,
  winner,
  ratio,
  secs,
  showCards,
  tournament,
}: {
  p: PokerPlayerView;
  name: string;
  photoUrl?: string | null;
  you: boolean;
  turn: boolean;
  left: boolean;
  winner: boolean;
  ratio: number;
  secs: number;
  showCards: boolean;
  tournament: boolean;
}) {
  const out = p.status !== 'active';
  const status = p.status === 'busted' ? (tournament && p.place ? `Out · ${ordinal(p.place)}` : 'Busted') : p.status === 'left' ? 'Left' : p.folded ? 'Fold' : p.allIn ? 'All-in' : p.lastAction;
  const R = 23;
  const C = 2 * Math.PI * R;
  return (
    <div className={`flex w-[78px] flex-col items-center ${out || p.folded ? 'opacity-60' : ''}`}>
      <div className="relative grid h-[52px] w-[52px] place-items-center">
        <div className={`rounded-full ring-2 ${turn ? 'ring-transparent' : winner ? 'ring-gold' : 'ring-[#2b2f38]'}`}>
          <Avatar name={name} photoUrl={photoUrl} size={42} />
        </div>
        {turn && (
          <>
            <svg viewBox="0 0 52 52" className="absolute inset-0 -rotate-90">
              <circle cx="26" cy="26" r={R} fill="none" stroke="rgba(0,0,0,.45)" strokeWidth="4.5" />
              <circle cx="26" cy="26" r={R} fill="none" stroke={ratio > 0.3 ? '#f8d21c' : '#ff5a4f'} strokeWidth="4.5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - ratio)} />
            </svg>
            <span className="absolute -right-2 -top-1 grid h-6 min-w-6 place-items-center rounded-full bg-[#f8d21c] px-1 text-[11px] font-black text-[#15171d] shadow">{secs}</span>
          </>
        )}
        {/* Opponents' two cards tucked at the avatar's corner. */}
        {showCards && !you && p.inHand && !p.folded && (
          <div className={`absolute -bottom-1 flex -space-x-2.5 ${left ? '-left-3' : '-right-3'}`}>
            {p.hole.map((c, i) => (
              <div key={`${c}${i}`} className="w-[22px] overflow-hidden" style={{ transform: `rotate(${i ? 8 : -8}deg)` }}>
                <PlayingCard card={c} size="sm" />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={`-mt-1 w-full rounded-lg bg-[#15171d]/95 px-1 py-0.5 text-center shadow-lg ring-1 ${winner ? 'ring-2 ring-gold' : 'ring-white/10'}`}>
        <div className="truncate text-[10px] font-extrabold uppercase tracking-wide">{you ? 'You' : name}</div>
        <div className="text-[11px] font-black tabular-nums text-gold">{p.stack.toLocaleString()}</div>
      </div>
      {status && <span className={`mt-0.5 max-w-full truncate rounded-full px-1.5 text-[10px] font-bold ${winner ? 'bg-gold text-[#15171d]' : 'bg-black/45 text-white/85'}`}>{winner ? 'Winner' : status}</span>}
    </div>
  );
}

function ActionBar({ view, act, pending }: { view: PokerView; act: TableProps<PokerView>['act']; pending: boolean }) {
  const legal = view.legal!;
  const [amount, setAmount] = useState(legal.minAmount);
  useEffect(() => setAmount(legal.minAmount), [legal.minAmount, view.handNumber, view.phase]);
  const aggressive = legal.canBet || legal.canRaise;
  // Pot-sized raises: "raise to" = current bet + fraction × (pot after calling).
  const afterCall = view.pot + legal.callAmount;
  const presets = [
    { label: '½ pot', value: view.currentBet + Math.floor(afterCall / 2) },
    { label: '¾ pot', value: view.currentBet + Math.floor((afterCall * 3) / 4) },
    { label: 'Pot', value: view.currentBet + afterCall },
  ].filter((p) => p.value > legal.minAmount && p.value < legal.maxAmount);
  const allIn = amount >= legal.maxAmount;
  return (
    <div className="grid gap-2 rounded-2xl bg-[#15171d]/95 p-2.5 shadow-2xl ring-1 ring-white/10">
      {aggressive && (
        <div className="grid gap-1.5">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={legal.minAmount}
              max={legal.maxAmount}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="h-2 flex-1 accent-[#2ecc71]"
              aria-label="Bet amount"
            />
            <span className="w-16 text-right text-sm font-black tabular-nums text-gold">{amount.toLocaleString()}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold" onClick={() => setAmount(legal.minAmount)}>
              Min
            </button>
            {presets.map((p) => (
              <button key={p.label} className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold" onClick={() => setAmount(p.value)}>
                {p.label}
              </button>
            ))}
            <button className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold" onClick={() => setAmount(legal.maxAmount)}>
              All-in
            </button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <button className="rounded-xl bg-[#c0392b] py-3 text-sm font-black text-white shadow active:scale-95 disabled:opacity-50" disabled={pending} onClick={() => void act({ type: 'fold' })}>
          Fold
        </button>
        {legal.canCheck ? (
          <button className="rounded-xl bg-[#2c6fd6] py-3 text-sm font-black text-white shadow active:scale-95 disabled:opacity-50" disabled={pending} onClick={() => void act({ type: 'check' })}>
            Check
          </button>
        ) : (
          <button className="rounded-xl bg-[#2c6fd6] py-3 text-sm font-black text-white shadow active:scale-95 disabled:opacity-50" disabled={pending} onClick={() => void act({ type: 'call' })}>
            Call {legal.callAmount.toLocaleString()}
          </button>
        )}
        {aggressive ? (
          <button
            className="rounded-xl bg-[#27ae60] py-3 text-sm font-black text-white shadow active:scale-95 disabled:opacity-50"
            disabled={pending}
            onClick={() => void act(allIn ? { type: 'allIn' } : { type: legal.canBet ? 'bet' : 'raise', amount })}
          >
            {allIn ? 'All-in' : `${legal.canBet ? 'Bet' : 'Raise to'} ${amount.toLocaleString()}`}
          </button>
        ) : (
          <button className="rounded-xl bg-[#27ae60] py-3 text-sm font-black text-white shadow active:scale-95 disabled:opacity-50" disabled={pending || legal.callAmount === 0} onClick={() => void act({ type: 'allIn' })}>
            All-in
          </button>
        )}
      </div>
    </div>
  );
}

export function PokerTable({ state, view, act, pending, serverNow }: TableProps<PokerView>) {
  const { user } = useSession();
  const now = useNow(serverNow);
  const meIndex = view.players.findIndex((p) => p.playerId === user?.id);
  const me = meIndex >= 0 ? view.players[meIndex] : null;
  const n = view.players.length;
  // Seats in order from me, so I sit at the bottom centre of the table.
  const ordered = view.players.map((_, i) => view.players[(i + Math.max(0, meIndex)) % n]);
  const myTurn = !!view.legal && view.currentPlayerId === user?.id;
  const last = view.lastHand;
  const done = view.phase === 'handComplete' || view.phase === 'finished';
  const winners = new Set(done ? (last?.pots.flatMap((p) => p.winners) ?? []) : []);
  const t = view.tournament;

  // Auto check / fold: acts for me as soon as it is my turn.
  const [autoCheckFold, setAutoCheckFold] = useState(false);
  useEffect(() => {
    if (!autoCheckFold || !myTurn || pending || !view.legal) return;
    void act({ type: view.legal.canCheck ? 'check' : 'fold' });
    if (!view.legal.canCheck) setAutoCheckFold(false);
  }, [autoCheckFold, myTurn, pending, view.legal, act]);
  useEffect(() => setAutoCheckFold(false), [view.handNumber]);

  // A fixed table size from the screen. On a phone (portrait) the oval stands upright like
  // mobile poker apps; on a wide screen it lies flat like a desktop table.
  const [boxRef, boxWidth] = useWidth<HTMLDivElement>();
  const vh = useViewportHeight();
  const portrait = boxWidth < 560;
  const room = vh - 250;
  const feltW = portrait ? Math.max(220, boxWidth - 110) : Math.min(boxWidth - 120, 720);
  const feltH = portrait ? Math.max(260, Math.min(feltW * 1.7, room - 90)) : Math.max(220, Math.min(feltW * 0.55, room - 90));
  const areaW = feltW + 110;
  // Room above and below the oval for the top and bottom seats.
  const areaH = feltH + (portrait ? 120 : 130);
  const cx = areaW / 2;
  const cy = areaH / 2;
  const seatAt = (k: number) => {
    const a = Math.PI / 2 + (2 * Math.PI * k) / n;
    return { x: cx + (feltW / 2 + 4) * Math.cos(a), y: cy + (feltH / 2 + 4) * Math.sin(a), a };
  };
  const cardSize = feltW >= 270 ? 'md' : 'sm';

  const ratioFor = (p: PokerPlayerView) => {
    if (p.playerId !== view.currentPlayerId || !view.turnDeadline) return 0;
    return Math.max(0, Math.min(1, (view.turnDeadline - now) / (view.config.turnSeconds * 1000)));
  };
  const secsLeft = view.turnDeadline ? Math.max(0, Math.ceil((view.turnDeadline - now) / 1000)) : 0;
  const resultText =
    last && done
      ? last.pots
          .map((pt) => {
            const hand = last.showdown.find((s) => s.playerId === pt.winners[0])?.category;
            return `${pt.winners.map((w) => (w === user?.id ? 'You' : nameOf(state, w))).join(' & ')} won ${pt.amount.toLocaleString()}${hand ? ` with ${hand}` : ''}`;
          })
          .join(' · ')
      : null;

  return (
    <div className="fixed inset-0 z-[35] flex flex-col overflow-hidden bg-[radial-gradient(ellipse_at_center,#2a2f3a_0%,#12141a_70%)] text-white">
      {/* Header: back, table name, and the tournament clock. */}
      <div className="flex shrink-0 items-center gap-2 px-2 pt-2">
        <Link href="/games/poker" aria-label="Back to the lobby" className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-sm font-bold">
          ←
        </Link>
        <div className="min-w-0 flex-1 truncate text-xs font-bold text-white/80">
          {t ? 'Sit & Go' : 'Cash game'} · Hold&apos;em · Blinds {view.config.smallBlind.toLocaleString()}/{view.config.bigBlind.toLocaleString()} · Hand #{view.handNumber}
        </div>
      </div>
      {t && (
        <div className="mx-2 mt-1.5 flex shrink-0 flex-wrap items-center justify-center gap-1.5 text-[11px] font-bold">
          <span className="rounded-full bg-gold px-2 py-0.5 text-[#15171d]">Level {t.level}</span>
          {t.nextBigBlind && (
            <span className="rounded-full bg-white/10 px-2 py-0.5">
              Next {t.nextSmallBlind}/{t.nextBigBlind} in {t.handsToNextLevel} hand{t.handsToNextLevel === 1 ? '' : 's'}
            </span>
          )}
          <span className="rounded-full bg-white/10 px-2 py-0.5">Prize {t.prizePool.toLocaleString()}</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5">
            {t.playersLeft}/{t.entrants} left
          </span>
        </div>
      )}

      <div ref={boxRef} className="relative mx-auto min-h-0 w-full max-w-[830px] flex-1">
        <div className="relative mx-auto" style={{ width: areaW, height: areaH }}>
          {/* The table: a dark rail around an oval green felt. */}
          <div
            className="absolute rounded-[50%] bg-[#20232b] shadow-[0_18px_40px_rgba(0,0,0,.6)]"
            style={{ left: cx - feltW / 2 - 14, top: cy - feltH / 2 - 14, width: feltW + 28, height: feltH + 28 }}
          />
          <div
            className="absolute overflow-hidden rounded-[50%] shadow-[inset_0_0_40px_rgba(0,0,0,.55)]"
            style={{ left: cx - feltW / 2, top: cy - feltH / 2, width: feltW, height: feltH, background: 'radial-gradient(ellipse at center, #1fa64a 0%, #138a3a 55%, #0b6a2b 100%)' }}
          >
            <div className="absolute inset-0 grid place-items-center">
              <span className="select-none text-[min(9vw,56px)] font-black tracking-[0.2em] text-black/10">AKUKULU</span>
            </div>
          </div>

          {/* Pot and community cards in the middle. */}
          <div className="absolute flex flex-col items-center gap-1.5" style={{ left: cx, top: cy, transform: 'translate(-50%, -55%)' }}>
            {view.pot > 0 && <Chips amount={view.pot} big />}
            <div className="flex gap-1">
              {view.community.map((c, i) => (
                <PlayingCard key={c} card={c} size={cardSize} delay={i * 90} highlight={done && !!last?.showdown.some((s) => s.best.includes(c))} />
              ))}
              {Array.from({ length: 5 - view.community.length }, (_, i) => (
                <div key={i} className={`rounded-lg border border-dashed border-white/20 ${cardSize === 'sm' ? 'h-[50px] w-9' : 'h-[73px] w-[52px]'}`} />
              ))}
            </div>
            {resultText && <div className="max-w-[18rem] rounded-full bg-black/55 px-3 py-1 text-center text-[11px] font-bold text-gold">{resultText}</div>}
          </div>

          {/* Seats, their bets in front of them, and the dealer button. */}
          {ordered.map((p, k) => {
            const { x, y } = seatAt(k);
            const info = state.players.find((x2) => x2.userId === p.playerId);
            const toward = (f: number) => ({ left: x + (cx - x) * f, top: y + (cy - y) * f });
            return (
              <div key={p.playerId}>
                <div className="absolute" style={{ left: x, top: y, transform: 'translate(-50%, -50%)', zIndex: 5 }}>
                  <Seat
                    p={p}
                    name={info?.displayName ?? 'Player'}
                    photoUrl={info?.photoUrl}
                    you={p.playerId === user?.id}
                    turn={p.playerId === view.currentPlayerId && !done}
                    left={x > cx + 4}
                    winner={winners.has(p.playerId)}
                    ratio={ratioFor(p)}
                    secs={secsLeft}
                    showCards
                    tournament={!!t}
                  />
                </div>
                {p.committed > 0 && (
                  <div className="absolute" style={{ ...toward(0.36), transform: 'translate(-50%, -50%)', zIndex: 4 }}>
                    <Chips amount={p.committed} />
                  </div>
                )}
                {p.isButton && (
                  <div
                    className="absolute grid h-6 w-6 place-items-center rounded-full bg-white text-[11px] font-black text-[#15171d] shadow ring-2 ring-black/20"
                    style={{ ...toward(0.3), transform: 'translate(-50%, -50%) translate(30px, 0)', zIndex: 4 }}
                  >
                    D
                  </div>
                )}
              </div>
            );
          })}

          {/* My hole cards, face up beside my seat at the bottom (clear of the board). */}
          {me && me.hole.length > 0 && (
            <div className="absolute flex -space-x-3" style={{ left: cx + 44, top: seatAt(0).y, transform: 'translateY(-55%)', zIndex: 6 }}>
              {me.hole.map((c, i) => (
                <div key={c} className={me.folded ? 'opacity-40' : ''} style={{ transform: `rotate(${i ? 7 : -5}deg) translateY(${i ? 2 : 0}px)` }}>
                  <PlayingCard card={c} size="md" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom: my actions, or what is going on. */}
      <div className="mx-auto w-full max-w-[560px] shrink-0 px-2 pb-[max(0.6rem,env(safe-area-inset-bottom))]">
        {t && me && me.status !== 'active' && me.place && (
          <div className="mb-2 rounded-xl bg-gold/15 px-3 py-2 text-center text-sm font-black text-gold">
            You finished {ordinal(me.place)}
            {t.payouts[me.place - 1] ? ` — prize ${t.payouts[me.place - 1].toLocaleString()}` : ''}
          </div>
        )}
        {myTurn && view.legal ? (
          <ActionBar view={view} act={act} pending={pending} />
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-2xl bg-[#15171d]/90 px-3 py-2.5 text-xs ring-1 ring-white/10">
            <span className="truncate font-bold text-white/80">
              {view.phase === 'finished'
                ? 'Table closed'
                : done
                  ? 'Next hand starting…'
                  : `${PHASE_LABEL[view.phase]} · ${view.currentPlayerId ? `${nameOf(state, view.currentPlayerId)} to act` : ''}`}
            </span>
            {me && me.inHand && !me.folded && !done && (
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 font-bold">
                <input type="checkbox" checked={autoCheckFold} onChange={(e) => setAutoCheckFold(e.target.checked)} className="h-4 w-4 accent-[#2ecc71]" />
                Check / fold
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
