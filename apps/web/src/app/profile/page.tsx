'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { GAME_CATALOG, type MatchSummary, type PlayerStatsSummary } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Avatar, Coin, EmptyState, ErrorState, LoadingState, Page, Points } from '@/components/ui';

export default function ProfilePage() {
  const { user, refreshUser } = useSession();
  const [stats, setStats] = useState<PlayerStatsSummary[] | null>(null);
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([api<PlayerStatsSummary[]>('/me/stats'), api<MatchSummary[]>('/me/matches'), refreshUser()]);
      setStats(s);
      setMatches(m);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [refreshUser]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
  const totals = (stats ?? []).reduce((a, s) => ({ played: a.played + s.played, won: a.won + s.won }), { played: 0, won: 0 });

  return (
    <Page onRefresh={load}>
      <section className="card mb-4 flex items-center gap-4 p-4">
        <Avatar name={name} photoUrl={user.photoUrl} size={64} ring="ring-2 ring-lime/60" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-extrabold">{name}</h1>
          {user.username && <div className="text-sm text-muted">@{user.username}</div>}
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className="chip">
              <Coin className="h-3 w-3" /> <Points value={user.balance} />
            </span>
            <span className="chip">{totals.played} played</span>
            <span className="chip">{totals.won} won</span>
            {user.isAdmin && (
              <Link href="/admin" className="chip border-gold/40 text-gold">
                Admin
              </Link>
            )}
          </div>
        </div>
      </section>

      {error && <ErrorState message={error} onRetry={load} />}

      <h2 className="mb-2 font-display text-base font-extrabold">Statistics</h2>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {GAME_CATALOG.map((g) => {
          const s = stats?.find((x) => x.gameSlug === g.slug);
          return (
            <div key={g.slug} className="card p-3">
              <div className="text-xs font-bold text-muted">{g.name}</div>
              <div className="font-display text-xl font-extrabold">{s?.won ?? 0}<span className="text-sm text-muted">/{s?.played ?? 0}</span></div>
              <div className="text-[11px] text-muted">wins / played</div>
            </div>
          );
        })}
      </div>

      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-base font-extrabold">Match history</h2>
        <Link href="/wallet" className="text-xs font-bold text-lime">Transactions →</Link>
      </div>
      {matches === null ? (
        <LoadingState />
      ) : matches.length === 0 ? (
        <EmptyState title="No matches yet" body="Your finished games will appear here." action={<Link href="/" className="btn-primary">Play now</Link>} />
      ) : (
        <div className="grid gap-2">
          {matches.map((m) => {
            const mine = m.players.find((p) => p.userId === user.id);
            return (
              <div key={m.id} className="card flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-bold capitalize">
                    {m.gameSlug}{' '}
                    <span className={mine?.outcome === 'win' ? 'text-lime' : mine?.outcome === 'loss' ? 'text-danger' : 'text-muted'}>
                      {m.status === 'active' ? '· in progress' : m.status === 'cancelled' ? '· voided' : `· ${mine?.outcome ?? ''}`}
                    </span>
                  </div>
                  <div className="text-xs text-muted">
                    {new Date(m.startedAt).toLocaleString()} · vs {m.players.filter((p) => p.userId !== user.id).map((p) => p.displayName).join(', ') || 'dealer'}
                  </div>
                </div>
                <div className={`flex items-center gap-1 text-sm font-bold ${(mine?.pointsDelta ?? 0) > 0 ? 'text-lime' : (mine?.pointsDelta ?? 0) < 0 ? 'text-danger' : 'text-muted'}`}>
                  <Points value={mine?.pointsDelta ?? 0} signed />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Page>
  );
}
