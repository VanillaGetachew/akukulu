'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { isGameSlug, type GameSlug, type GameSummary, type RoomSummary } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { GameThumb } from '@/components/art';
import { ConquerRulesList } from '@/components/games/conquer-rules';
import { Avatar, Coin, EmptyState, ErrorState, LoadingState, MaintenanceState, Page, Toast } from '@/components/ui';

/** Preset wagers per game; min is the smallest custom wager the server accepts. */
const STAKES: Record<GameSlug, { label: string; options: number[]; default: number; min: number }> = {
  ludo: { label: 'Entry stake', options: [0, 50, 100, 250, 500, 1000, 2500, 5000], default: 0, min: 0 },
  poker: { label: 'Buy-in', options: [200, 500, 1000, 2500, 5000, 10000, 25000, 50000], default: 500, min: 100 },
  blackjack: { label: 'Minimum bet', options: [10, 25, 50, 100, 250, 500, 1000, 5000], default: 10, min: 1 },
  conquer: { label: 'Stake per round', options: [0, 50, 100, 250, 500, 1000, 2500, 5000], default: 0, min: 0 },
};

const RULES: Record<GameSlug, string[]> = {
  ludo: ['Roll a 6 to bring a token out.', 'Land on an opponent to send it home — except on star and start squares.', 'A 6, a capture or reaching home earns another roll. Three 6s in a row ends your turn.', 'Exact roll needed to finish. First to bring all four tokens home wins the pot.'],
  poker: ["No-limit Texas Hold'em. Two hole cards, five community cards.", 'Blinds rotate each hand. Check, bet, call, raise or fold.', 'All-ins create side pots. Best five-card hand wins.', 'Your buy-in becomes chips; your final stack returns to your balance.'],
  blackjack: ['Get closer to 21 than the dealer without going over.', 'Blackjack pays 3:2. Dealer stands on all 17s.', 'Double on any two cards, split pairs up to four hands.', 'Split aces get one card each.'],
  conquer: [],
};

export default function GameLobby() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const router = useRouter();
  const { user } = useSession();
  const [game, setGame] = useState<GameSummary | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stake, setStake] = useState(isGameSlug(slug) ? STAKES[slug].default : 0);
  const [custom, setCustom] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [code, setCode] = useState('');

  const load = useCallback(async () => {
    if (!isGameSlug(slug)) return;
    setRefreshing(true);
    try {
      const games = await api<GameSummary[]>('/games');
      const g = games.find((x) => x.slug === slug) ?? null;
      setGame(g);
      if (g?.playable && !g.solo) setRooms(await api<RoomSummary[]>(`/games/${slug}/rooms`));
      else setRooms([]);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  async function run(fn: () => Promise<RoomSummary>) {
    setBusy(true);
    try {
      const room = await fn();
      router.push(`/room/${room.code}`);
    } catch (err) {
      setToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!isGameSlug(slug)) {
    return (
      <Page>
        <EmptyState title="Game not found" body="Akukulu offers Ludo, Poker, Blackjack and Conquer." />
      </Page>
    );
  }
  const stakes = STAKES[slug];
  const balance = user?.balance ?? 0;
  const affordable = balance >= stake;
  const customValue = custom.trim() === '' ? null : Number(custom);
  const customError =
    customValue === null
      ? null
      : !Number.isInteger(customValue) || customValue < stakes.min
        ? `Enter a whole number of at least ${stakes.min}`
        : customValue > balance
          ? `You only have ${balance.toLocaleString()} points`
          : null;
  const compact = (n: number) => (n >= 1000 ? `${n % 1000 === 0 ? n / 1000 : (n / 1000).toFixed(1)}K` : String(n));

  return (
    <Page onRefresh={load} refreshing={refreshing}>
      {error && !game ? (
        <ErrorState message={error} onRetry={load} />
      ) : !game ? (
        <LoadingState />
      ) : (
        <>
          <section className="card mb-4 flex gap-4 p-4">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl">
              <GameThumb slug={slug} />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-extrabold">{game.name}</h1>
              <p className="text-sm text-muted">{game.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="chip">{game.solo ? 'You vs dealer' : `${game.minPlayers}–${game.maxPlayers} players`}</span>
                <span className="chip">{game.activePlayers} playing now</span>
              </div>
            </div>
          </section>

          {!game.playable ? (
            <MaintenanceState message={game.maintenanceMessage ?? `${game.name} is temporarily unavailable.`} />
          ) : (
            <>
              <section className="card mb-4 grid gap-4 p-4">
                <div>
                  <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{stakes.label}</div>
                  <div className="grid grid-cols-4 gap-2">
                    {stakes.options.map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setStake(s);
                          setCustom('');
                        }}
                        disabled={s > balance}
                        className={`flex items-center justify-center gap-1 rounded-xl border py-2 text-sm font-bold disabled:opacity-35 ${stake === s && custom === '' ? 'border-lime bg-lime/10 text-lime' : 'border-line bg-black/20 text-fg'}`}
                      >
                        {s === 0 ? 'Free' : (<><Coin className="h-3.5 w-3.5" />{compact(s)}</>)}
                      </button>
                    ))}
                  </div>
                  <label className="mt-2 flex items-center gap-2">
                    <span className="shrink-0 text-xs font-bold text-muted">Custom</span>
                    <input
                      className={`input py-2 ${custom !== '' && !customError ? 'border-lime/60' : ''}`}
                      inputMode="numeric"
                      placeholder={`Any amount from ${stakes.min} to ${balance.toLocaleString()}`}
                      value={custom}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 7);
                        setCustom(v);
                        const n = Number(v);
                        if (v !== '' && Number.isInteger(n) && n >= stakes.min && n <= balance) setStake(n);
                      }}
                    />
                  </label>
                  {customError && <p className="mt-2 text-xs text-danger">{customError}</p>}
                  {!customError && !affordable && <p className="mt-2 text-xs text-danger">You need {stake.toLocaleString()} points for this table.</p>}
                </div>

                {slug !== 'blackjack' && slug !== 'conquer' && (
                  <div>
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Seats (private rooms)</div>
                    <div className="flex gap-2">
                      {(slug === 'ludo' ? [2, 3, 4] : [2, 4, 6, 9]).map((n) => (
                        <button key={n} onClick={() => setMaxPlayers(n)} className={`rounded-xl border px-3 py-1.5 text-sm font-bold ${maxPlayers === n ? 'border-lime text-lime' : 'border-line text-muted'}`}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-primary" disabled={busy || !affordable || !!customError} onClick={() => run(() => api('/rooms/quick-play', { body: { gameSlug: slug, stake } }))}>
                    {game.solo ? 'Sit at a table' : 'Quick play'}
                  </button>
                  {!game.solo && (
                    <button
                      className="btn-ghost"
                      disabled={busy || !affordable || !!customError}
                      onClick={() => run(() => api('/rooms', { body: { gameSlug: slug, stake, visibility: 'private', maxPlayers } }))}
                    >
                      Private room
                    </button>
                  )}
                </div>

                {!game.solo && (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (code.trim()) void run(() => api(`/rooms/${code.trim().toUpperCase()}/join`, { body: {} }));
                    }}
                  >
                    <input className="input uppercase" placeholder="Room code" value={code} maxLength={8} onChange={(e) => setCode(e.target.value)} />
                    <button className="btn-ghost shrink-0" disabled={busy || code.trim().length < 4}>
                      Join
                    </button>
                  </form>
                )}
              </section>

              {!game.solo && (
                <section className="mb-4">
                  <h2 className="mb-2 font-display text-base font-extrabold">Open tables</h2>
                  {rooms === null ? (
                    <LoadingState />
                  ) : rooms.length === 0 ? (
                    <EmptyState title="No open tables" body="Start a quick game and others will join you." />
                  ) : (
                    <div className="grid gap-2">
                      {rooms.map((r) => (
                        <div key={r.id} className="card flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex -space-x-2">
                              {r.players.slice(0, 4).map((p) => (
                                <Avatar key={p.userId} name={p.displayName} photoUrl={p.photoUrl} size={28} ring="ring-2 ring-panel" />
                              ))}
                            </div>
                            <div>
                              <div className="text-sm font-bold">{r.players.length}/{r.maxPlayers} players</div>
                              <div className="flex items-center gap-1 text-xs text-muted">
                                {r.stake === 0 ? 'Free' : (<><Coin className="h-3 w-3" /> {r.stake}</>)} · {r.code}
                              </div>
                            </div>
                          </div>
                          <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy || (user?.balance ?? 0) < r.stake} onClick={() => run(() => api(`/rooms/${r.code}/join`, { body: {} }))}>
                            Join
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </>
          )}

          <section className="card p-4">
            <h2 className="mb-2 font-display text-base font-extrabold">How to play</h2>
            {slug === 'conquer' ? (
              <ConquerRulesList />
            ) : (
              <ul className="grid gap-1.5 text-sm text-muted">
                {RULES[slug].map((r) => (
                  <li key={r} className="flex gap-2">
                    <span className="text-lime">•</span>
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <Toast message={toast} onClose={() => setToast(null)} />
    </Page>
  );
}
