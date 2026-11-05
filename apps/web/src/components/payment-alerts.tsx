'use client';

import { useEffect, useState } from 'react';
import { birr, localPhone, type PaymentRequestSummary } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Pops up over any screen when a player deposits to, or withdraws through, this admin's number. */
export function PaymentAlerts() {
  const { user, socket } = useSession();
  const [queue, setQueue] = useState<PaymentRequestSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = !!user?.isAdmin;

  useEffect(() => {
    if (!isAdmin) return;
    api<PaymentRequestSummary[]>('/admin/payments?mine=1')
      .then(setQueue)
      .catch(() => undefined);
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !socket) return;
    const onRequest = (r: PaymentRequestSummary) => setQueue((q) => (q.some((x) => x.id === r.id) ? q : [...q, r]));
    socket.on('payment:request', onRequest);
    return () => {
      socket.off('payment:request', onRequest);
    };
  }, [isAdmin, socket]);

  const current = queue[0];
  if (!current) return null;

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/payments/${current.id}/${decision}`, { body: {} });
      setQueue((q) => q.slice(1));
    } catch (err) {
      const message = (err as Error).message;
      // Already handled from Telegram or by another admin: nothing left to do here.
      if (/already/i.test(message)) setQueue((q) => q.slice(1));
      else setError(message);
    } finally {
      setBusy(false);
    }
  }

  const deposit = current.kind === 'deposit';
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 px-4" role="dialog" aria-modal="true" aria-labelledby="payment-alert-title">
      <div className="card grid w-full max-w-sm gap-3 border-gold/40 p-5">
        <h2 id="payment-alert-title" className="font-display text-lg font-extrabold">
          {deposit ? '📥 Deposit request' : '📤 Withdrawal request'}
        </h2>
        <div className="font-display text-3xl font-bold text-gold">{birr(current.amount)}</div>
        <div className="grid gap-1 text-sm">
          <div>
            {current.displayName}
            {current.username ? ` (@${current.username})` : ''}
          </div>
          {deposit ? (
            <>
              <div className="text-muted">
                Transaction ID: <span className="select-all font-bold text-fg">{current.reference}</span>
              </div>
              <div className="text-muted">Sent to: {current.account ? localPhone(current.account.phone) : 'unknown'}</div>
            </>
          ) : (
            <div className="text-muted">
              Send to: <span className="select-all font-bold text-fg">{current.phone ? localPhone(current.phone) : 'unknown'}</span>
            </div>
          )}
        </div>
        <p className="text-[13px] text-muted">
          {deposit ? 'Check that this money reached Telebirr before approving.' : 'Send the money with Telebirr first, then approve. Rejecting returns it to the player.'}
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost" disabled={busy} onClick={() => void decide('reject')}>
            Reject
          </button>
          <button className="btn-primary" disabled={busy} onClick={() => void decide('approve')}>
            {deposit ? 'Received' : 'Sent'}
          </button>
        </div>
        {queue.length > 1 && <p className="text-center text-xs text-muted">{queue.length - 1} more waiting</p>}
      </div>
    </div>
  );
}
