'use client';

import { useCallback, useEffect, useState } from 'react';
import { PROMOTIONS, type LedgerEntrySummary } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Coin, EmptyState, ErrorState, LoadingState, Page, Points } from '@/components/ui';

export default function WalletPage() {
  const { user, refreshUser } = useSession();
  const [rows, setRows] = useState<LedgerEntrySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [botLink, setBotLink] = useState('https://t.me/Akukulugamebot');
  const load = useCallback(async () => {
    try {
      const [r] = await Promise.all([api<LedgerEntrySummary[]>('/me/transactions?limit=100'), refreshUser()]);
      setRows(r);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [refreshUser]);

  useEffect(() => {
    void load();
    api<{ botUsername: string | null }>('/auth/config')
      .then((c) => c.botUsername && setBotLink(`https://t.me/${c.botUsername}`))
      .catch(() => undefined);
  }, [load]);

  return (
    <Page onRefresh={load}>
      <section className="relative mb-6 overflow-hidden rounded-2xl border border-gold/25 bg-[radial-gradient(110%_90%_at_0%_0%,rgba(230,199,127,.14),transparent_60%),rgb(var(--panel))] p-6">
        <div className="text-[15px] font-semibold text-muted">Your balance</div>
        <div className="mt-2 flex items-center gap-3 font-display text-[44px] font-bold leading-none tracking-[-0.03em] text-gold">
          <Coin className="h-10 w-10" />
          <Points value={user?.balance ?? 0} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <a className="btn-gold btn-sm" href={botLink}>
            ➕ Deposit
          </a>
          <a className="btn-ghost btn-sm" href={botLink}>
            ➖ Withdraw
          </a>
        </div>
        <p className="mt-3 max-w-sm text-[13px] text-muted">Deposits and withdrawals are made with Telebirr in the Akukulu bot.</p>
        {!!user?.bonusLocked && (
          <p className="mt-2 max-w-sm text-[13px] font-semibold text-gold">
            {user.bonusLocked.toLocaleString()} ETB is bonus. It can be withdrawn after wagering {user.bonusWagerLeft.toLocaleString()} ETB more.
          </p>
        )}
        <div className="tibeb absolute inset-x-0 bottom-0 opacity-60" aria-hidden />
      </section>
      <section className="card mb-3 p-4 text-[13px] text-muted">
        <h2 className="mb-1 text-sm font-bold text-fg">🎁 Bonuses</h2>
        <p>First deposit: {PROMOTIONS.firstDepositBonusPercent}% extra, up to {PROMOTIONS.firstDepositBonusMax.toLocaleString()} ETB. Play with it right away; it can be withdrawn after wagering {PROMOTIONS.bonusWagerMultiple} times the bonus.</p>
        <p className="mt-1">Invite a friend: you get {PROMOTIONS.referralReward} ETB when they have played {PROMOTIONS.referralWager} ETB.</p>
        {user?.referralCode && (
          <a className="btn-ghost btn-sm mt-3 inline-flex" href={`https://t.me/share/url?url=${encodeURIComponent(`${botLink}?start=ref_${user.referralCode}`)}&text=${encodeURIComponent('Play Ludo, Poker, Conquer and Crazy with me on Akukulu!')}`}>
            🤝 Invite friends
          </a>
        )}
      </section>
      <section className="card mb-6 p-4 text-[13px] text-muted">
        <h2 className="mb-1 text-sm font-bold text-fg">House fees</h2>
        <p>Ludo, Conquer, Crazy and poker tournaments: 10% of the prize pool for stakes up to 50 ETB, 8% up to 500 ETB and 5% above that.</p>
        <p className="mt-1">Poker cash games: 5% of each pot, up to a limit set by the blinds. Nothing is taken from a hand that ends before the flop.</p>
      </section>
      <h2 className="section-title mb-3">History</h2>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : rows === null ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing here yet" body="Deposits, stakes and winnings will show up here." />
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${r.amount > 0 ? 'bg-lime/10 text-lime' : 'bg-white/[0.05] text-muted'}`} aria-hidden>
                {r.amount > 0 ? '+' : '−'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.description}</div>
                <div className="text-[13px] text-muted">{new Date(r.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
              </div>
              <div className="text-right">
                <div className={`text-sm font-bold ${r.amount > 0 ? 'text-lime' : 'text-fg'}`}>
                  <Points value={r.amount} signed />
                </div>
                <div className="text-[12px] tabular-nums text-muted">{r.balanceAfter.toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
