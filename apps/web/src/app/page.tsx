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

function GameCard({ game }: { game: GameSummary }) {
  const disabled = !game.playable;
  return (
    <Link
      href={`/games/${game.slug}`}
      className={`group card relative flex flex-col overflow-hidden p-2.5 transition hover:-translate-y-0.5 hover:border-lime/40 ${disabled ? 'opacity-80' : ''}`}
    >
      <div className="relative aspect-square overflow-hidden rounded-xl">
        <GameThumb slug={game.slug} />
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
          {game.activePlayers} playing
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

  return (
    <Page onRefresh={load} refreshing={refreshing}>
      <section className="card relative mb-4 overflow-hidden border-violet/30 bg-[linear-gradient(120deg,#2a1f63,#160f3a_60%,#0e1f2a)]">
        <div className="grid grid-cols-[1fr_auto] items-center gap-2 p-5">
          <div>
            <span className="chip mb-2 border-lime/30 text-lime">Free to play</span>
            <h1 className="font-display text-2xl font-extrabold leading-tight sm:text-3xl">
              Selam{user ? `, ${user.firstName}` : ''}!
              <br />
              <span className="text-lime">Roll in</span> and play.
            </h1>
            <p className="mt-1.5 max-w-xs text-xs text-muted">Four classic games, real opponents, virtual points only.</p>
            <Link href="/rewards" className="btn-primary mt-3">
              <Coin /> {dailyAvailable ? 'Claim free reward' : 'Free rewards'}
            </Link>
          </div>
          <Emblem size={150} className="h-32 w-32 sm:h-40 sm:w-40" />
        </div>
      </section>

      {resumable.length > 0 && (
        <section className="mb-4 grid gap-2">
          {resumable.map((r) => (
            <Link key={r.id} href={`/room/${r.code}`} className="card flex items-center justify-between border-lime/40 px-4 py-3">
              <div>
                <div className="text-sm font-bold capitalize">{r.gameSlug} — {r.status === 'in_progress' ? 'match in progress' : 'waiting room'}</div>
                <div className="text-xs text-muted">Room {r.code} · {r.players.length}/{r.maxPlayers} players</div>
              </div>
              <span className="btn-primary px-3 py-1.5 text-xs">{r.status === 'in_progress' ? 'Resume' : 'Open'}</span>
            </Link>
          ))}
        </section>
      )}

      <div className="mb-3 flex items-end justify-between">
        <h2 className="font-display text-lg font-extrabold">Games</h2>
        <Link href="/leaderboard" className="text-xs font-bold text-lime">
          Leaderboard →
        </Link>
      </div>

      {error && !games ? (
        <ErrorState message={error} onRetry={load} />
      ) : !games ? (
        <GridSkeleton />
      ) : games.length === 0 ? (
        <EmptyState title="No games available" body="Please check back shortly." />
      ) : (
        <>
          {allMaintenance && (
            <div className="card mb-3 border-gold/30 px-4 py-3 text-sm text-gold">All games are under maintenance right now. Please check back soon.</div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {games.map((g) => (
              <GameCard key={g.slug} game={g} />
            ))}
          </div>
        </>
      )}

      <p className="mt-6 text-center text-[11px] text-muted/80">
        Points are free virtual credits. They cannot be bought, transferred, or exchanged for money.
      </p>
    </Page>
  );
}
