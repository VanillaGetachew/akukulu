'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BINGO_BALLS, BINGO_FREE, BINGO_LETTERS, bingoLetter, type BingoCard, type BingoView } from '@akukulu/shared';
import { useSession } from '@/lib/session';
import { haptic } from '@/lib/telegram';
import { Coin } from '@/components/ui';
import { nameOf, type TableProps } from './types';

const LETTER_COLOR: Record<(typeof BINGO_LETTERS)[number], string> = { B: '#3fb6d9', I: '#d9534a', N: '#e6c77f', G: '#3aa866', O: '#9a7be0' };

function Ball({ n, size, fresh }: { n: number; size: number; fresh?: boolean }) {
  const letter = bingoLetter(n);
  const color = LETTER_COLOR[letter];
  return (
    <div
      className={`relative grid shrink-0 place-items-center rounded-full ${fresh ? 'bingo-drop' : ''}`}
      style={{ width: size, height: size, background: `radial-gradient(circle at 32% 28%, #ffffff 0%, ${color} 38%, ${color} 62%, rgba(0,0,0,.55) 130%)`, boxShadow: '0 4px 10px rgba(0,0,0,.4)' }}
      role="img"
      aria-label={`${letter} ${n}`}
    >
      <div className="grid place-items-center rounded-full bg-white text-[#10182b]" style={{ width: size * 0.66, height: size * 0.66 }}>
        <span className="font-display font-extrabold leading-none" style={{ fontSize: size * 0.17 }}>
          {letter}
        </span>
        <span className="-mt-0.5 font-display font-extrabold leading-none tabular-nums" style={{ fontSize: size * 0.3 }}>
          {n}
        </span>
      </div>
    </div>
  );
}

/** A 5×5 card. Called numbers are covered, and a winning line glows. */
function Card({ card, called, line, latest, small }: { card: BingoCard; called: ReadonlySet<number>; line?: readonly number[]; latest?: number; small?: boolean }) {
  return (
    <div className={`mx-auto w-full rounded-2xl border border-line bg-[#f7f1e1] ${small ? 'max-w-[240px] p-2' : 'max-w-[340px] p-2.5'}`}>
      <div className="mb-1.5 grid grid-cols-5 gap-1.5">
        {BINGO_LETTERS.map((l) => (
          <div key={l} className={`grid place-items-center rounded-lg font-display font-extrabold text-white ${small ? 'h-6 text-sm' : 'h-8 text-lg'}`} style={{ background: LETTER_COLOR[l] }}>
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {card.map((n, i) => {
          const free = n === BINGO_FREE;
          const marked = free || called.has(n);
          const winning = line?.includes(i);
          return (
            <div
              key={`${i}-${n}`}
              className={`relative grid aspect-square place-items-center rounded-lg border font-display font-extrabold tabular-nums ${small ? 'text-sm' : 'text-xl'} ${
                winning ? 'border-[#1f8a4d] bg-[#2fbf6c] text-white' : 'border-[#d9cfb6] bg-white text-[#1b2333]'
              }`}
              aria-label={free ? 'Free square' : `${n}${marked ? ', called' : ''}`}
            >
              {marked && !winning && <span key={String(marked)} className={`absolute inset-[9%] rounded-full bg-[#e0a92c] ${n === latest ? 'bingo-daub' : ''}`} aria-hidden />}
              <span className={`relative ${marked && !winning ? 'text-[#3a2a05]' : ''}`}>{free ? '★' : n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Every number, with the called ones lit. */
function Board({ called }: { called: ReadonlySet<number> }) {
  return (
    <div className="grid gap-1 rounded-xl border border-line bg-black/20 p-2">
      {BINGO_LETTERS.map((l, row) => (
        <div key={l} className="grid grid-cols-[18px_repeat(15,minmax(0,1fr))] items-center gap-[3px]">
          <span className="font-display text-xs font-extrabold" style={{ color: LETTER_COLOR[l] }}>
            {l}
          </span>
          {Array.from({ length: 15 }, (_, i) => {
            const n = row * 15 + i + 1;
            const on = called.has(n);
            return (
              <span key={n} className={`grid aspect-square place-items-center rounded text-[9px] font-bold tabular-nums ${on ? 'text-[#10182b]' : 'bg-white/5 text-white/35'}`} style={on ? { background: LETTER_COLOR[l] } : undefined}>
                {n}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function useNow(serverNow: () => number, active: boolean) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(serverNow()), 200);
    return () => clearInterval(t);
  }, [serverNow, active]);
  return now;
}

export function BingoTable({ state, view, act, pending, serverNow }: TableProps<BingoView>) {
  const { user } = useSession();
  const name = (id: string) => (id === user?.id ? 'You' : nameOf(state, id));
  const [showBoard, setShowBoard] = useState(false);
  const called = useMemo(() => new Set(view.called), [view.called]);
  const latest = view.called[view.called.length - 1];
  const finished = view.phase === 'finished';
  const now = useNow(serverNow, !finished);
  const mePlayer = view.players.find((p) => p.playerId === user?.id);
  const myWin = view.winners.find((w) => w.playerId === user?.id);
  const otherWin = view.winners.find((w) => w.playerId !== user?.id);

  // A buzz when a new ball is on my card.
  const count = useRef(view.called.length);
  useEffect(() => {
    if (view.called.length === count.current) return;
    count.current = view.called.length;
    if (latest !== undefined && view.myCard?.includes(latest)) haptic('tap');
  }, [view.called.length, latest, view.myCard]);

  const left = view.nextCallAt ? Math.max(0, view.nextCallAt - now) : 0;
  const total = (view.phase === 'ready' ? view.config.readySeconds : view.config.callSeconds) * 1000;
  const others = view.players.filter((p) => p.playerId !== user?.id);

  const headline = finished
    ? view.finishReason === 'forfeit'
      ? `${name(view.winners[0]?.playerId)} ${myWin ? 'win' : 'wins'}: everyone else left`
      : view.winners.length > 1
        ? `${view.winners.map((w) => name(w.playerId)).join(' and ')} share the pot!`
        : `${name(view.winners[0]?.playerId)} ${myWin ? 'have' : 'has'} Bingo!`
    : view.phase === 'ready'
      ? `First number in ${Math.ceil(left / 1000)}s`
      : mePlayer?.status === 'left'
        ? 'You left this game'
        : mePlayer
          ? mePlayer.toGo === 1
            ? 'One more number for Bingo!'
            : `${mePlayer.toGo} numbers to go`
          : 'Watching';

  return (
    <div className="mx-auto grid w-full max-w-md gap-3">
      <div className="flex items-center justify-between rounded-xl bg-black/25 px-3 py-2 text-xs font-bold">
        <span className="flex items-center gap-1">
          Pot
          {view.pot > 0 ? (
            <>
              <Coin className="h-3.5 w-3.5" /> <span className="text-sm text-gold tabular-nums">{view.pot.toLocaleString()}</span>
            </>
          ) : (
            <span className="text-sm text-gold">Free</span>
          )}
        </span>
        <span className="text-muted">{view.players.filter((p) => p.status === 'active').length} playing</span>
        <span className="text-muted tabular-nums">
          Ball {view.called.length}/{BINGO_BALLS}
        </span>
      </div>

      {/* The caller: the newest ball, the few before it, and the time until the next. */}
      <div className="bingo-stage grid gap-2 rounded-2xl border border-line p-3">
        <div className="flex min-h-[84px] items-center gap-3">
          {latest !== undefined ? (
            <div key={latest}>
              <Ball n={latest} size={84} fresh />
            </div>
          ) : (
            <div className="grid h-[84px] w-[84px] shrink-0 place-items-center rounded-full border-2 border-dashed border-white/25 font-display text-3xl font-extrabold text-white/50 tabular-nums">{Math.ceil(left / 1000)}</div>
          )}
          <div className="min-w-0 flex-1">
            <p className={`text-base font-extrabold ${finished ? (myWin ? 'text-lime' : 'text-fg') : mePlayer?.toGo === 1 && view.phase === 'calling' ? 'text-gold' : 'text-fg'}`} aria-live="polite">
              {headline}
            </p>
            <div className="mt-2 flex items-center gap-1.5">
              {view.called
                .slice(-6, -1)
                .reverse()
                .map((n) => (
                  <Ball key={n} n={n} size={34} />
                ))}
              {view.called.length <= 1 && <span className="text-xs text-muted">{view.phase === 'ready' ? 'Get your card ready.' : 'Numbers are marked for you.'}</span>}
            </div>
          </div>
        </div>
        {!finished && (
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
            <div className="h-full rounded-full bg-gold transition-[width] duration-200 ease-linear" style={{ width: `${Math.min(100, (left / total) * 100)}%` }} />
          </div>
        )}
      </div>

      {finished && otherWin && otherWin.line.length > 0 && (
        <div className="grid gap-1.5">
          <p className="text-center text-xs font-bold text-muted">{name(otherWin.playerId)}’s winning card</p>
          <Card card={otherWin.card} called={called} line={otherWin.line} small />
        </div>
      )}

      {view.myCard && <Card card={view.myCard} called={called} line={myWin?.line} latest={latest} />}

      {view.phase === 'ready' && mePlayer?.status === 'active' && (
        <button
          className="btn-ghost"
          disabled={pending || view.swapsLeft <= 0}
          onClick={() => {
            haptic('tap');
            void act({ type: 'swap' });
          }}
        >
          {view.swapsLeft > 0 ? `Change my card (${view.swapsLeft} left)` : 'No card changes left'}
        </button>
      )}

      {others.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {others.map((p) => {
            const won = view.winners.some((w) => w.playerId === p.playerId);
            return (
              <span
                key={p.playerId}
                className={`flex max-w-[48%] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-bold ${
                  won ? 'border-lime bg-lime/15 text-lime' : p.status === 'left' ? 'border-line text-muted line-through' : p.toGo === 1 && !finished ? 'border-gold bg-gold/15 text-gold' : 'border-line bg-black/20 text-fg'
                }`}
              >
                <span className="min-w-0 truncate">{name(p.playerId)}</span>
                {p.status === 'active' && view.phase !== 'ready' && <span className="shrink-0 tabular-nums opacity-80">{won ? 'Bingo!' : `${p.toGo} to go`}</span>}
              </span>
            );
          })}
        </div>
      )}

      {view.called.length > 0 && (
        <div className="grid gap-2">
          <button className="mx-auto text-xs font-bold text-muted underline underline-offset-4" onClick={() => setShowBoard((v) => !v)} aria-expanded={showBoard}>
            {showBoard ? 'Hide called numbers' : 'Show all called numbers'}
          </button>
          {showBoard && <Board called={called} />}
        </div>
      )}
    </div>
  );
}
