'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useRef } from 'react';
import { isGameSlug, type GameSlug, type GameSummary, type RoomSummary, WAGER_OPTIONS } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ART_BG, GameThumb } from '@/components/art';
import { ConquerRulesList } from '@/components/games/conquer-rules';
import { CrazyRulesList } from '@/components/games/crazy-rules';
import { GameTutorial, tutorialSeen } from '@/components/games/game-tutorial';
import { PokerLobby } from '@/components/games/poker-lobby';
import { Avatar, Coin, EmptyState, ErrorState, LoadingState, MaintenanceState, Page, Toast } from '@/components/ui';

/** Preset wagers per game; min is the smallest custom wager the server accepts. */
const STAKES: Record<GameSlug, { label: string; options: number[]; default: number; min: number }> = {
  ludo: { label: 'Entry stake', options: [0, ...WAGER_OPTIONS], default: 10, min: 10 },
  poker: { label: 'Buy-in', options: [200, 500, 1000, 2500, 5000, 10000, 25000, 50000], default: 500, min: 100 },
  blackjack: { label: 'Minimum bet', options: [...WAGER_OPTIONS], default: 10, min: 10 },
  conquer: { label: 'Stake per round', options: [0, ...WAGER_OPTIONS], default: 10, min: 10 },
  crazy: { label: 'Entry stake', options: [0, ...WAGER_OPTIONS], default: 10, min: 10 },
  penalty: { label: 'Entry stake', options: [0, ...WAGER_OPTIONS], default: 10, min: 10 },
};
/** Poker Sit & Go buy-ins (the buy-in goes to the prize pool; free tournaments are allowed). */
const SNG_STAKES = { label: 'Tournament buy-in', options: [...WAGER_OPTIONS], default: 10, min: 10 };

const RULES: Record<GameSlug, string[]> = {
  ludo: ['Roll a 6 to bring a token out.', 'Land on an opponent to send it home — except on star and start squares.', 'A 6, a capture or reaching home earns another roll. Three 6s in a row ends your turn.', 'Exact roll needed to finish. First to bring all four tokens home wins the pot.'],
  poker: [
    "No-limit Texas Hold'em. Two hole cards, five community cards; the best five-card hand wins.",
    'Blinds rotate each hand. Check, bet, call, raise or fold; all-ins create side pots.',
    'Cash tables are always open at fixed blinds. Sit down at any free seat with 40–100 big blinds, and stand up whenever you like: your chips go back to your balance. Joining a game in progress costs one big blind.',
    'Scheduled tournaments are announced by the Akukulu team. Register before the start (unregistering returns the buy-in); late registration stays open for the first levels. Blinds rise by the clock, antes start at level 4, tables are balanced as players bust, and about 15% of the field is paid.',
    'Sit & Go: everyone pays the same buy-in into a prize pool and starts with 1,500 chips. Blinds rise every 6 hands; bust out and you are out. The prize pool is paid by finishing place.',
    'Your current hand is named under your cards ("Two Pair, Aces & Kings"). Every hand you play is kept in the hand history — open it from the table or your profile.',
    'Use the bet slider or the ½ pot, ¾ pot, pot and all-in buttons. Tick Check / fold to act automatically when it is your turn.',
  ],
  blackjack: ['Get closer to 21 than the dealer without going over.', 'Blackjack pays 3:2. Dealer stands on all 17s.', 'Double on any two cards, split pairs up to four hands.', 'Split aces get one card each.'],
  conquer: [],
  crazy: [],
  penalty: [
    'One against one. You take turns shooting and being the goalkeeper.',
    'Shooter and keeper each tap Left, Middle or Right in secret. If the keeper picks the same side, it is saved. If not, it is a goal.',
    'Five kicks each, stopping early once someone cannot be caught. Level after five goes to sudden death.',
    'You have 15 seconds to pick. Run out of time and a side is picked for you; three misses in a row loses the match.',
    'The winner takes the pot, less the house fee on tables with a stake.',
  ],
};

/** A table option switch (ጆከር ለመሬት, ዶቤ). */
function OptionToggle({ on, onToggle, title, body }: { on: boolean; onToggle: () => void; title: string; body: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-black/10 p-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={onToggle}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-gold' : 'bg-white/20'}`}
      >
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-[1.375rem]' : 'left-0.5'}`} />
      </button>
      <span className="min-w-0">
        <span className="block font-ethiopic text-base font-extrabold text-gold">{title}</span>
        <span className="block text-xs text-muted">{body}</span>
      </span>
    </label>
  );
}

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
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [code, setCode] = useState('');
  // Conquer's ጆከር ለመሬት option: players need twice the stake; a joker finish wins double.
  const [jokerToGround, setJokerToGround] = useState(false);
  // Conquer table size (4 players play with two decks) and the 4-player ዶቤ option.
  const [conquerPlayers, setConquerPlayers] = useState<2 | 4>(2);
  const [dobe, setDobe] = useState(false);
  // Poker: always-open cash tables, Sit & Go tables players start themselves, or scheduled tournaments.
  const [pokerMode, setPokerMode] = useState<'cash' | 'sitgo' | 'tournament'>('cash');
  // Games of this kind I am still in (left the table without finishing), to jump back into.
  const [active, setActive] = useState<{ rooms: RoomSummary[] } | null>(null);

  const [tutorial, setTutorial] = useState(false);
  const pageBalance = user?.balance;
  const startedOnFree = useRef(false);
  useEffect(() => {
    if (startedOnFree.current || pageBalance === undefined || !isGameSlug(slug)) return;
    startedOnFree.current = true;
    if (pageBalance < STAKES[slug].default && STAKES[slug].options[0] === 0) setStake(0);
  }, [pageBalance, slug]);

  const load = useCallback(async () => {
    if (!isGameSlug(slug)) return;
    setRefreshing(true);
    try {
      const games = await api<GameSummary[]>('/games');
      const g = games.find((x) => x.slug === slug) ?? null;
      setGame(g);
      if (g?.playable && !g.solo) setRooms(await api<RoomSummary[]>(`/games/${slug}/rooms`));
      else setRooms([]);
      setActive(await api<{ rooms: RoomSummary[] }>('/me/active').catch(() => null));
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

  const gamePlayable = !!game?.playable;
  useEffect(() => {
    if (gamePlayable && isGameSlug(slug) && !tutorialSeen(slug)) setTutorial(true);
  }, [gamePlayable, slug]);

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
        <EmptyState title="Game not found" body="Akukulu offers Ludo, Poker, Blackjack, Conquer and Crazy." />
      </Page>
    );
  }
  const tournament = slug === 'poker' && pokerMode === 'sitgo';
  // Cash games and scheduled tournaments are lists of their own; only Sit & Go has a table form and room list.
  const pokerCash = slug === 'poker' && pokerMode !== 'sitgo';
  const stakes = tournament ? SNG_STAKES : STAKES[slug];
  const balance = user?.balance ?? 0;
  const joker = slug === 'conquer' && (jokerToGround || (dobe && conquerPlayers === 4));
  // Points needed to sit at a table with this stake (twice the stake for ጆከር ለመሬት or ዶቤ).
  const need = (s: number, double = joker) => s * (double ? 2 : 1);
  const affordable = balance >= need(stake);
  const roomConfig =
    slug === 'conquer'
      ? { jokerToGround, ...(conquerPlayers === 4 ? { players: 4, dobe } : {}) }
      : slug === 'poker'
        ? { mode: 'tournament' }
        : undefined;
  // A private poker table seats the chosen number of players.
  const privateConfig = slug === 'poker' ? { ...roomConfig, maxSeats: maxPlayers } : roomConfig;
  const customValue = custom.trim() === '' ? null : Number(custom);
  const customError =
    customValue === null
      ? null
      : !Number.isInteger(customValue) || customValue < stakes.min
        ? `Enter a whole number of at least ${stakes.min}`
        : need(customValue) > balance
          ? joker
            ? `${dobe ? 'ዶቤ' : 'ጆከር ለመሬት'} needs twice the stake (${need(customValue).toLocaleString()}); you have ${balance.toLocaleString()}`
            : `You only have ${balance.toLocaleString()} ETB`
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
          {(() => {
            const mine = active?.rooms.filter((r) => r.gameSlug === slug && (r.status === 'in_progress' || r.status === 'waiting')) ?? [];
            // (Poker cash tables and tournaments show "Back to table" in their own list below.)
            if (!mine.length) return null;
            return (
              <section className="mb-4 grid gap-2">
                {mine.map((r) => (
                  <Link key={r.id} href={`/room/${r.code}`} className="flex items-center justify-between gap-3 rounded-2xl border border-lime/35 bg-lime/[0.06] px-4 py-3 transition hover:border-lime/60">
                    <div>
                      <div className="text-sm font-bold">{r.status === 'in_progress' ? 'Your match is still on' : 'You are in a waiting room'}</div>
                      <div className="text-[13px] text-muted">
                        Room {r.code}, {r.players.length} of {r.maxPlayers} players
                      </div>
                    </div>
                    <span className="btn-primary btn-sm">{r.status === 'in_progress' ? 'Resume' : 'Open'}</span>
                  </Link>
                ))}
              </section>
            );
          })()}
          {/* The game's world as a banner, with its name and what it is. */}
          <section className="relative -mx-4 mb-5 h-40 overflow-hidden sm:mx-0 sm:h-44 sm:rounded-2xl sm:border sm:border-line lg:h-52" style={{ background: ART_BG[slug] }}>
            <div className="absolute inset-y-0 right-0 aspect-[4/3]">
              <GameThumb slug={slug} />
            </div>
            <div
              className="absolute inset-0"
              style={{ background: `linear-gradient(90deg, ${ART_BG[slug]} 30%, transparent 75%), linear-gradient(180deg, transparent 45%, rgba(6,10,20,.55) 100%)` }}
              aria-hidden
            />
            <Link href="/" className="absolute left-3 top-3 flex h-9 items-center gap-1.5 rounded-full bg-ink/70 px-3 text-[13px] font-semibold text-fg backdrop-blur transition hover:bg-ink/90">
              <span aria-hidden>←</span> All games
            </Link>
            <div className="absolute inset-x-0 bottom-0 px-4 pb-4 sm:px-5">
              <h1 className="font-display text-[30px] font-bold leading-none tracking-[-0.025em]">{game.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-semibold text-fg/80">
                <span>{game.solo ? 'You against the dealer' : game.minPlayers === game.maxPlayers ? `${game.minPlayers} players` : `${game.minPlayers}–${game.maxPlayers} players`}</span>
                <span className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${game.activePlayers > 0 ? 'bg-lime' : 'bg-muted/60'}`} aria-hidden />
                  {game.activePlayers} playing now
                </span>
              </div>
            </div>
          </section>
          <p className="mb-5 max-w-2xl text-[15px] leading-relaxed text-muted">{game.description}</p>

          <div className="lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)] lg:items-start lg:gap-6">
          <div>
          {!game.playable ? (
            <MaintenanceState message={game.maintenanceMessage ?? `${game.name} is temporarily unavailable.`} />
          ) : (
            <>
              {slug === 'poker' && (
                <>
                  <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl border border-line bg-night p-1" role="tablist" aria-label="Poker game type">
                    {(['cash', 'sitgo', 'tournament'] as const).map((m) => (
                      <button
                        key={m}
                        role="tab"
                        aria-selected={pokerMode === m}
                        onClick={() => {
                          setPokerMode(m);
                          setStake(SNG_STAKES.default);
                          setCustom('');
                        }}
                        className={`min-h-[40px] rounded-lg text-sm font-bold transition ${pokerMode === m ? 'bg-panel2 text-fg shadow-[inset_0_0_0_1px_rgba(34,212,138,.45)]' : 'text-muted hover:text-fg'}`}
                      >
                        {m === 'cash' ? 'Cash games' : m === 'sitgo' ? 'Sit & Go' : 'Tournaments'}
                      </button>
                    ))}
                  </div>
                  {pokerMode !== 'sitgo' && <PokerLobby mode={pokerMode} />}
                </>
              )}
              {!game.solo && !pokerCash && (
                <section className="mb-4">
                  <h2 className="section-title mb-3">Open tables</h2>
                  {rooms === null ? (
                    <LoadingState />
                  ) : rooms.length === 0 ? (
                    <EmptyState title="No open tables right now" body="Pick a stake below and start one. Others can join you." />
                  ) : (
                    <div className="grid gap-2">
                      {rooms.filter((r) => slug !== 'poker' || r.config.mode === 'tournament').map((r) => (
                        <div key={r.id} className="card flex items-center justify-between gap-3 px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex -space-x-2">
                              {r.players.slice(0, 4).map((p) => (
                                <Avatar key={p.userId} name={p.displayName} photoUrl={p.photoUrl} size={28} ring="ring-2 ring-panel" />
                              ))}
                            </div>
                            <div>
                              <div className="text-sm font-bold">{r.players.length} of {r.maxPlayers} seats taken</div>
                              <div className="flex items-center gap-1 text-xs text-muted">
                                {r.stake === 0 ? 'Free' : (<><Coin className="h-3 w-3" /> {r.stake}</>)} · {r.players.length}/{r.maxPlayers} players
                                {r.config.jokerToGround === true && <span className="ml-1 rounded-full bg-gold/20 px-1.5 font-ethiopic font-bold text-gold">ጆከር ለመሬት</span>}
                                {r.config.dobe === true && <span className="ml-1 rounded-full bg-gold/20 px-1.5 font-ethiopic font-bold text-gold">ዶቤ</span>}
                                {r.gameSlug === 'poker' && (
                                  <span className="ml-1 rounded-full bg-white/10 px-1.5 font-bold">{r.config.mode === 'tournament' ? 'Sit & Go' : 'Cash'}</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <button
                            className="btn-primary btn-sm"
                            disabled={busy || balance < need(r.stake, r.config.jokerToGround === true || r.config.dobe === true)}
                            onClick={() => run(() => api(`/rooms/${r.code}/join`, { body: {} }))}
                          >
                            Join
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {!pokerCash && (
              <section className="card mb-4 grid gap-4 p-4">
                {slug === 'poker' && (
                  <h2 className="section-title">Sit &amp; Go: starts when the table fills or the timer ends</h2>
                )}
                {tournament && (
                  <div className="rounded-xl border border-gold/40 bg-gold/10 p-3 text-xs">
                    <div className="mb-1 text-sm font-extrabold text-gold">Sit &amp; Go · Turbo</div>
                    <ul className="grid gap-0.5 text-muted">
                      <li>• Everyone pays the buy-in into the prize pool and starts with 1,500 chips.</li>
                      <li>• Blinds start at 10/20 and go up every 6 hands.</li>
                      <li>• Bust out and you are out. The last player with chips wins.</li>
                      <li>• Prizes: winner takes all (2–3 players), 65% / 35% (4–6), 50% / 30% / 20% (7–9).</li>
                      <li>• Starts when the table is full, or when the 1-minute timer ends with at least 2 players.</li>
                    </ul>
                  </div>
                )}
                <div>
                  <div className="label mb-2">{stakes.label}</div>
                  <div className="grid grid-cols-4 gap-2">
                    {stakes.options.map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setStake(s);
                          setCustom('');
                        }}
                        disabled={need(s) > balance}
                        className={`flex min-h-[44px] items-center justify-center gap-1 rounded-xl border text-sm font-bold tabular-nums transition disabled:opacity-35 ${stake === s && custom === '' ? 'border-lime bg-lime/10 text-lime' : 'border-line bg-night text-fg hover:border-lineStrong'}`}
                      >
                        {s === 0 ? 'Free' : (<><Coin className="h-3.5 w-3.5" />{compact(s)}</>)}
                      </button>
                    ))}
                  </div>
                  <label className="mt-2 flex items-center gap-2">
                    <span className="label shrink-0">Custom</span>
                    <input
                      className={`input py-2 ${custom !== '' && !customError ? 'border-lime/60' : ''}`}
                      inputMode="numeric"
                      placeholder={`Any amount from ${stakes.min} to ${balance.toLocaleString()}`}
                      value={custom}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 7);
                        setCustom(v);
                        const n = Number(v);
                        if (v !== '' && Number.isInteger(n) && n >= stakes.min && need(n) <= balance) setStake(n);
                      }}
                    />
                  </label>
                  {customError && <p className="mt-2 text-xs text-danger">{customError}</p>}
                  {!customError && !affordable && (
                    <p className="mt-2 text-xs text-danger">
                      You need {need(stake).toLocaleString()} ETB for this table{joker ? ` (${dobe ? 'ዶቤ' : 'ጆከር ለመሬት'}: twice the stake)` : ''}.
                    </p>
                  )}
                </div>

                {slug === 'conquer' && (
                  <div className="grid gap-2">
                    <div>
                      <div className="label mb-2">Players</div>
                      <div className="grid grid-cols-2 gap-2">
                        {([2, 4] as const).map((n) => (
                          <button
                            key={n}
                            onClick={() => {
                              setConquerPlayers(n);
                              if (n === 2) setDobe(false);
                            }}
                            className={`min-h-[44px] rounded-xl border text-sm font-bold transition ${conquerPlayers === n ? 'border-lime bg-lime/10 text-lime' : 'border-line bg-night text-fg hover:border-lineStrong'}`}
                          >
                            {n === 2 ? '1 v 1' : '2–4 players · 2 decks'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <OptionToggle
                      on={jokerToGround}
                      onToggle={() => {
                        setJokerToGround((v) => !v);
                        setDobe(false);
                      }}
                      title="ጆከር ለመሬት"
                      body="Everyone needs twice the stake. Go out with a joker as your last card to win double the stake."
                    />
                    {conquerPlayers === 4 && (
                      <OptionToggle
                        on={dobe}
                        onToggle={() => {
                          setDobe((v) => !v);
                          setJokerToGround(false);
                        }}
                        title="ዶቤ"
                        body="Everyone needs twice the stake. Five pairs of identical cards and one set of three, laid down at once (no 41 needed), win double."
                      />
                    )}
                    {conquerPlayers === 4 && <p className="text-xs text-muted">ጆከር ለመሬት and ዶቤ cannot both be on.</p>}
                  </div>
                )}

                {slug !== 'blackjack' && slug !== 'conquer' && slug !== 'penalty' && (
                  <div>
                    <div className="label mb-2">Players at the table</div>
                    <div className="flex gap-2">
                      {(slug === 'ludo' ? [2, 3, 4] : slug === 'crazy' ? [2, 3, 4, 5] : [2, 4, 6, 9]).map((n) => (
                        <button key={n} onClick={() => setMaxPlayers(n)} className={`grid h-11 w-11 place-items-center rounded-xl border text-sm font-bold transition ${maxPlayers === n ? 'border-lime bg-lime/10 text-lime' : 'border-line bg-night text-muted hover:text-fg'}`}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-primary" disabled={busy || !affordable || !!customError} onClick={() => run(() => api('/rooms/quick-play', { body: { gameSlug: slug, stake, config: roomConfig, ...(slug === 'conquer' || game.solo ? {} : { maxPlayers }) } }))}>
                    {game.solo ? 'Sit at a table' : 'Quick play'}
                  </button>
                  {!game.solo && (
                    <button
                      className="btn-ghost"
                      disabled={busy || !affordable || !!customError}
                      onClick={() => run(() => api('/rooms', { body: { gameSlug: slug, stake, visibility: 'private', maxPlayers, config: privateConfig } }))}
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
                    <input className="input uppercase placeholder:normal-case" placeholder="Room code" value={code} maxLength={8} onChange={(e) => setCode(e.target.value)} />
                    <button className="btn-ghost shrink-0" disabled={busy || code.trim().length < 4}>
                      Join
                    </button>
                  </form>
                )}
              </section>
              )}

            </>
          )}

          </div>
          {/* Long rule sets start folded on phones so the table controls stay in reach. */}
          <details className="card group p-5 lg:sticky lg:top-8" open={slug !== 'conquer' && slug !== 'crazy'}>
            <summary className="section-title flex cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden">
              How to play
              <span className="text-base text-muted transition group-open:rotate-180" aria-hidden>
                ⌄
              </span>
            </summary>
            <div className="mt-3">
            <button className="btn-ghost btn-sm mb-3" onClick={() => setTutorial(true)}>
              Show the walkthrough again
            </button>
            {slug === 'conquer' ? (
              <ConquerRulesList />
            ) : slug === 'crazy' ? (
              <CrazyRulesList />
            ) : (
              <ul className="grid gap-2.5 text-sm leading-relaxed text-muted">
                {RULES[slug].map((r) => (
                  <li key={r} className="flex gap-2">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rotate-45 bg-gold" aria-hidden />
                    {r}
                  </li>
                ))}
              </ul>
            )}
            </div>
          </details>
          </div>
        </>
      )}
      {tutorial && isGameSlug(slug) && <GameTutorial slug={slug} onClose={() => setTutorial(false)} />}
      <Toast message={toast} onClose={() => setToast(null)} />
    </Page>
  );
}
