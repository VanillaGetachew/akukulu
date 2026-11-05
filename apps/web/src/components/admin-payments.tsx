'use client';

import { useCallback, useEffect, useState } from 'react';
import { birr, localPhone, type PaymentAccountSummary, type PaymentRequestSummary } from '@akukulu/shared';
import { api } from '@/lib/api';

/** The deposit number (one at a time, editable) and every request still waiting. */
export function AdminPayments({ onToast }: { onToast: (message: string) => void }) {
  const [account, setAccount] = useState<PaymentAccountSummary | null>(null);
  const [pending, setPending] = useState<PaymentRequestSummary[]>([]);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    const [a, p] = await Promise.all([api<{ account: PaymentAccountSummary | null }>('/admin/payments/account'), api<PaymentRequestSummary[]>('/admin/payments')]);
    setAccount(a.account);
    setPending(p);
  }, []);

  useEffect(() => {
    load().catch((err) => onToast((err as Error).message));
  }, [load, onToast]);

  async function run(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      onToast(done);
      await load();
    } catch (err) {
      onToast((err as Error).message);
    }
  }

  return (
    <section className="card border-gold/30 p-4">
      <h2 className="mb-1 font-display text-base font-extrabold">Telebirr deposits and withdrawals</h2>
      <p className="mb-3 text-sm text-muted">
        {account ? (
          <>
            Players are sending to <b className="text-fg">{localPhone(account.phone)}</b> ({account.name}).
          </>
        ) : (
          'No number set, so deposits and withdrawals are unavailable.'
        )}
      </p>
      <form
        className="mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api('/admin/payments/account', { body: { phone, name } }), 'Number updated. New requests come to you.').then(() => {
            setPhone('');
            setName('');
          });
        }}
      >
        <input className="input" placeholder="New number, e.g. 0912345678" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        <input className="input" placeholder="Name on Telebirr" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
        <button className="btn-primary">Change number</button>
      </form>
      <p className="mb-3 text-xs text-muted">Whoever changes the number gets the requests from then on.</p>
      {pending.length === 0 ? (
        <p className="text-sm text-muted">Nothing is waiting.</p>
      ) : (
        <div className="grid gap-2">
          {pending.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-bold">
                  {r.kind === 'deposit' ? '📥' : '📤'} {r.displayName} <span className="text-gold">{birr(r.amount)}</span>
                </div>
                <div className="truncate text-xs text-muted">
                  {r.kind === 'deposit' ? `ID ${r.reference} · to ${r.account ? localPhone(r.account.phone) : 'unknown'}` : `Send to ${r.phone ? localPhone(r.phone) : 'unknown'}`} · {new Date(r.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => void run(() => api(`/admin/payments/${r.id}/approve`, { body: {} }), 'Approved')}>
                  {r.kind === 'deposit' ? 'Received' : 'Sent'}
                </button>
                <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => void run(() => api(`/admin/payments/${r.id}/reject`, { body: {} }), 'Rejected')}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
