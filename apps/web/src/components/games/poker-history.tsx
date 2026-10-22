'use client';

import { useEffect, useState } from 'react';
import type { PokerHandHistory } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { PlayingCard } from '@/components/ui';

const STREETS: [string, string][] = [
  ['preflop', 'Pre-flop'],
  ['flop', 'Flop'],
  ['turn', 'Turn'],
  ['river', 'River'],
];

function HandRow({ hand, me }: { hand: PokerHandHistory; me: string | undefined }) {
  const [open, setOpen] = useState(false);
  const mine = hand.players.find((p) => p.playerId === me);
  const name = (id: string) => (id === me ? 'You' : hand.players.find((p) => p.playerId === id)?.displayName ?? 'Player');
  const label = (id: string) => hand.players.find((p) => p.playerId === id)?.handLabel;
  const shown = new Set(hand.players.filter((p) => p.playerId !== me && p.hole).map((p) => p.playerId));
  return (
    <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/10">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-white/55">
            <span>#{hand.handNumber}</span>
            {hand.tableName && <span className="truncate">· {hand.tableName}</span>}
            <span>
              · {hand.smallBlind}/{hand.bigBlind}
              {hand.ante ? ` ante ${hand.ante}` : ''}
            </span>
            <span className="ml-auto shrink-0">{new Date(hand.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="flex -space-x-2">
              {(mine?.hole ?? []).map((c) => (
                <div key={c} className="w-[30px]">
                  <PlayingCard card={c} size="sm" />
                </div>
              ))}
            </div>
            <div className="flex gap-0.5">
              {hand.board.map((c) => (
                <div key={c} className="w-[26px] scale-[0.82] origin-left">
                  <PlayingCard card={c} size="sm" />
                </div>
              ))}
            </div>
            <span className={`ml-auto shrink-0 text-sm font-black tabular-nums ${!mine || mine.net === 0 ? 'text-white/60' : mine.net > 0 ? 'text-lime' : 'text-danger'}`}>
              {mine ? `${mine.net > 0 ? '+' : ''}${mine.net.toLocaleString()}` : ''}
            </span>
          </div>
          <div className="mt-1 truncate text-[11px] font-bold text-gold">
            {hand.pots
              .map((p) => `${p.winners.map(name).join(' & ')} won ${p.amount.toLocaleString()}${label(p.winners[0]) ? ` · ${label(p.winners[0])}` : ''}`)
              .join(' · ')}
          </div>
        </div>
      </button>
      {open && (
        <div className="grid gap-1.5 border-t border-white/10 px-3 py-2 text-[12px]">
          {mine?.handLabel && <div className="font-bold text-white/80">Your hand: {mine.handLabel}</div>}
          {[...shown].map((id) => {
            const p = hand.players.find((x) => x.playerId === id)!;
            return (
              <div key={id} className="flex items-center gap-2 text-white/80">
                <span className="font-bold">{p.displayName}</span>
                <div className="flex -space-x-2">
                  {p.hole!.map((c) => (
                    <div key={c} className="w-[26px] scale-[0.82] origin-left">
                      <PlayingCard card={c} size="sm" />
                    </div>
                  ))}
                </div>
                <span className="text-white/55">{p.handLabel}</span>
              </div>
            );
          })}
          {STREETS.map(([street, title]) => {
            const acts = hand.actions.filter((a) => a.street === street);
            if (!acts.length) return null;
            return (
              <div key={street}>
                <span className="font-black text-white/60">{title}: </span>
                <span className="text-white/85">{acts.map((a) => `${name(a.playerId)} ${a.action}`).join(', ')}</span>
              </div>
            );
          })}
          <div className="text-white/50">
            Stacks: {hand.players.map((p) => `${name(p.playerId)} ${p.startStack.toLocaleString()}${p.button ? ' (D)' : ''}`).join(' · ')}
          </div>
        </div>
      )}
    </div>
  );
}

/** Your recent hands (at one table, or everywhere): your cards, the board, who won, and the action street by street. */
export function HandHistoryList({ matchId, limit = 30, empty = 'No hands yet.' }: { matchId?: string; limit?: number; empty?: string }) {
  const { user } = useSession();
  const [hands, setHands] = useState<PokerHandHistory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<PokerHandHistory[]>(`/poker/hands?limit=${limit}${matchId ? `&matchId=${matchId}` : ''}`)
      .then((h) => live && setHands(h))
      .catch((err) => live && setError((err as Error).message));
    return () => {
      live = false;
    };
  }, [matchId, limit]);
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!hands) return <p className="text-sm text-white/60">Loading hands…</p>;
  if (!hands.length) return <p className="text-sm text-white/60">{empty}</p>;
  return (
    <div className="grid gap-2">
      {hands.map((h, i) => (
        <HandRow key={`${h.matchId}:${h.handNumber}:${i}`} hand={h} me={user?.id} />
      ))}
    </div>
  );
}
