'use client';

import { useState } from 'react';
import { TRANSFERS, type TransferPreview, type TransferResult } from '@akukulu/shared';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { Coin } from '@/components/ui';

/**
 * Send money to another player in two steps: look them up and see the fee, then confirm.
 * The name is shown before anything moves, so a mistyped number is caught in time.
 */
export function TransferForm({ available, onSent, onClose }: { available: number; onSent: (result: TransferResult) => void; onClose: () => void }) {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  // One id per confirmation screen, so tapping Send twice cannot send twice.
  const [requestId, setRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = Number(amount);
  const amountError =
    amount === ''
      ? null
      : !Number.isInteger(value) || value < TRANSFERS.min
        ? `The smallest amount is ${TRANSFERS.min} ETB`
        : value > TRANSFERS.max
          ? `The largest amount is ${TRANSFERS.max.toLocaleString()} ETB`
          : value > available
            ? `You can send up to ${available.toLocaleString()} ETB`
            : null;
  const ready = to.trim().length >= 3 && amount !== '' && !amountError;

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setPreview(await api<TransferPreview>('/me/transfer/preview', { body: { to: to.trim(), amount: value } }));
      setRequestId(crypto.randomUUID());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<TransferResult>('/me/transfer', { body: { recipientId: preview.recipientId, amount: preview.amount, requestId } });
      haptic('success');
      onSent(result);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-black/60 p-4 backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
      <div className="card grid w-full max-w-md animate-pop gap-3 p-5">
        <h2 id="transfer-title" className="font-display text-xl font-extrabold">
          {preview ? 'Check and send' : 'Send to a player'}
        </h2>
        {!preview ? (
          <>
            <label className="grid gap-1.5">
              <span className="label">Their phone number or Telegram username</span>
              <input className="input" placeholder="0912345678 or @username" value={to} maxLength={64} autoCapitalize="none" autoCorrect="off" onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="grid gap-1.5">
              <span className="label">Amount in ETB</span>
              <input className="input" inputMode="numeric" placeholder={`${TRANSFERS.min} to ${Math.min(available, TRANSFERS.max).toLocaleString()}`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} />
            </label>
            {amountError && <p className="text-xs text-danger">{amountError}</p>}
            <p className="text-[13px] text-muted">
              The fee is {TRANSFERS.feePercent}% (at least {TRANSFERS.minFee} ETB) and comes out of the amount you send. The player must already have opened Akukulu.
            </p>
          </>
        ) : (
          <div className="grid gap-1.5 text-sm">
            <div className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2.5">
              <span className="text-muted">To</span>
              <span className="min-w-0 truncate pl-3 font-bold">{preview.recipientName}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2.5">
              <span className="text-muted">You send</span>
              <span className="flex items-center gap-1 font-bold">
                <Coin className="h-3.5 w-3.5" /> {preview.amount.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2.5">
              <span className="text-muted">Fee</span>
              <span className="font-bold">{preview.fee.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-lime/40 bg-lime/10 px-3 py-2.5">
              <span className="text-muted">They receive</span>
              <span className="flex items-center gap-1 font-bold text-lime">
                <Coin className="h-3.5 w-3.5" /> {preview.receives.toLocaleString()}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-muted">Check the name. Money sent to the wrong player cannot be taken back.</p>
          </div>
        )}
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            className="btn-ghost"
            disabled={busy}
            onClick={() => {
              if (preview) {
                setPreview(null);
                setError(null);
              } else onClose();
            }}
          >
            {preview ? 'Back' : 'Cancel'}
          </button>
          {preview ? (
            <button className="btn-primary" disabled={busy} onClick={send}>
              {busy ? 'Sending…' : `Send ${preview.amount.toLocaleString()} ETB`}
            </button>
          ) : (
            <button className="btn-primary" disabled={busy || !ready} onClick={check}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
