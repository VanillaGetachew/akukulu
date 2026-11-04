'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { GameSlug, GameSummary, RoomSummary } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Emblem, GameThumb } from '@/components/art';
import { Coin, EmptyState, ErrorState, Page } from '@/components/ui';

interface Active {
  rooms: RoomSummary[];
  matches: { id: string; gameSlug: GameSlug; roomId: string | null }[];
}

function PlayTag({ disabled, className }: { disabled: boolean; className: string }) {
  return (
    <span className={`h-10 min-w-[68px] place-items-center rounded-xl px-4 text-[13px] font-bold transition ${disabled ? 'border border-line text-muted' : 'bg-lime text-ink group-hover:brightness-110'} ${className}`}>
      {disabled ? 'Details' : 'Play'}
    </span>
  );
}

/** A game: artwork, name, what it is, who is playing, and Play. A row on phones, a tall card on wide screens. */
function GameCard({ game }: { game: GameSummary }) {
  const disabled = !game.playable;
  const badge = game.maintenance ? 'Coming soon' : !game.enabled ? 'Paused' : game.beta && game.playable ? 'Beta' : null;
  return (
    <Link
      href={`/games/${game.slug}`}
      className="group relative grid grid-cols-[72px_1fr_auto] items-center gap-3 min-[375px]:grid-cols-[88px_1fr_auto] min-[375px]:gap-3.5 rounded-2xl border border-line bg-panel p-2.5 pr-3.5 transition duration-200 hover:border-lineStrong hover:bg-[#121d33] active:scale-[.99] sm:grid-cols-1 sm:gap-0 sm:p-0"
    >
      <div className="relative h-[72px] overflow-hidden rounded-xl min-[375px]:h-[88px] sm:aspect-[16/10] sm:h-auto sm:rounded-b-none sm:rounded-t-2xl">
        <div className="h-full w-full transition duration-300 group-hover:scale-[1.04]">
          <GameThumb slug={game.slug} />
        </div>
        {badge && (
          <span className={`absolute left-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold sm:left-3 sm:top-3 ${badge === 'Beta' ? 'bg-ink/80 text-gold' : 'bg-gold text-ink'}`}>{badge}</span>
        )}
      </div>
      <div className="min-w-0 sm:px-4 sm:pt-3.5">
        <div className="font-display text-[17px] font-bold leading-tight tracking-[-0.01em]">{game.name}</div>
        <div className="mt-0.5 truncate text-[13px] text-muted">{game.tagline}</div>
        <div className="mt-1.5 flex items-center justify-between gap-2 sm:mb-4 sm:mt-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${game.activePlayers > 0 ? 'bg-lime shadow-[0_0_0_3px_rgba(34,212,138,.18)]' : 'bg-muted/50'}`} aria-hidden />
            {game.activePlayers > 0 ? `${game.activePlayers} playing now` : 'Be the first at a table'}
          </span>
          <PlayTag disabled={disabled} className="hidden sm:grid" />
        </div>
      </div>
      <PlayTag disabled={disabled} className="grid sm:hidden" />
    </Link>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="grid grid-cols-[88px_1fr] items-center gap-3.5 rounded-2xl border border-line bg-panel p-2.5 sm:grid-cols-1 sm:p-0">
          <div className="skeleton h-[88px] sm:aspect-[16/10] sm:h-auto" />
          <div className="grid gap-2 sm:p-4">
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Lobby() {
  const { user } = useSession();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [dailyAvailable, setDailyAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [g, a, r] = await Promise.all([
        api<GameSummary[]>('/games'),
        api<Active>('/me/active'),
        api<{ dailyAvailable: boolean }>('/rewards'),
      ]);
      setGames(g);
      setActive(a);
      setDailyAvailable(r.dailyAvailable);
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
          <p className="mt-1.5 max-w-md text-[15px] text-muted">Pick a table. Every seat is a real player, and every point is free.</p>
          <div className="tibeb mt-4 w-40 lg:w-56" aria-hidden />
        </div>
        <Emblem size={150} className="hidden h-36 w-36 shrink-0 drop-shadow-[0_10px_30px_rgba(230,199,127,.18)] lg:block" />
      </section>

      {dailyAvailable && (
        <Link
          href="/rewards"
          className="mb-5 flex items-center gap-3 rounded-2xl border border-gold/25 bg-[linear-gradient(100deg,rgba(230,199,127,.12),rgba(230,199,127,.03))] px-4 py-3 transition hover:border-gold/45"
        >
          <Coin className="h-8 w-8" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-fg">Your daily reward is ready</div>
            <div className="text-[13px] text-muted">Free points to play with today</div>
          </div>
          <span className="btn-gold btn-sm">Claim</span>
        </Link>
      )}

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
          <div className="grid gap-2.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {games.map((g) => (
              <GameCard key={g.slug} game={g} />
            ))}
          </div>
        </>
      )}

      <p className="mx-auto mt-8 max-w-sm text-center text-xs leading-relaxed text-muted/80">
        Points are free virtual credits. They can&apos;t be bought, transferred or exchanged for money.
      </p>
    </Page>
  );
}
