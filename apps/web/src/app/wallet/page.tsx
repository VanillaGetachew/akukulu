'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LedgerEntrySummary } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Coin, EmptyState, ErrorState, LoadingState, Page, Points } from '@/components/ui';

export default function WalletPage() {
  const { user, refreshUser } = useSession();
  const [rows, setRows] = useState<LedgerEntrySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [load]);

  return (
    <Page onRefresh={load}>
      <section className="relative mb-6 overflow-hidden rounded-2xl border border-gold/25 bg-[radial-gradient(110%_90%_at_0%_0%,rgba(230,199,127,.14),transparent_60%),rgb(var(--panel))] p-6">
        <div className="text-[15px] font-semibold text-muted">Your balance</div>
        <div className="mt-2 flex items-center gap-3 font-display text-[44px] font-bold leading-none tracking-[-0.03em] text-gold">
          <Coin className="h-10 w-10" />
          <Points value={user?.balance ?? 0} />
        </div>
        <p className="mt-3 max-w-sm text-[13px] text-muted">Points are free in-game credits. They can&apos;t be bought, transferred or redeemed for money.</p>
        <div className="tibeb absolute inset-x-0 bottom-0 opacity-60" aria-hidden />
      </section>
      <h2 className="section-title mb-3">Point history</h2>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : rows === null ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing here yet" body="Rewards, stakes and winnings will show up here." />
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
