'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GameSummary, MatchSummary, UserProfile } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ErrorState, LoadingState, Page, Toast } from '@/components/ui';
import { AdminTournaments } from '@/components/admin-tournaments';

interface Overview {
  users: number;
  pointsInCirculation: number;
  activeMatches: number;
  waitingRooms: number;
  online: number;
  pendingRewards: number;
}

interface RewardRequest {
  id: string;
  userId: string;
  displayName: string;
  telegramId: string;
  type: 'daily' | 'referral';
  amount: number;
  description: string;
  createdAt: string;
}

/** Inline form to deposit coins into one account. */
function DepositForm({ onDeposit }: { onDeposit: (amount: number, reason: string) => Promise<void> }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const value = Number(amount);
  const valid = Number.isInteger(value) && value > 0 && reason.trim().length > 0;
  return (
    <form
      className="mt-2 flex flex-wrap gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        await onDeposit(value, reason.trim());
        setBusy(false);
        setAmount('');
        setReason('');
      }}
    >
      <input className="input w-24 py-1.5" inputMode="numeric" placeholder="Coins" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))} />
      <input className="input min-w-0 flex-1 py-1.5" placeholder="Reason (required)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="btn-primary px-3 py-1.5 text-xs" disabled={!valid || busy}>
        Deposit
      </button>
    </form>
  );
}

type AdminUser = UserProfile & { isBanned: boolean };

export default function AdminPage() {
  const { user } = useSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [rewards, setRewards] = useState<RewardRequest[]>([]);
  const [depositFor, setDepositFor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, g, m, u, r] = await Promise.all([
        api<Overview>('/admin/overview'),
        api<GameSummary[]>('/admin/games'),
        api<MatchSummary[]>('/admin/matches?status=active'),
        api<AdminUser[]>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
        api<RewardRequest[]>('/admin/rewards?status=pending'),
      ]);
      setOverview(o);
      setRewards(r);
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
              ['Rewards to approve', overview.pendingRewards],
            ].map(([label, value]) => (
              <div key={label} className="card p-3">
                <div className="text-[11px] font-bold text-muted">{label}</div>
                <div className="font-display text-xl font-extrabold">{Number(value).toLocaleString()}</div>
              </div>
            ))}
          </section>

          <section className="card border-gold/30 p-4">
            <h2 className="mb-1 font-display text-base font-extrabold">Rewards waiting for approval</h2>
            <p className="mb-2 text-xs text-muted">Daily and referral rewards are paid only after an administrator approves them.</p>
            {rewards.length === 0 ? (
              <p className="text-sm text-muted">Nothing to approve.</p>
            ) : (
              <div className="grid gap-2">
                {rewards.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-bold">
                        {r.displayName} <span className="text-gold">+{r.amount.toLocaleString()}</span>
                      </div>
                      <div className="truncate text-xs text-muted">
                        {r.description} · tg {r.telegramId} · {new Date(r.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => run(() => api(`/admin/rewards/${r.id}/approve`, { body: {} }), `Approved +${r.amount}`)}>
                        Approve
                      </button>
                      <button
                        className="btn-ghost px-3 py-1.5 text-xs"
                        onClick={() => {
                          const note = prompt('Reason for rejecting (optional)') ?? '';
                          void run(() => api(`/admin/rewards/${r.id}/reject`, { body: { note } }), 'Rejected');
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
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

          <AdminTournaments onDone={setToast} />

          <section className="card p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-extrabold">Users</h2>
              <input className="input max-w-[12rem] py-1.5" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="grid gap-2">
              {users.map((u) => (
                <div key={u.id} className="rounded-xl bg-black/20 px-3 py-2 text-sm">
                 <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-bold">
                      {u.firstName} {u.username && <span className="text-muted">@{u.username}</span>}
                    </div>
                    <div className="text-xs text-muted">{u.balance.toLocaleString()} pts · tg {u.telegramId}{u.isBanned && ' · banned'}</div>
                  </div>
                  <div className="flex gap-2">
                    <button className={`px-3 py-1.5 text-xs ${depositFor === u.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setDepositFor(depositFor === u.id ? null : u.id)}>
                      Deposit coins
                    </button>
                    <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => run(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { isBanned: !u.isBanned } }), u.isBanned ? 'User unbanned' : 'User banned')}>
                      {u.isBanned ? 'Unban' : 'Ban'}
                    </button>
                  </div>
                 </div>
                  {depositFor === u.id && (
                    <DepositForm
                      onDeposit={(amount, reason) =>
                        run(() => api(`/admin/users/${u.id}/deposit`, { body: { amount, reason } }), `Deposited ${amount.toLocaleString()} coins to ${u.firstName}`)
                      }
                    />
                  )}
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
