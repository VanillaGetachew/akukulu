/** The Telebirr account currently taking deposits and sending withdrawals. One at a time. */
export interface PaymentAccountSummary {
  id: string;
  /** The admin who set this number; they get the notifications. */
  telegramId: string;
  name: string;
  phone: string;
}

export interface PaymentRequestSummary {
  id: string;
  kind: 'deposit' | 'withdrawal';
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  reference: string | null;
  /** Withdrawals: where to send the money. */
  phone: string | null;
  telegramId: string;
  displayName: string;
  username: string | null;
  balance: number;
  account: PaymentAccountSummary | null;
  /** First-deposit bonus added when this deposit was approved. */
  bonus?: number;
  createdAt: string;
}

export const birr = (n: number) => `${n.toLocaleString('en-US')} ETB`;

/** Shows +2519XXXXXXXX the way people type it in Telebirr. */
export const localPhone = (phone: string) => phone.replace(/^\+251/, '0');

/** What the person checking a request sees. */
export function paymentRequestText(r: PaymentRequestSummary): string {
  const who = `${r.displayName}${r.username ? ` (@${r.username})` : ''} · ID ${r.telegramId}`;
  return r.kind === 'deposit'
    ? [
        '📥 Deposit request',
        `Player: ${who}`,
        `Amount: ${birr(r.amount)}`,
        `Telebirr transaction ID: ${r.reference}`,
        `Sent to: ${r.account ? localPhone(r.account.phone) : 'unknown'}`,
        '',
        'Check that this money reached Telebirr before approving.',
      ].join('\n')
    : [
        '📤 Withdrawal request',
        `Player: ${who}`,
        `Amount: ${birr(r.amount)}`,
        `Send to: ${r.phone ? localPhone(r.phone) : 'unknown'}`,
        '',
        'Send the money with Telebirr first, then approve. Rejecting returns it to the player.',
      ].join('\n');
}

export const paymentButtons = (r: PaymentRequestSummary) => ({
  approve: { text: r.kind === 'deposit' ? '✅ Received, credit it' : '✅ Sent, mark paid', callback_data: `pay_ok:${r.id}` },
  reject: { text: '❌ Reject', callback_data: `pay_no:${r.id}` },
});

/** What the player is told once a request is decided. */
export function paymentDecisionText(r: PaymentRequestSummary): string {
  const approved = r.status === 'approved';
  if (r.kind === 'deposit') {
    return approved
      ? `✅ Your deposit of ${birr(r.amount)} was confirmed.${r.bonus ? ` 🎁 First deposit bonus: +${birr(r.bonus)}.` : ''} Balance: ${birr(r.balance)}`
      : `❌ Your deposit of ${birr(r.amount)} (ID ${r.reference}) could not be confirmed. Contact support if you did send it.`;
  }
  return approved
    ? `✅ Your withdrawal of ${birr(r.amount)} was sent to ${r.phone ? localPhone(r.phone) : 'your number'}.`
    : `❌ Your withdrawal of ${birr(r.amount)} was rejected and returned to your balance. Balance: ${birr(r.balance)}`;
}
