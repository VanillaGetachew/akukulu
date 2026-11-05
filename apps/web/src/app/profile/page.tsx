'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { GAME_CATALOG, type MatchSummary, type PlayerStatsSummary } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Avatar, Coin, EmptyState, ErrorState, LoadingState, Page, Points } from '@/components/ui';
import { HandHistoryList } from '@/components/games/poker-history';
import { GameThumb } from '@/components/art';

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

  const winRate = totals.played ? Math.round((totals.won / totals.played) * 100) : 0;
  const outcomeTone = (o?: string | null) => (o === 'win' ? 'text-lime' : o === 'loss' ? 'text-[#ff9aab]' : 'text-muted');

  return (
    <Page onRefresh={load}>
      {/* Who you are and where you stand. */}
      <section className="mb-6 flex items-center gap-4">
        <Avatar name={name} photoUrl={user.photoUrl} size={72} ring="ring-2 ring-gold/60 ring-offset-2 ring-offset-[rgb(var(--ink))]" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[26px] font-bold leading-tight tracking-[-0.02em]">{name}</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            {user.username && <span>@{user.username}</span>}
            <span>Playing since {new Date(user.createdAt).toLocaleDateString([], { month: 'short', year: 'numeric' })}</span>
          </div>
          {user.isAdmin && (
            <Link href="/admin" className="chip mt-2 border-gold/40 text-gold hover:bg-gold/10">
              Admin console
            </Link>
          )}
        </div>
      </section>

      <section className="mb-6 grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-panel sm:grid-cols-4" aria-label="Your totals">
        {[
          { k: 'Balance', v: <span className="flex items-center gap-1.5 text-gold"><Coin className="h-5 w-5" /><Points value={user.balance} /></span>, href: '/wallet' },
          { k: 'Played', v: totals.played },
          { k: 'Won', v: totals.won },
          { k: 'Win rate', v: `${winRate}%` },
        ].map((x, i) => {
          const body = (
            <>
              <div className="text-[13px] text-muted">{x.k}</div>
              <div className="mt-1 font-display text-[22px] font-bold leading-none tabular-nums">{x.v}</div>
            </>
          );
          const cls = `p-4 ${i % 2 ? 'border-l border-line' : ''} ${i > 1 ? 'border-t border-line sm:border-t-0' : ''} ${i === 2 ? 'sm:border-l' : ''}`;
          return x.href ? (
            <Link key={x.k} href={x.href} className={`${cls} transition hover:bg-white/[0.03]`}>
              {body}
            </Link>
          ) : (
            <div key={x.k} className={cls}>
              {body}
            </div>
          );
        })}
      </section>

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="lg:grid lg:grid-cols-2 lg:gap-8">
        <section className="mb-6">
          <h2 className="section-title mb-3">By game</h2>
          <div className="card divide-y divide-line overflow-hidden">
            {GAME_CATALOG.map((g) => {
              const st = stats?.find((x) => x.gameSlug === g.slug);
              const played = st?.played ?? 0;
              const won = st?.won ?? 0;
              const pct = played ? (won / played) * 100 : 0;
              return (
                <div key={g.slug} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg">
                    <GameThumb slug={g.slug} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold">{g.name}</span>
                      <span className="text-[13px] tabular-nums text-muted">
                        <span className="font-semibold text-fg">{won}</span> won of {played}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-lime" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mb-6">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="section-title">Recent matches</h2>
            <Link href="/wallet" className="text-[13px] font-semibold text-muted transition hover:text-lime">
              History
            </Link>
          </div>
          {matches === null ? (
            <LoadingState />
          ) : matches.length === 0 ? (
            <EmptyState title="No matches yet" body="Your finished games will show up here." action={<Link href="/" className="btn-primary">Find a game</Link>} />
          ) : (
            <div className="card divide-y divide-line overflow-hidden">
              {matches.map((m) => {
                const mine = m.players.find((p) => p.userId === user.id);
                const delta = mine?.pointsDelta ?? 0;
                const game = GAME_CATALOG.find((g) => g.slug === m.gameSlug)?.name ?? m.gameSlug;
                const others = m.players.filter((p) => p.userId !== user.id).map((p) => p.displayName).join(', ') || 'the dealer';
                return (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold">
                        {game}{' '}
                        <span className={`font-semibold ${outcomeTone(mine?.outcome)}`}>
                          {m.status === 'active' ? 'in progress' : m.status === 'cancelled' ? 'voided' : mine?.outcome === 'win' ? 'won' : mine?.outcome === 'loss' ? 'lost' : mine?.outcome === 'draw' ? 'draw' : ''}
                        </span>
                      </div>
                      <div className="truncate text-[13px] text-muted">
                        vs {others}, {new Date(m.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div className={`text-sm font-bold tabular-nums ${delta > 0 ? 'text-lime' : delta < 0 ? 'text-[#ff9aab]' : 'text-muted'}`}>
                      <Points value={delta} signed />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <h2 className="section-title mb-3">Poker hands</h2>
      <HandHistoryList limit={20} empty="Hands you play at the poker tables will show up here." />
    </Page>
  );
}
