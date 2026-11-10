'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { GameSlug, GameSummary, RoomSummary } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Emblem, GameThumbClassic } from '@/components/art';
import { Coin, EmptyState, ErrorState, Page } from '@/components/ui';

interface Active {
  rooms: RoomSummary[];
  matches: { id: string; gameSlug: GameSlug; roomId: string | null }[];
}

function GameCard({ game }: { game: GameSummary }) {
  const disabled = !game.playable;
  return (
    <Link
      href={`/games/${game.slug}`}
      className={`group card relative flex flex-col overflow-hidden p-2.5 transition hover:-translate-y-0.5 hover:border-lime/40 ${disabled ? 'opacity-80' : ''}`}
    >
      <div className="relative aspect-square overflow-hidden rounded-xl">
        <GameThumbClassic slug={game.slug} />
        {game.maintenance && (
          <span className="absolute left-2 top-2 rounded-full bg-gold px-2 py-0.5 text-[10px] font-black uppercase text-ink">Coming soon</span>
        )}
        {game.beta && game.playable && (
          <span className="absolute right-2 top-2 rounded-full bg-violet px-2 py-0.5 text-[10px] font-black uppercase text-white">Beta</span>
        )}
        {!game.maintenance && !game.enabled && (
          <span className="absolute left-2 top-2 rounded-full bg-danger px-2 py-0.5 text-[10px] font-black uppercase text-white">Paused</span>
        )}
      </div>
      <div className="mt-2.5 px-0.5">
        <div className="font-display text-[15px] font-extrabold leading-tight">{game.name}</div>
        <div className="truncate text-[11px] text-muted">{game.tagline}</div>
      </div>
      <div className="mt-2 flex items-center justify-between px-0.5">
        <span className="flex items-center gap-1 text-[11px] font-bold text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${game.activePlayers > 0 ? 'bg-lime' : 'bg-muted/50'}`} />
          {game.activePlayers} online
        </span>
        <span className={`rounded-lg px-2 py-1 text-[11px] font-black ${disabled ? 'bg-white/5 text-muted' : 'bg-lime text-ink'}`}>
          {disabled ? 'Info' : 'Play'}
        </span>
      </div>
    </Link>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="card p-2.5">
          <div className="skeleton aspect-square" />
          <div className="skeleton mt-3 h-4 w-2/3" />
          <div className="skeleton mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export default function Lobby() {
  const { user } = useSession();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [g, a] = await Promise.all([
        api<GameSummary[]>('/games'),
        api<Active>('/me/active'),
      ]);
      setGames(g);
      setActive(a);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const allMaintenance = games !== null && games.length > 0 && games.every((g) => !g.playable);
  const resumable = active?.rooms.filter((r) => r.status === 'in_progress' || r.status === 'waiting') ?? [];

  const firstName = user?.firstName?.trim();

  return (
    <Page onRefresh={load} refreshing={refreshing}>
      {/* Greeting: short, so the games stay above the fold. The tibeb band is the one flourish. */}
      <section className="mb-5 flex items-end justify-between gap-4 lg:mb-8">
        <div className="min-w-0">
          <h1 className="font-display text-[28px] font-bold leading-[1.1] tracking-[-0.025em] sm:text-[34px] lg:text-[40px]">
            Selam{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1.5 max-w-md text-[15px] text-muted">Pick a table and play for birr. Every seat is a real player.</p>
          <div className="tibeb mt-4 w-40 lg:w-56" aria-hidden />
        </div>
        <Emblem size={150} className="hidden h-36 w-36 shrink-0 drop-shadow-[0_10px_30px_rgba(230,199,127,.18)] lg:block" />
      </section>

      {resumable.length > 0 && (
        <section className="mb-6 grid gap-2" aria-label="Your games in progress">
          {resumable.map((r) => (
            <Link key={r.id} href={`/room/${r.code}`} className="flex items-center gap-3 rounded-2xl border border-lime/35 bg-lime/[0.06] px-4 py-3 transition hover:border-lime/60">
              <span className="relative flex h-2.5 w-2.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime/60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-lime" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">
                  {games?.find((g) => g.slug === r.gameSlug)?.name ?? r.gameSlug}: {r.status === 'in_progress' ? 'match in progress' : 'waiting room'}
                </div>
                <div className="text-[13px] text-muted">
                  Room {r.code}, {r.players.length} of {r.maxPlayers} players
                </div>
              </div>
              <span className="btn-primary btn-sm">{r.status === 'in_progress' ? 'Resume' : 'Open'}</span>
            </Link>
          ))}
        </section>
      )}

      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="section-title">Games</h2>
        <Link href="/leaderboard" className="text-[13px] font-semibold text-muted transition hover:text-lime">
          Leaderboard
        </Link>
      </div>

      {error && !games ? (
        <ErrorState message={error} onRetry={load} />
      ) : !games ? (
        <GridSkeleton />
      ) : games.length === 0 ? (
        <EmptyState title="No games right now" body="The tables are being set up. Pull to refresh in a minute." />
      ) : (
        <>
          {allMaintenance && <div className="mb-3 rounded-2xl border border-gold/30 bg-gold/5 px-4 py-3 text-sm text-gold">Every game is under maintenance. Check back soon.</div>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {games.map((g) => (
              <GameCard key={g.slug} game={g} />
            ))}
          </div>
        </>
      )}

      <p className="mx-auto mt-8 max-w-sm text-center text-xs leading-relaxed text-muted/80">
        You play with real money, and you can lose it. Only play with what you can afford to lose. 18+.
      </p>
    </Page>
  );
}
