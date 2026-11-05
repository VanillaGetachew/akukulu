'use client';

import { useCallback, useEffect, useState } from 'react';
import { GAME_CATALOG, type LeaderboardRow } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Avatar, EmptyState, ErrorState, LoadingState, Page } from '@/components/ui';

export default function LeaderboardPage() {
  const { user } = useSession();
  const [game, setGame] = useState('all');
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    try {
      setRows(await api<LeaderboardRow[]>(`/leaderboard?game=${game}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [game]);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = rows?.find((r) => r.userId === user?.id);
  const podium = rows?.slice(0, 3) ?? [];
  const rest = rows?.slice(3) ?? [];
  const medal = ['#e6c77f', '#c9d1de', '#c98a5a'];

  return (
    <Page onRefresh={load}>
      <h1 className="mb-1 font-display text-[28px] font-bold tracking-[-0.025em]">Leaderboard</h1>
      <p className="mb-4 text-[15px] text-muted">Ranked by wins.{mine ? ` You are number ${mine.rank}.` : ''}</p>
      <div className="-mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Game">
        {[{ slug: 'all', name: 'All games' }, ...GAME_CATALOG].map((g) => (
          <button key={g.slug} role="tab" aria-selected={game === g.slug} onClick={() => setGame(g.slug)} className={`chip h-9 shrink-0 px-3.5 text-[13px] ${game === g.slug ? 'chip-on' : 'hover:text-fg'}`}>
            {g.name}
          </button>
        ))}
      </div>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : rows === null ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState title="No champions yet" body="Finish a match to claim the top spot." />
      ) : (
        <>
          {/* Top three on a podium: first in the middle and tallest. */}
          <div className="mb-4 grid grid-cols-3 items-end gap-2.5">
            {[podium[1], podium[0], podium[2]].map((r, i) =>
              r ? (
                <div key={r.userId} className={`grid place-items-center rounded-2xl border px-2 pb-3 text-center ${r.userId === user?.id ? 'border-lime/40 bg-lime/[0.06]' : 'border-line bg-panel'} ${i === 1 ? 'pt-5' : 'pt-3.5'}`}>
                  <div className="relative">
                    <Avatar name={r.displayName} photoUrl={r.photoUrl} size={i === 1 ? 60 : 48} ring={`ring-2 ring-offset-2 ring-offset-[rgb(var(--panel))] ${["ring-gold", "ring-[#c9d1de]", "ring-[#c98a5a]"][r.rank - 1]}`} />
                    <span className="absolute -bottom-2 left-1/2 grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full text-xs font-bold text-ink" style={{ background: medal[r.rank - 1] }}>
                      {r.rank}
                    </span>
                  </div>
                  <div className="mt-3.5 w-full truncate text-sm font-bold">{r.userId === user?.id ? 'You' : r.displayName}</div>
                  <div className="font-display text-xl font-bold leading-tight text-lime tabular-nums">{r.won}</div>
                  <div className="text-[11px] text-muted">wins</div>
                </div>
              ) : (
                <div key={i} />
              ),
            )}
          </div>
          {rest.length > 0 && (
            <div className="card divide-y divide-line overflow-hidden">
              {rest.map((r) => (
                <div key={r.userId} className={`flex items-center gap-3 px-4 py-3 ${r.userId === user?.id ? 'bg-lime/[0.07]' : ''}`}>
                  <div className="w-7 text-center font-display text-base font-bold tabular-nums text-muted">{r.rank}</div>
                  <Avatar name={r.displayName} photoUrl={r.photoUrl} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{r.userId === user?.id ? `${r.displayName} (you)` : r.displayName}</div>
                    <div className="text-[13px] text-muted">
                      {r.played} played, {r.pointsWon.toLocaleString()} ETB won
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-lg font-bold leading-tight text-fg tabular-nums">{r.won}</div>
                    <div className="text-[11px] text-muted">wins</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Page>
  );
}
