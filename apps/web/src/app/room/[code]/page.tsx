'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { BlackjackView, ConquerView, CrazyView, LudoView, MatchSummary, PokerView, RoomSummary } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useMatch } from '@/lib/use-match';
import { openShare } from '@/lib/telegram';
import { Avatar, Coin, ErrorState, LoadingState, Page, Points, Toast } from '@/components/ui';
import { LudoTable } from '@/components/games/ludo-table';
import { PokerTable } from '@/components/games/poker-table';
import { BlackjackTable } from '@/components/games/blackjack-table';
import { ConquerTable } from '@/components/games/conquer-table';
import { CrazyTable } from '@/components/games/crazy-table';
import { CardRain, LudoWin } from '@/components/fx';

function WaitingRoom({ room, onAction, busy }: { room: RoomSummary; onAction: (path: string, body?: unknown) => void; busy: boolean }) {
  const { user } = useSession();
  const me = room.players.find((p) => p.userId === user?.id);
  const [copied, setCopied] = useState(false);
  const seats = Array.from({ length: room.maxPlayers }, (_, i) => room.players.find((p) => p.seat === i) ?? null);

  return (
    <div className="grid gap-4">
      <section className="card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-muted">{room.gameSlug} · {room.visibility} room</div>
            <div className="font-display text-3xl font-extrabold tracking-[0.2em]">{room.code}</div>
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

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-extrabold">Players</h2>
          <span className="text-xs text-muted">
            Starts when {room.minPlayers}+ players are ready
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
                  <span className={`chip ${p.ready ? 'border-lime/40 text-lime' : ''}`}>{p.ready ? 'Ready' : 'Not ready'}</span>
                </>
              ) : (
                <span className="text-sm text-muted">Waiting for a player…</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2">
        {me ? (
          <>
            <button className={me.ready ? 'btn-ghost' : 'btn-primary'} disabled={busy} onClick={() => onAction('ready', { ready: !me.ready })}>
              {me.ready ? 'Not ready' : "I'm ready"}
            </button>
            <button className="btn-ghost" disabled={busy} onClick={() => onAction('leave')}>
              Leave
            </button>
          </>
        ) : (
          <button className="btn-primary col-span-2" disabled={busy || room.players.length >= room.maxPlayers} onClick={() => onAction('join')}>
            {room.players.length >= room.maxPlayers ? 'Room is full' : 'Join this room'}
          </button>
        )}
      </div>
    </div>
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
        ? `You won ${delta.toLocaleString()} points!`
        : delta < 0
          ? `You lost ${Math.abs(delta).toLocaleString()} points`
          : mine?.outcome === 'win'
            ? 'You won!'
            : mine?.outcome === 'draw'
              ? 'Draw'
              : 'Match over';
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-black/60 p-4 backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true">
      {/* Each game celebrates its own way: Ludo with confetti and a trophy, the card games with falling cards. */}
      {(delta > 0 || mine?.outcome === 'win') && (summary.gameSlug === 'ludo' ? <LudoWin /> : <CardRain />)}
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
          <Link href="/" className="btn-ghost">
            Lobby
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

  const status = match.state?.status;
  useEffect(() => {
    if (status === 'finished' || status === 'cancelled') {
      if (match.ended) setFinalSummary(match.ended);
      else if (room?.matchId) void api<MatchSummary>(`/matches/${room.matchId}`).then(setFinalSummary).catch(() => undefined);
    }
  }, [status, match.ended, room?.matchId]);

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
    }
  })();

  return (
    <Page nav={!room?.matchId}>
      {error && !room ? (
        <ErrorState message={error} onRetry={load} />
      ) : !room ? (
        <LoadingState label="Opening room…" />
      ) : room.status === 'waiting' ? (
        <WaitingRoom room={room} onAction={roomAction} busy={busy} />
      ) : room.status === 'cancelled' && !room.matchId ? (
        <ErrorState message="This room was closed." onRetry={() => router.push(`/games/${room.gameSlug}`)} />
      ) : !table ? (
        <LoadingState label="Joining the table…" />
      ) : (
        <>
          {table}
          {match.state?.status === 'active' && room.gameSlug !== 'blackjack' && (
            <div className="mt-4 flex justify-center">
              <button
                className="text-xs font-bold text-muted underline-offset-4 hover:text-danger hover:underline"
                onClick={() => {
                  if (confirm('Leave this match? You forfeit your seat.')) void match.act({ type: 'leave' });
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
