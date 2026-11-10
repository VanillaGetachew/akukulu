'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BINGO_FINISH_MS, PENALTY_REVEAL_MS, RPS_REVEAL_MS, type BingoView, type BlackjackView, type ConquerView, type CrazyView, type LudoView, type MatchSummary, type PenaltyView, type PokerView, type RoomSummary, type RpsView } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useMatch } from '@/lib/use-match';
import { openShare } from '@/lib/telegram';
import { useDialog } from '@/lib/dialog';
import { Avatar, Coin, ErrorState, LoadingState, Page, Points, Toast } from '@/components/ui';
import { LudoTable } from '@/components/games/ludo-table';
import { PokerTable } from '@/components/games/poker-table';
import { BlackjackTable } from '@/components/games/blackjack-table';
import { ConquerTable } from '@/components/games/conquer-table';
import { CrazyTable } from '@/components/games/crazy-table';
import { PenaltyTable } from '@/components/games/penalty-table';
import { RpsTable } from '@/components/games/rps-table';
import { BingoTable } from '@/components/games/bingo-table';
import { TableSwitcher } from '@/components/games/table-switcher';
import { CardRain, LudoWin, PenaltyWin } from '@/components/fx';

function WaitingRoom({ room, onAction, busy }: { room: RoomSummary; onAction: (path: string, body?: unknown) => void; busy: boolean }) {
  const { user } = useSession();
  const me = room.players.find((p) => p.userId === user?.id);
  const [copied, setCopied] = useState(false);
  // A big table lists who is here, then one row for the seats still open.
  const big = room.maxPlayers > 5;
  const open = room.maxPlayers - room.players.length;
  const seats = big
    ? [...[...room.players].sort((a, b) => a.seat - b.seat), ...(open > 0 ? [null] : [])]
    : Array.from({ length: room.maxPlayers }, (_, i) => room.players.find((p) => p.seat === i) ?? null);

  return (
    <div className="grid gap-4">
      <section className="card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="label">
              {room.visibility === 'public' ? 'Public' : 'Private'} {room.gameSlug} room
            </div>
            <div className="mt-1 font-display text-[32px] font-bold tracking-[0.18em] tabular-nums">{room.code}</div>
          </div>
          <div className="text-right text-xs text-muted">
            <div className="flex items-center justify-end gap-1 text-sm font-bold text-fg">
              {room.stake === 0 ? 'Free' : (<><Coin /> {room.stake}</>)}
            </div>
            {room.gameSlug === 'poker' ? 'buy-in' : 'entry'}
          </div>
        </div>
        {room.inviteLink && (
          <div className="mt-3 flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => openShare(room.inviteLink!, `Join my ${room.gameSlug} table on Akukulu!`)}>
              Invite friends
            </button>
            <button
              className="btn-ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(room.inviteLink!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* clipboard unavailable */
                }
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        )}
      </section>

      <RoomCountdown startsAt={room.startsAt} enough={room.players.length >= room.minPlayers} />

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-extrabold">Players</h2>
          <span className="text-xs text-muted">
            {big && room.players.length + ' of ' + room.maxPlayers + ' joined · '}Needs {room.minPlayers}+ players
          </span>
        </div>
        <div className="grid gap-2">
          {seats.map((p, i) => (
            <div key={i} className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${p ? 'border-line bg-black/20' : 'border-dashed border-white/10'}`}>
              {p ? (
                <>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={p.displayName} photoUrl={p.photoUrl} />
                    <div>
                      <div className="text-sm font-bold">
                        {p.displayName} {p.userId === user?.id && <span className="text-muted">(you)</span>}
                      </div>
                      {p.userId === room.hostId && <div className="text-[11px] text-gold">Host</div>}
                    </div>
                  </div>
                </>
              ) : (
                <span className="text-sm text-muted">{big ? (open === 1 ? '1 more seat open…' : open + ' more seats open…') : 'Waiting for a player…'}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2">
        {me ? (
          <button className="btn-ghost col-span-2" disabled={busy} onClick={() => onAction('leave')}>
            Leave
          </button>
        ) : (
          <button className="btn-primary col-span-2" disabled={busy || room.players.length >= room.maxPlayers} onClick={() => onAction('join')}>
            {room.players.length >= room.maxPlayers ? 'Room is full' : 'Join this room'}
          </button>
        )}
      </div>
    </div>
  );
}

/** The room starts when this reaches zero, if enough players have joined. */
function RoomCountdown({ startsAt, enough }: { startsAt: string | null; enough: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  if (!startsAt) return null;
  const left = Math.max(0, Math.ceil((new Date(startsAt).getTime() - now) / 1000));
  return (
    <section className="card flex items-center justify-between gap-3 p-4" role="timer" aria-live="off">
      <div className="min-w-0">
        <div className="text-sm font-bold">{left > 0 ? (enough ? 'Starting soon' : 'Waiting for players') : enough ? 'Starting…' : 'Closing…'}</div>
        <div className="text-[13px] text-muted">{enough ? 'The game starts when the timer ends, or as soon as the table is full.' : 'The room closes if not enough players join in time. You pay nothing unless it starts.'}</div>
      </div>
      <div className={`font-display text-3xl font-bold tabular-nums ${left <= 10 ? 'text-danger' : 'text-gold'}`}>
        {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
      </div>
    </section>
  );
}

function ResultSheet({ summary, stake }: { summary: MatchSummary; stake: number }) {
  const { user } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Play again: straight into a new table of the same game and stake.
  const playAgain = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await api<RoomSummary>('/rooms/quick-play', { body: { gameSlug: summary.gameSlug, stake } });
      router.push(`/room/${room.code}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  const mine = summary.players.find((p) => p.userId === user?.id);
  const delta = mine?.pointsDelta ?? 0;
  const title =
    summary.status === 'cancelled'
      ? 'Match voided'
      : delta > 0
        ? `You won ${delta.toLocaleString()} ETB!`
        : delta < 0
          ? `You lost ${Math.abs(delta).toLocaleString()} ETB`
          : mine?.outcome === 'win'
            ? 'You won!'
            : mine?.outcome === 'draw'
              ? 'Draw'
              : 'Match over';
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-black/60 p-4 backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true">
      {/* Each game celebrates its own way: Ludo with confetti and a trophy, the card games with falling cards. */}
      {(delta > 0 || mine?.outcome === 'win') && (summary.gameSlug === 'ludo' || summary.gameSlug === 'rps' || summary.gameSlug === 'bingo' ? <LudoWin /> : summary.gameSlug === 'penalty' ? <PenaltyWin /> : <CardRain />)}
      <div className="card w-full max-w-md animate-pop p-5">
        <h2 className={`font-display text-2xl font-extrabold ${delta > 0 || mine?.outcome === 'win' ? 'text-lime' : delta < 0 ? 'text-danger' : ''}`}>{title}</h2>
        <div className="mt-3 grid gap-1.5">
          {[...summary.players]
            .sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99))
            .map((p) => (
              <div key={p.userId} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-sm">
                <span className="font-bold">
                  {p.placement ?? '–'}. {p.displayName}
                </span>
                <span className={`flex items-center gap-1 font-bold ${p.pointsDelta > 0 ? 'text-lime' : p.pointsDelta < 0 ? 'text-danger' : 'text-muted'}`}>
                  <Coin className="h-3.5 w-3.5" />
                  <Points value={p.pointsDelta} signed />
                </span>
              </div>
            ))}
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link href={`/games/${summary.gameSlug}`} className="btn-ghost">
            Game lobby
          </Link>
          <button className="btn-primary" disabled={busy} onClick={playAgain}>
            {busy ? 'Finding a table…' : 'Play again'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RoomPage() {
  const { code: rawCode } = useParams<{ code: string }>();
  const code = rawCode.toUpperCase();
  // Keyed, so switching to another table starts clean rather than carrying this one's result.
  return <RoomView key={code} code={code} />;
}

function RoomView({ code }: { code: string }) {
  const router = useRouter();
  const { socket, connected } = useSession();
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finalSummary, setFinalSummary] = useState<MatchSummary | null>(null);
  const match = useMatch(room?.matchId ?? null);

  const load = useCallback(async () => {
    try {
      setRoom(await api<RoomSummary>(`/rooms/${code}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!socket || !connected) return;
    const onRoom = (r: RoomSummary) => r.code === code && setRoom(r);
    socket.on('room:state', onRoom);
    socket.emit('room:subscribe', { code }, (res) => {
      if (res.ok && res.room) setRoom(res.room);
    });
    return () => {
      socket.off('room:state', onRoom);
      socket.emit('room:unsubscribe', { code });
    };
  }, [socket, connected, code]);

  const dialog = useDialog();
  const status = match.state?.status;
  // A shootout won by a kick shows that kick before the result sheet covers the pitch.
  const ending = (match.state?.view as PenaltyView | CrazyView | RpsView | BingoView | undefined)?.finishReason;
  // A card game leaves the final table on screen for a moment, so everyone can see how it ended.
  const resultDelay = !ending || ending === 'forfeit' ? 0 : room?.gameSlug === 'penalty' ? PENALTY_REVEAL_MS + 400 : room?.gameSlug === 'rps' ? RPS_REVEAL_MS + 400 : room?.gameSlug === 'bingo' ? BINGO_FINISH_MS : room?.gameSlug === 'crazy' ? 6000 : 0;
  useEffect(() => {
    if (status !== 'finished' && status !== 'cancelled') return;
    const timer = setTimeout(() => {
      if (match.ended) setFinalSummary(match.ended);
      else if (room?.matchId) void api<MatchSummary>(`/matches/${room.matchId}`).then(setFinalSummary).catch(() => undefined);
    }, resultDelay);
    return () => clearTimeout(timer);
  }, [status, match.ended, room?.matchId, resultDelay]);

  async function roomAction(path: string, body?: unknown) {
    setBusy(true);
    try {
      const r = await api<RoomSummary>(`/rooms/${code}/${path}`, { body: body ?? {} });
      if (path === 'leave' && r.status !== 'in_progress') router.push(`/games/${r.gameSlug}`);
      else setRoom(r);
    } catch (err) {
      setToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const table = (() => {
    if (!match.state) return null;
    const common = { state: match.state, act: match.act, pending: match.pending, serverNow: match.serverNow };
    switch (match.state.view.game) {
      case 'ludo':
        return <LudoTable {...common} view={match.state.view as LudoView} />;
      case 'poker':
        return <PokerTable {...common} view={match.state.view as PokerView} />;
      case 'blackjack':
        return <BlackjackTable {...common} view={match.state.view as BlackjackView} />;
      case 'conquer':
        return <ConquerTable {...common} view={match.state.view as ConquerView} />;
      case 'crazy':
        return <CrazyTable {...common} view={match.state.view as CrazyView} />;
      case 'penalty':
        return <PenaltyTable {...common} view={match.state.view as PenaltyView} />;
      case 'rps':
        return <RpsTable {...common} view={match.state.view as RpsView} />;
      case 'bingo':
        return <BingoTable {...common} view={match.state.view as BingoView} />;
    }
  })();

  // Every table is full-screen with its own back button; the waiting room gets this one.
  const backLink = room && room.status === 'waiting' && (
    <Link href={`/games/${room.gameSlug}`} className="mb-3 inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-fg">
      <span aria-hidden>←</span> <span className="capitalize">{room.gameSlug}</span> lobby
    </Link>
  );

  return (
    <Page nav={!room?.matchId}>
      {backLink}
      {error && !room ? (
        <ErrorState message={error} onRetry={load} />
      ) : !room ? (
        <LoadingState label="Opening room…" />
      ) : room.status === 'waiting' ? (
        <WaitingRoom room={room} onAction={roomAction} busy={busy} />
      ) : room.status === 'cancelled' && !room.matchId ? (
        <section className="card grid justify-items-center gap-3 p-8 text-center">
          <h2 className="font-display text-lg font-extrabold">This table has closed</h2>
          <p className="max-w-xs text-sm text-muted">Not enough players joined in time, so the game didn't start and nothing was charged.</p>
          <button className="btn-primary" onClick={() => router.push(`/games/${room.gameSlug}`)}>
            Back to lobby
          </button>
        </section>
      ) : !table ? (
        <LoadingState label="Joining the table…" />
      ) : (
        <>
          {table}
          {match.state && match.state.view.game !== 'poker' && (
            <div className="fixed right-2 z-[37]" style={{ top: `calc(var(--safe-top) + ${match.state.view.game === 'penalty' || match.state.view.game === 'rps' || match.state.view.game === 'bingo' ? 64 : 8}px)` }}>
              <TableSwitcher matchId={match.state.matchId} />
            </div>
          )}
          {match.state?.status === 'active' && room.gameSlug !== 'blackjack' && (
            <div className="mt-4 flex justify-center">
              <button
                className="text-xs font-bold text-muted underline-offset-4 hover:text-danger hover:underline"
                onClick={() => {
                  void dialog.confirm({ message: 'Leave this match? You forfeit your seat.', confirmLabel: 'Leave', danger: true }).then((ok) => {
                    if (ok) void match.act({ type: 'leave' });
                  });
                }}
              >
                Leave match
              </button>
            </div>
          )}
        </>
      )}
      {finalSummary && room && <ResultSheet summary={finalSummary} stake={room.stake} />}
      <Toast message={toast ?? match.error} onClose={() => (setToast(null), match.setError(null))} />
    </Page>
  );
}
