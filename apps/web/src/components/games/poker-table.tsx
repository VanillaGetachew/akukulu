'use client';

import { useEffect, useState } from 'react';
import type { PokerView } from '@akukulu/shared';
import { useSession } from '@/lib/session';
import { Avatar, Coin, Countdown, PlayingCard } from '@/components/ui';
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

function ActionBar({ view, act, pending }: { view: PokerView; act: TableProps<PokerView>['act']; pending: boolean }) {
  const legal = view.legal!;
  const [amount, setAmount] = useState(legal.minAmount);
  useEffect(() => setAmount(legal.minAmount), [legal.minAmount, view.handNumber, view.phase]);
  const pot = view.pot;
  const aggressive = legal.canBet || legal.canRaise;
  const presets = [
    { label: '½ pot', value: Math.floor(pot / 2) + view.currentBet },
    { label: 'Pot', value: pot + view.currentBet },
  ].filter((p) => p.value > legal.minAmount && p.value < legal.maxAmount);

  return (
    <div className="card grid gap-3 p-3">
      {aggressive && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between text-xs font-bold text-muted">
            <span>{legal.canBet ? 'Bet' : 'Raise to'}</span>
            <span className="flex items-center gap-1 text-base text-fg">
              <Coin /> {amount}
            </span>
          </div>
          <input
            type="range"
            min={legal.minAmount}
            max={legal.maxAmount}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full accent-[rgb(var(--lime))]"
            aria-label="Bet amount"
          />
          <div className="flex gap-2">
            <button className="chip" onClick={() => setAmount(legal.minAmount)}>Min</button>
            {presets.map((p) => (
              <button key={p.label} className="chip" onClick={() => setAmount(p.value)}>{p.label}</button>
            ))}
            <button className="chip" onClick={() => setAmount(legal.maxAmount)}>Max</button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <button className="btn-danger" disabled={pending} onClick={() => void act({ type: 'fold' })}>
          Fold
        </button>
        {legal.canCheck ? (
          <button className="btn-ghost" disabled={pending} onClick={() => void act({ type: 'check' })}>
            Check
          </button>
        ) : (
          <button className="btn-ghost" disabled={pending} onClick={() => void act({ type: 'call' })}>
            Call {legal.callAmount}
          </button>
        )}
        {aggressive ? (
          <button
            className="btn-primary"
            disabled={pending}
            onClick={() => void act(amount >= legal.maxAmount ? { type: 'allIn' } : { type: legal.canBet ? 'bet' : 'raise', amount })}
          >
            {amount >= legal.maxAmount ? 'All-in' : legal.canBet ? 'Bet' : 'Raise'}
          </button>
        ) : (
          <button className="btn-primary" disabled={pending || legal.callAmount === 0} onClick={() => void act({ type: 'allIn' })}>
            All-in
          </button>
        )}
      </div>
    </div>
  );
}

export function PokerTable({ state, view, act, pending, serverNow }: TableProps<PokerView>) {
  const { user } = useSession();
  const meIndex = view.players.findIndex((p) => p.playerId === user?.id);
  const me = meIndex >= 0 ? view.players[meIndex] : null;
  const n = view.players.length;
  // Rotate seats so the viewer sits at the bottom of the table.
  const ordered = view.players.map((_, i) => view.players[(i + Math.max(0, meIndex)) % n]);
  const others = ordered.slice(me ? 1 : 0);
  const myTurn = view.currentPlayerId === user?.id && view.legal;
  const last = view.lastHand;
  const winners = new Set(last?.pots.flatMap((p) => p.winners) ?? []);

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between text-xs font-bold text-muted">
        <span>Hand #{view.handNumber} · {PHASE_LABEL[view.phase]}</span>
        <span>Blinds {view.config.smallBlind}/{view.config.bigBlind}</span>
      </div>

      <div className="felt relative overflow-hidden rounded-[2.5rem] border-4 border-[#3a2a12] p-3 shadow-card">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {others.map((p) => {
            const info = state.players.find((x) => x.userId === p.playerId);
            const turn = p.playerId === view.currentPlayerId;
            const showWin = (view.phase === 'handComplete' || view.phase === 'finished') && winners.has(p.playerId);
            return (
              <div key={p.playerId} className={`rounded-2xl border bg-black/35 p-2 ${turn ? 'animate-pulseRing border-lime/70' : showWin ? 'border-gold/70' : 'border-white/10'} ${p.folded || p.status !== 'active' ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-2">
                  <Avatar name={info?.displayName ?? '?'} photoUrl={info?.photoUrl} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold">{info?.displayName}</div>
                    <div className="flex items-center gap-1 text-[11px] text-gold">
                      <Coin className="h-3 w-3" /> {p.stack}
                    </div>
                  </div>
                  <div className="flex gap-0.5">
                    {p.isButton && <span className="grid h-5 w-5 place-items-center rounded-full bg-white text-[9px] font-black text-ink">D</span>}
                    {p.isSmallBlind && <span className="grid h-5 w-5 place-items-center rounded-full bg-violet text-[8px] font-black">SB</span>}
                    {p.isBigBlind && <span className="grid h-5 w-5 place-items-center rounded-full bg-violet text-[8px] font-black">BB</span>}
                  </div>
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <div className="flex gap-1">
                    {p.inHand && !p.folded && p.hole.map((c, i) => <PlayingCard key={`${c}${i}`} card={c} size="sm" />)}
                  </div>
                  <div className="text-right text-[10px] text-muted">
                    {p.status === 'left' ? 'Left' : p.status === 'busted' ? 'Busted' : p.allIn ? 'All-in' : p.lastAction ?? ''}
                    {p.committed > 0 && <div className="font-bold text-fg">bet {p.committed}</div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="my-5 grid place-items-center gap-2">
          <div className="flex min-h-[4.5rem] gap-1.5">
            {view.community.map((c, i) => (
              <PlayingCard key={c} card={c} delay={i * 80} highlight={!!last?.showdown.some((s) => s.best.includes(c)) && view.phase === 'handComplete'} />
            ))}
            {Array.from({ length: 5 - view.community.length }, (_, i) => (
              <div key={i} className="h-[4.5rem] w-[3.25rem] rounded-lg border border-dashed border-white/15" />
            ))}
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1 text-sm font-black">
            <Coin /> Pot {view.pot}
          </div>
          {last && (view.phase === 'handComplete' || view.phase === 'finished') && (
            <div className="max-w-sm text-center text-xs font-semibold text-gold">
              {last.pots
                .map((p) => {
                  const hand = last.showdown.find((s) => s.playerId === p.winners[0])?.category;
                  return `${p.winners.map((w) => nameOf(state, w)).join(' & ')} won ${p.amount}${hand ? ` with ${hand}` : ''}`;
                })
                .join(' · ')}
            </div>
          )}
        </div>

        {me && (
          <div className={`rounded-2xl border bg-black/40 p-3 ${view.currentPlayerId === me.playerId ? 'border-lime/70' : 'border-white/10'}`}>
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                {me.hole.map((c) => (
                  <PlayingCard key={c} card={c} size="lg" />
                ))}
              </div>
              <div className="text-right">
                <div className="text-xs text-muted">Your stack</div>
                <div className="flex items-center justify-end gap-1 text-lg font-black text-gold">
                  <Coin /> {me.stack}
                </div>
                {me.committed > 0 && <div className="text-xs text-muted">In: {me.committed}</div>}
                <div className="mt-0.5 flex justify-end gap-1">
                  {me.isButton && <span className="chip px-1.5 py-0">D</span>}
                  {me.isSmallBlind && <span className="chip px-1.5 py-0">SB</span>}
                  {me.isBigBlind && <span className="chip px-1.5 py-0">BB</span>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {view.phase !== 'finished' && view.phase !== 'handComplete' && (
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{myTurn ? 'Your move' : `Waiting for ${nameOf(state, view.currentPlayerId)}`}</span>
          <Countdown deadline={view.turnDeadline} serverNow={serverNow} total={view.config.turnSeconds} />
        </div>
      )}
      {view.phase === 'handComplete' && <p className="text-center text-xs text-muted">Next hand starting shortly…</p>}
      {myTurn && view.legal && <ActionBar view={view} act={act} pending={pending} />}
    </div>
  );
}
