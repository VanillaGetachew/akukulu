'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GameSummary, MatchSummary, UserProfile } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ErrorState, LoadingState, Page, Toast } from '@/components/ui';

interface Overview {
  users: number;
  pointsInCirculation: number;
  activeMatches: number;
  waitingRooms: number;
  online: number;
}

type AdminUser = UserProfile & { isBanned: boolean };

export default function AdminPage() {
  const { user } = useSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, g, m, u] = await Promise.all([
        api<Overview>('/admin/overview'),
        api<GameSummary[]>('/admin/games'),
        api<MatchSummary[]>('/admin/matches?status=active'),
        api<AdminUser[]>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
      ]);
      setOverview(o);
      setGames(g);
      setMatches(m);
      setUsers(u);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [q]);

  useEffect(() => {
    if (user?.isAdmin) void load();
  }, [load, user?.isAdmin]);

  async function run(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      setToast(done);
      await load();
    } catch (err) {
      setToast((err as Error).message);
    }
  }

  if (!user?.isAdmin) {
    return (
      <Page>
        <ErrorState message="Administrator access required." />
      </Page>
    );
  }

  return (
    <Page onRefresh={load}>
      <h1 className="mb-3 font-display text-2xl font-extrabold">Administration</h1>
      {error && <ErrorState message={error} onRetry={load} />}
      {!overview ? (
        <LoadingState />
      ) : (
        <div className="grid gap-4">
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ['Users', overview.users],
              ['Online', overview.online],
              ['Active matches', overview.activeMatches],
              ['Waiting rooms', overview.waitingRooms],
              ['Points in circulation', overview.pointsInCirculation],
            ].map(([label, value]) => (
              <div key={label} className="card p-3">
                <div className="text-[11px] font-bold text-muted">{label}</div>
                <div className="font-display text-xl font-extrabold">{Number(value).toLocaleString()}</div>
              </div>
            ))}
          </section>

          <section className="card p-4">
            <h2 className="mb-2 font-display text-base font-extrabold">Games</h2>
            <div className="grid gap-2">
              {games.map((g) => (
                <div key={g.slug} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2">
                  <div>
                    <div className="text-sm font-bold">{g.name}</div>
                    <div className="text-xs text-muted">
                      {g.enabled ? 'Enabled' : 'Disabled'} · {g.maintenance ? 'Maintenance' : 'Live'} · {g.activePlayers} playing
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => run(() => api(`/admin/games/${g.slug}`, { method: 'PATCH', body: { enabled: !g.enabled } }), 'Game updated')}>
                      {g.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => run(() => api(`/admin/games/${g.slug}`, { method: 'PATCH', body: { maintenance: !g.maintenance } }), 'Game updated')}>
                      {g.maintenance ? 'End maintenance' : 'Maintenance'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-4">
            <h2 className="mb-2 font-display text-base font-extrabold">Active matches</h2>
            {matches.length === 0 ? (
              <p className="text-sm text-muted">No active matches.</p>
            ) : (
              <div className="grid gap-2">
                {matches.map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2 text-sm">
                    <div>
                      <div className="font-bold capitalize">{m.gameSlug} · {m.roomCode}</div>
                      <div className="text-xs text-muted">{m.players.map((p) => p.displayName).join(', ')}</div>
                    </div>
                    <button
                      className="btn-danger px-3 py-1.5 text-xs"
                      onClick={() => {
                        const reason = prompt('Reason for voiding this match (stakes are refunded)');
                        if (reason) void run(() => api(`/admin/matches/${m.id}/void`, { body: { reason } }), 'Match voided');
                      }}
                    >
                      Void
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-extrabold">Users</h2>
              <input className="input max-w-[12rem] py-1.5" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="grid gap-2">
              {users.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2 text-sm">
                  <div>
                    <div className="font-bold">
                      {u.firstName} {u.username && <span className="text-muted">@{u.username}</span>}
                    </div>
                    <div className="text-xs text-muted">{u.balance.toLocaleString()} pts · tg {u.telegramId}{u.isBanned && ' · banned'}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="btn-ghost px-3 py-1.5 text-xs"
                      onClick={() => {
                        const amount = Number(prompt('Adjust points by (negative to deduct)'));
                        const reason = amount ? prompt('Reason') : null;
                        if (amount && reason) void run(() => api(`/admin/users/${u.id}/adjust`, { body: { amount, reason } }), 'Balance adjusted');
                      }}
                    >
                      Adjust
                    </button>
                    <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => run(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { isBanned: !u.isBanned } }), u.isBanned ? 'User unbanned' : 'User banned')}>
                      {u.isBanned ? 'Unban' : 'Ban'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
      <Toast message={toast} onClose={() => setToast(null)} />
    </Page>
  );
}
