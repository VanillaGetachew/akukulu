'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { haptic, openShare } from '@/lib/telegram';
import { Coin, ErrorState, LoadingState, Page, Toast } from '@/components/ui';

interface Rewards {
  dailyAmount: number;
  dailyAvailable: boolean;
  dailyPending: boolean;
  pendingRewards: number;
  requiresApproval: boolean;
  nextDailyAt: string;
  referralReward: number;
  referralsCount: number;
}

export default function RewardsPage() {
  const { user } = useSession();
  const [data, setData] = useState<Rewards | null>(null);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, cfg] = await Promise.all([api<Rewards>('/rewards'), api<{ botUsername: string | null }>('/auth/config')]);
      setData(r);
      setBotUsername(cfg.botUsername);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim() {
    setBusy(true);
    try {
      const res = await api<{ claimed: boolean; pending: boolean; amount: number }>('/rewards/daily', { body: {} });
      haptic(res.claimed ? 'success' : 'error');
      setToast(
        !res.claimed
          ? { text: 'Already claimed today', tone: 'error' }
          : res.pending
            ? { text: 'Requested — an admin will approve it', tone: 'success' }
            : { text: `+${res.amount} points added!`, tone: 'success' },
      );
      await load();
    } catch (err) {
      setToast({ text: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const referralLink = botUsername && user ? `https://t.me/${botUsername}?start=ref_${user.referralCode}` : null;

  const nextAt = data ? new Date(data.nextDailyAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <Page onRefresh={load}>
      <h1 className="mb-1 font-display text-[28px] font-bold tracking-[-0.025em]">Rewards</h1>
      <p className="mb-5 text-[15px] text-muted">Free points every day, and more for every friend you bring.</p>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data ? (
        <LoadingState />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          {/* Daily reward: the amount is the hero. */}
          <section className="relative min-w-0 overflow-hidden rounded-2xl border border-gold/25 bg-[radial-gradient(120%_90%_at_100%_0%,rgba(230,199,127,.16),transparent_60%),rgb(var(--panel))] p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-fg">Daily reward</h2>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-[44px] font-bold leading-none tracking-[-0.03em] text-gold tabular-nums">{data.dailyAmount}</span>
                  <span className="text-[15px] font-semibold text-muted">points</span>
                </div>
              </div>
              <Coin className="h-14 w-14 drop-shadow-[0_8px_18px_rgba(230,199,127,.35)]" />
            </div>
            <p className="mt-3 text-sm text-muted">
              {data.dailyAvailable
                ? data.requiresApproval
                  ? 'Ready to request. An admin approves it.'
                  : 'Ready to claim now.'
                : data.dailyPending
                  ? 'Requested. Waiting for an admin to approve it.'
                  : `Claimed today. The next one opens at ${nextAt}.`}
            </p>
            {data.pendingRewards > 0 && (
              <p className="mt-1 text-[13px] font-semibold text-gold">
                {data.pendingRewards} reward{data.pendingRewards === 1 ? '' : 's'} waiting for approval
              </p>
            )}
            <button className="btn-gold mt-4 w-full py-3" disabled={busy || !data.dailyAvailable} onClick={claim}>
              {data.dailyAvailable ? (data.requiresApproval ? `Request ${data.dailyAmount} points` : `Claim ${data.dailyAmount} points`) : data.dailyPending ? 'Waiting for approval' : `Next reward at ${nextAt}`}
            </button>
          </section>

          {/* Referrals */}
          <section className="card min-w-0 p-5">
            <h2 className="text-[15px] font-semibold text-fg">Invite friends</h2>
            <p className="mt-1 text-sm text-muted">
              You get <span className="font-semibold text-gold">{data.referralReward} points</span> when a friend joins with your link.
            </p>
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-night px-4 py-3">
              <div className="font-display text-[28px] font-bold leading-none tabular-nums">{data.referralsCount}</div>
              <div className="text-[13px] leading-tight text-muted">
                friend{data.referralsCount === 1 ? '' : 's'} joined
                <br />
                {(data.referralsCount * data.referralReward).toLocaleString()} points earned
              </div>
            </div>
            {referralLink ? (
              <>
                <div className="mt-3 truncate rounded-xl border border-line bg-night px-3 py-2.5 font-mono text-xs text-muted" title={referralLink}>
                  {referralLink}
                </div>
                <button className="btn-primary mt-3 w-full" onClick={() => openShare(referralLink, 'Play Ludo, Poker, Blackjack, Conquer and Crazy with me on Akukulu!')}>
                  Share your invite link
                </button>
              </>
            ) : (
              <p className="mt-3 text-[13px] text-muted">Invite links appear once the bot is set up.</p>
            )}
          </section>
          <p className="text-center text-xs text-muted/80 lg:col-span-2">Points are free virtual credits with no cash value.</p>
        </div>
      )}
      <Toast message={toast?.text ?? null} tone={toast?.tone} onClose={() => setToast(null)} />
    </Page>
  );
}
