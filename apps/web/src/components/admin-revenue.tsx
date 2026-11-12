'use client';

import { useEffect, useState } from 'react';
import type { AdminRevenue as Revenue } from '@akukulu/shared';
import { api } from '@/lib/api';
import { LoadingState } from '@/components/ui';

const etb = (n: number) => `${n.toLocaleString()} ETB`;

const GAME_NAMES: Record<string, string> = { ludo: 'Ludo', poker: 'Poker', conquer: 'Conquer', crazy: 'Crazy', penalty: 'Penalty Shootout', rps: 'Rock Paper Scissors', bingo: 'Bingo', transfer: 'Transfers between players', blackjack: 'Blackjack' };

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${muted ? 'text-muted' : ''}`}>
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 font-bold tabular-nums">{value}</span>
    </div>
  );
}

/** Everything the house has earned from cuts, what promotions cost, and the money moved. */
export function AdminRevenue() {
  const [data, setData] = useState<Revenue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api<Revenue>('/admin/revenue')
        .then((r) => {
          setData(r);
          setError(null);
        })
        .catch((err) => setError((err as Error).message));
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="card border-gold/30 p-4">
      <h2 className="mb-3 font-display text-base font-extrabold">Revenue from house cuts</h2>
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : !data ? (
        <LoadingState />
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ['Today', data.today],
                ['Last 7 days', data.last7Days],
                ['Last 30 days', data.last30Days],
                ['All time', data.total],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-xl bg-black/20 p-3">
                <div className="text-[11px] font-bold text-muted">{label}</div>
                <div className="font-display text-lg font-extrabold text-gold">{etb(value)}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="label mb-1">By game</h3>
              <div className="divide-y divide-line rounded-xl bg-black/20">
                {data.byGame.length === 0 ? <Row label="Nothing yet" value="0 ETB" muted /> : data.byGame.map((g) => <Row key={g.gameSlug} label={GAME_NAMES[g.gameSlug] ?? g.gameSlug} value={etb(g.total)} />)}
              </div>
            </div>
            <div>
              <h3 className="label mb-1">By type</h3>
              <div className="divide-y divide-line rounded-xl bg-black/20">
                {data.bySource.length === 0 ? <Row label="Nothing yet" value="0 ETB" muted /> : data.bySource.map((s) => <Row key={s.source} label={s.source} value={etb(s.total)} />)}
              </div>
            </div>
            <div>
              <h3 className="label mb-1">After promotions</h3>
              <div className="divide-y divide-line rounded-xl bg-black/20">
                <Row label="House cuts" value={etb(data.total)} />
                <Row label="First deposit bonuses paid (ended)" value={data.bonusesPaid ? `−${etb(data.bonusesPaid)}` : etb(0)} muted />
                <Row label="Referral rewards paid" value={data.referralsPaid ? `−${etb(data.referralsPaid)}` : etb(0)} muted />
                <Row label="Net" value={etb(data.net)} />
              </div>
            </div>
            <div>
              <h3 className="label mb-1">Telebirr money moved</h3>
              <div className="divide-y divide-line rounded-xl bg-black/20">
                <Row label="Deposits approved" value={etb(data.deposits)} />
                <Row label="Withdrawals sent" value={etb(data.withdrawals)} />
                <Row label="Player balances held" value={etb(data.playerBalances)} />
              </div>
            </div>
          </div>

          <div>
            <h3 className="label mb-1">Last 14 days (Ethiopian time)</h3>
            <div className="divide-y divide-line rounded-xl bg-black/20">
              {data.daily.length === 0 ? <Row label="Nothing yet" value="0 ETB" muted /> : data.daily.map((d) => <Row key={d.day} label={d.day} value={etb(d.total)} />)}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
