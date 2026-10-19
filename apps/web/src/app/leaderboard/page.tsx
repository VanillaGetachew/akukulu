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

  return (
    <Page onRefresh={load}>
      <h1 className="mb-3 font-display text-2xl font-extrabold">Leaderboard</h1>
      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {[{ slug: 'all', name: 'All games' }, ...GAME_CATALOG].map((g) => (
          <button key={g.slug} onClick={() => setGame(g.slug)} className={`chip shrink-0 ${game === g.slug ? 'border-lime/50 text-lime' : ''}`}>
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
        <div className="card divide-y divide-line">
          {rows.map((r) => (
            <div key={r.userId} className={`flex items-center gap-3 px-4 py-3 ${r.userId === user?.id ? 'bg-lime/5' : ''}`}>
              <div className={`w-7 text-center font-display text-lg font-extrabold ${r.rank === 1 ? 'text-gold' : r.rank <= 3 ? 'text-fg' : 'text-muted'}`}>{r.rank}</div>
              <Avatar name={r.displayName} photoUrl={r.photoUrl} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{r.displayName}</div>
                <div className="text-xs text-muted">{r.played} played · {r.pointsWon.toLocaleString()} pts won</div>
              </div>
              <div className="text-right">
                <div className="font-display text-lg font-extrabold text-lime">{r.won}</div>
                <div className="text-[10px] text-muted">wins</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
