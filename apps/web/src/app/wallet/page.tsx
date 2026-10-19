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
      <section className="card mb-4 grid place-items-center gap-1 bg-[linear-gradient(135deg,#2a1f63,#191536)] p-6 text-center">
        <div className="text-xs font-bold uppercase tracking-widest text-muted">Balance</div>
        <div className="flex items-center gap-2 font-display text-4xl font-extrabold">
          <Coin className="h-8 w-8" />
          <Points value={user?.balance ?? 0} />
        </div>
        <p className="max-w-xs text-xs text-muted">Virtual points are free in-game credits. They cannot be purchased, transferred or redeemed for money.</p>
      </section>
      <h2 className="mb-2 font-display text-base font-extrabold">Transactions</h2>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : rows === null ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState title="No transactions yet" />
      ) : (
        <div className="card divide-y divide-line">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{r.description}</div>
                <div className="text-xs text-muted">{new Date(r.createdAt).toLocaleString()}</div>
              </div>
              <div className="text-right">
                <div className={`text-sm font-bold ${r.amount > 0 ? 'text-lime' : 'text-danger'}`}>
                  <Points value={r.amount} signed />
                </div>
                <div className="text-[11px] text-muted">bal {r.balanceAfter.toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
