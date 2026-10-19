'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { haptic, openShare } from '@/lib/telegram';
import { Coin, ErrorState, LoadingState, Page, Toast } from '@/components/ui';

interface Rewards {
  dailyAmount: number;
  dailyAvailable: boolean;
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
      const res = await api<{ claimed: boolean; amount: number }>('/rewards/daily', { body: {} });
      haptic(res.claimed ? 'success' : 'error');
      setToast(res.claimed ? { text: `+${res.amount} points added!`, tone: 'success' } : { text: 'Already claimed today', tone: 'error' });
      await load();
    } catch (err) {
      setToast({ text: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const referralLink = botUsername && user ? `https://t.me/${botUsername}?start=ref_${user.referralCode}` : null;

  return (
    <Page onRefresh={load}>
      <h1 className="mb-3 font-display text-2xl font-extrabold">Rewards</h1>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data ? (
        <LoadingState />
      ) : (
        <div className="grid gap-3">
          <section className="card grid gap-3 border-lime/30 p-5">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-lime/15">
                <Coin className="h-7 w-7" />
              </div>
              <div>
                <div className="font-display text-lg font-extrabold">Daily free reward</div>
                <div className="text-sm text-muted">{data.dailyAmount} points every day</div>
              </div>
            </div>
            <button className="btn-primary py-3" disabled={busy || !data.dailyAvailable} onClick={claim}>
              {data.dailyAvailable ? `Claim ${data.dailyAmount} points` : `Next reward ${new Date(data.nextDailyAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
            </button>
          </section>

          <section className="card grid gap-3 p-5">
            <div>
              <div className="font-display text-lg font-extrabold">Refer &amp; earn</div>
              <div className="text-sm text-muted">
                Get {data.referralReward} points when a friend joins with your link. {data.referralsCount} friend{data.referralsCount === 1 ? '' : 's'} joined so far.
              </div>
            </div>
            {referralLink ? (
              <>
                <code className="truncate rounded-lg bg-black/30 px-3 py-2 text-xs text-muted">{referralLink}</code>
                <button className="btn-ghost" onClick={() => openShare(referralLink, 'Play Ludo, Poker, Blackjack and Conquer with me on Akukulu!')}>
                  Share invite
                </button>
              </>
            ) : (
              <p className="text-xs text-muted">Referral links are available once the bot username is configured.</p>
            )}
          </section>
          <p className="text-center text-[11px] text-muted">Points are free virtual credits with no cash value.</p>
        </div>
      )}
      <Toast message={toast?.text ?? null} tone={toast?.tone} onClose={() => setToast(null)} />
    </Page>
  );
}
