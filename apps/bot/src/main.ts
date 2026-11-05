import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Markup, Telegraf, type Context } from 'telegraf';
import type { InlineKeyboardButton } from 'telegraf/types';
import {
  ECONOMY,
  GAME_CATALOG,
  PAYMENTS,
  PROMOTIONS,
  birr,
  localPhone,
  paymentButtons,
  paymentRequestText,
  type LedgerEntrySummary,
  type PaymentAccountSummary,
  type PaymentRequestSummary,
  type UserProfile,
} from '@akukulu/shared';

for (const file of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

const env = {
  token: process.env.TELEGRAM_BOT_TOKEN ?? '',
  webAppUrl: (process.env.WEBAPP_URL ?? '').replace(/\/$/, ''),
  api: (process.env.API_INTERNAL_URL ?? 'http://localhost:4000/api').replace(/\/$/, ''),
  internalKey: process.env.INTERNAL_API_KEY ?? '',
  community: process.env.COMMUNITY_URL ?? '',
  support: process.env.SUPPORT_URL ?? '',
  username: process.env.TELEGRAM_BOT_USERNAME ?? '',
  paymentsEnabled: ['1', 'true', 'yes', 'on'].includes((process.env.PAYMENTS_ENABLED ?? '').toLowerCase()),
  adminIds: (process.env.ADMIN_TELEGRAM_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
};

if (!env.token) throw new Error('TELEGRAM_BOT_TOKEN is required');
if (!env.webAppUrl.startsWith('https://')) throw new Error('WEBAPP_URL must be an https:// URL (Telegram requirement)');
if (!env.internalKey) throw new Error('INTERNAL_API_KEY is required');
if (env.paymentsEnabled && !env.adminIds.length) throw new Error('ADMIN_TELEGRAM_IDS is required when PAYMENTS_ENABLED is on');

interface Summary {
  profile: UserProfile;
  rewards: { dailyAvailable: boolean; dailyPending: boolean; dailyAmount: number; referralsCount: number; referralReward: number };
  transactions: LedgerEntrySummary[];
  firstDepositBonus: boolean;
}

/** A refusal from the API, with a message that is safe to show the player. */
class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function internal<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${env.api}/internal${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-key': env.internalKey },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { code?: string; message?: unknown };
    throw new ApiError(err.code ?? 'API_ERROR', typeof err.message === 'string' ? err.message : `API ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

function register(ctx: Context, startParam: string | null): Promise<Summary> {
  const from = ctx.from!;
  return internal<Summary>('/users', { from, startParam });
}

const points = (n: number) => `${n.toLocaleString('en-US')} ${env.paymentsEnabled ? 'ETB' : 'pts'}`;

const mainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.webApp('🎮 Play Games', env.webAppUrl)],
    [Markup.button.callback('👤 My Profile', 'profile'), Markup.button.callback('💰 Balance', 'balance')],
    ...(env.paymentsEnabled
      ? [
          [Markup.button.callback('➕ Deposit', 'deposit'), Markup.button.callback('➖ Withdraw', 'withdraw')],
          [Markup.button.callback('🧾 Transactions', 'transactions'), Markup.button.callback('🤝 Invite & Earn', 'refer')],
        ]
      : [
          [Markup.button.callback('🧾 Transactions', 'transactions'), Markup.button.callback('🎁 Rewards', 'rewards')],
          [Markup.button.callback('🤝 Refer & Earn', 'refer')],
        ]),
    [
      ...(env.community ? [Markup.button.url('💬 Community', env.community)] : []),
      ...(env.support ? [Markup.button.url('🆘 Support', env.support)] : []),
    ],
  ]);

const back = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Menu', 'menu')]]);

const bot = new Telegraf(env.token);

/** Where each person is in a deposit, withdrawal or number change. Lost on restart; they just start again. */
type PaymentStep =
  | { step: 'deposit_amount' }
  | { step: 'deposit_reference'; amount: number; accountId: string }
  | { step: 'set_account' }
  | { step: 'withdraw_amount' }
  | { step: 'withdraw_phone'; amount: number };
const paymentSteps = new Map<number, PaymentStep>();

const cancel = Markup.inlineKeyboard([[Markup.button.callback('✖️ Cancel', 'pay_cancel')]]);

bot.start(async (ctx) => {
  paymentSteps.delete(ctx.from.id);
  const payload = ctx.payload?.trim() || null;
  const summary = await register(ctx, payload);
  const room = payload && /^room_([A-Z0-9]{4,8})$/i.exec(payload);
  if (room) {
    await ctx.reply(`You're invited to table ${room[1].toUpperCase()}!`, Markup.inlineKeyboard([[Markup.button.webApp('🎲 Open table', `${env.webAppUrl}/room/${room[1].toUpperCase()}`)]]));
  }
  await ctx.reply(
    [
      `Selam, ${summary.profile.firstName}! Welcome to አኩኩሉ | Akukulu.`,
      '',
      `Play ${GAME_CATALOG.map((g) => g.name).join(', ')} with friends.`,
      `Balance: ${points(summary.profile.balance)}`,
      '',
      env.paymentsEnabled ? 'Use Deposit and Withdraw to move birr with Telebirr.' : 'Points are free virtual credits — they cannot be bought, transferred or exchanged for money.',
    ].join('\n'),
    mainMenu(),
  );
});

bot.action('menu', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('What would you like to do?', mainMenu()).catch(() => ctx.reply('What would you like to do?', mainMenu()));
});

bot.action('profile', async (ctx) => {
  await ctx.answerCbQuery();
  const { profile } = await register(ctx, null);
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  await ctx.editMessageText(
    `👤 ${name}${profile.username ? ` (@${profile.username})` : ''}\nBalance: ${points(profile.balance)}\nMember since ${profile.createdAt.slice(0, 10)}\n\nOpen the app for stats and match history.`,
    back,
  );
});

bot.action('balance', async (ctx) => {
  await ctx.answerCbQuery();
  const { profile } = await register(ctx, null);
  await ctx.editMessageText(env.paymentsEnabled ? `💰 Balance: ${birr(profile.balance)}` : `💰 Balance: ${points(profile.balance)}\n\nVirtual points only — no cash value.`, back);
});

bot.action('transactions', async (ctx) => {
  await ctx.answerCbQuery();
  const { transactions } = await register(ctx, null);
  const lines = transactions.length
    ? transactions.map((t) => `${t.amount > 0 ? '+' : ''}${t.amount}  ${t.description}  (${t.createdAt.slice(0, 10)})`)
    : ['No transactions yet.'];
  await ctx.editMessageText(`🧾 Recent transactions\n\n${lines.join('\n')}`, back);
});

bot.action('rewards', async (ctx) => {
  await ctx.answerCbQuery();
  const { rewards } = await register(ctx, null);
  const buttons = rewards.dailyAvailable
    ? [[Markup.button.callback(`🎁 Claim ${rewards.dailyAmount} pts`, 'claim_daily')], [Markup.button.callback('⬅️ Menu', 'menu')]]
    : [[Markup.button.callback('⬅️ Menu', 'menu')]];
  await ctx.editMessageText(
    rewards.dailyAvailable
      ? `🎁 Your daily reward of ${rewards.dailyAmount} pts is ready to request!`
      : rewards.dailyPending
        ? '🕓 Your daily reward is waiting for admin approval.'
        : '🎁 Daily reward already claimed. Come back tomorrow (UTC).',
    Markup.inlineKeyboard(buttons),
  );
});

bot.action('claim_daily', async (ctx) => {
  const result = await internal<{ claimed: boolean; pending: boolean; balance: number; amount: number }>(`/users/${ctx.from!.id}/daily`, {});
  if (result.claimed && result.pending) {
    await ctx.answerCbQuery('Requested — waiting for admin approval');
    await ctx.editMessageText(`🕓 Your ${result.amount} pts daily reward was requested. It is added once an admin approves it.`, back);
    return;
  }
  await ctx.answerCbQuery(result.claimed ? `+${result.amount} pts!` : 'Already claimed today');
  await ctx.editMessageText(result.claimed ? `✅ +${result.amount} pts. Balance: ${points(result.balance)}` : 'Already claimed today.', back);
});

bot.action('refer', async (ctx) => {
  await ctx.answerCbQuery();
  const { profile, rewards } = await register(ctx, null);
  const link = `https://t.me/${env.username || ctx.botInfo.username}?start=ref_${profile.referralCode}`;
  await ctx.editMessageText(
    env.paymentsEnabled
      ? `🤝 Invite friends and get ${birr(PROMOTIONS.referralReward)} when a friend has played ${birr(PROMOTIONS.referralWager)}.\nFriends joined: ${rewards.referralsCount}\n\nYour link:\n${link}`
      : `🤝 Invite friends and get ${ECONOMY.referralReward} pts when they join.\nFriends joined: ${rewards.referralsCount}\n\nYour link:\n${link}`,
    Markup.inlineKeyboard([
      [Markup.button.url('📤 Share', `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Play Ludo, Poker, Blackjack, Conquer and Crazy with me on Akukulu!')}`)],
      [Markup.button.callback('⬅️ Menu', 'menu')],
    ]),
  );
});

/* ---- Manual Telebirr deposits and withdrawals ---- */

const isAdmin = (id: number) => env.adminIds.includes(String(id));

const requestButtons = (r: PaymentRequestSummary) => {
  const { approve, reject } = paymentButtons(r);
  return Markup.inlineKeyboard([[Markup.button.callback(approve.text, approve.callback_data), Markup.button.callback(reject.text, reject.callback_data)]]);
};

/** Telegram's copy button; the installed Telegraf types predate it. */
const copyButton = (text: string, copy: string) => ({ text, copy_text: { text: copy } }) as unknown as InlineKeyboardButton;

/** Returns the API's refusal if it is one the person can act on; anything else goes to bot.catch. */
function refusal(err: unknown): ApiError {
  if (err instanceof ApiError && err.status < 500) return err;
  throw err;
}

bot.action('deposit', async (ctx) => {
  await ctx.answerCbQuery();
  paymentSteps.set(ctx.from.id, { step: 'deposit_amount' });
  const { firstDepositBonus } = await register(ctx, null);
  const lines = [`➕ Deposit with Telebirr\n\nHow much do you want to deposit? Type any whole amount from ${birr(PAYMENTS.minDeposit)} to ${birr(PAYMENTS.maxDeposit)}.`];
  if (firstDepositBonus) {
    lines.push(`🎁 First deposit bonus: ${PROMOTIONS.firstDepositBonusPercent}% extra, up to ${birr(PROMOTIONS.firstDepositBonusMax)}. Play with it right away; it can be withdrawn after wagering ${PROMOTIONS.bonusWagerMultiple} times the bonus.`);
  }
  const buttons = [[Markup.button.callback('✖️ Cancel', 'pay_cancel')]];
  if (isAdmin(ctx.from.id)) {
    const { account } = await internal<{ account: PaymentAccountSummary | null }>('/payments/account');
    lines.push(account ? `Admin: players are sending to ${localPhone(account.phone)} (${account.name}).` : 'Admin: no number is set, so players cannot deposit yet.');
    buttons.unshift([Markup.button.callback('✏️ Change number', 'pay_set_account')]);
  }
  await ctx.editMessageText(lines.join('\n\n'), Markup.inlineKeyboard(buttons));
});

bot.action('pay_set_account', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery('Administrators only', { show_alert: true });
    return;
  }
  await ctx.answerCbQuery();
  paymentSteps.set(ctx.from.id, { step: 'set_account' });
  await ctx.editMessageText('✏️ Reply with the new number and the name on the Telebirr account, like this:\n\n0912345678 Abebe Kebede\n\nYou will get the requests from then on.', cancel);
});

bot.action('withdraw', async (ctx) => {
  await ctx.answerCbQuery();
  const { profile } = await register(ctx, null);
  paymentSteps.set(ctx.from.id, { step: 'withdraw_amount' });
  await ctx.editMessageText(
    `➖ Withdraw with Telebirr\n\nBalance: ${birr(profile.balance)}${profile.bonusLocked ? `\nYou can withdraw: ${birr(Math.max(0, profile.balance - profile.bonusLocked))} (bonus unlocks after wagering ${birr(profile.bonusWagerLeft)} more)` : ''}\nHow much do you want to withdraw? Type any whole amount from ${birr(PAYMENTS.minWithdrawal)} to ${birr(PAYMENTS.maxWithdrawal)}.`,
    cancel,
  );
});

bot.action('pay_cancel', async (ctx) => {
  await ctx.answerCbQuery();
  paymentSteps.delete(ctx.from.id);
  await ctx.editMessageText('Cancelled.', back);
});

bot.action(/^pay_(ok|no):([0-9a-f-]{36})$/, async (ctx) => {
  const approve = ctx.match[1] === 'ok';
  let r: PaymentRequestSummary;
  try {
    r = await internal<PaymentRequestSummary>(`/payments/${ctx.match[2]}/${approve ? 'approve' : 'reject'}`, { adminTelegramId: String(ctx.from.id) });
  } catch (err) {
    const refused = refusal(err);
    await ctx.answerCbQuery(refused.message, { show_alert: true });
    if (refused.code === 'ALREADY_DECIDED') await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
    return;
  }
  await ctx.answerCbQuery(approve ? 'Approved' : 'Rejected');
  await ctx.editMessageText(`${paymentRequestText(r).split('\n\n')[0]}\n\n${approve ? '✅ Approved' : '❌ Rejected'} by ${ctx.from.first_name}`);
});

/** Shows anything still waiting, in case a message was missed. */
bot.command('pending', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const pending = await internal<PaymentRequestSummary[]>(`/payments/pending/${ctx.from.id}`);
  if (!pending.length) {
    await ctx.reply('Nothing is waiting.');
    return;
  }
  for (const r of pending) await ctx.reply(paymentRequestText(r), requestButtons(r));
});

bot.on('text', async (ctx, next) => {
  const state = paymentSteps.get(ctx.from.id);
  if (!state || ctx.chat.type !== 'private' || ctx.message.text.startsWith('/')) return next();
  const text = ctx.message.text.trim();

  if (state.step === 'set_account') {
    const [phone, ...name] = text.split(/\s+/);
    try {
      const account = await internal<PaymentAccountSummary>('/payments/account', { adminTelegramId: String(ctx.from.id), phone, name: name.join(' ') || ' ' });
      paymentSteps.delete(ctx.from.id);
      await ctx.reply(`✅ Players now send to ${localPhone(account.phone)} (${account.name}). New requests come to you.`, back);
    } catch (err) {
      await ctx.reply(`⚠️ ${refusal(err).message}`, cancel);
    }
    return;
  }

  if (state.step === 'deposit_amount' || state.step === 'withdraw_amount') {
    const amount = Number(text.replace(/,/g, ''));
    const [min, max] = state.step === 'deposit_amount' ? [PAYMENTS.minDeposit, PAYMENTS.maxDeposit] : [PAYMENTS.minWithdrawal, PAYMENTS.maxWithdrawal];
    if (!Number.isInteger(amount) || amount < min || amount > max) {
      await ctx.reply(`Please type a whole amount between ${birr(min)} and ${birr(max)}.`, cancel);
      return;
    }
    if (state.step === 'withdraw_amount') {
      paymentSteps.set(ctx.from.id, { step: 'withdraw_phone', amount });
      await ctx.reply('Which Telebirr number should we send it to? For example 0912345678.', cancel);
      return;
    }
    await register(ctx, null);
    let account: PaymentAccountSummary;
    try {
      account = await internal<PaymentAccountSummary>(`/users/${ctx.from.id}/payments/deposit/start`, { amount });
    } catch (err) {
      paymentSteps.delete(ctx.from.id);
      await ctx.reply(`⚠️ ${refusal(err).message}`, back);
      return;
    }
    const phone = localPhone(account.phone);
    paymentSteps.set(ctx.from.id, { step: 'deposit_reference', amount, accountId: account.id });
    await ctx.reply(
      [
        `Send exactly ${birr(amount)} with Telebirr to:`,
        '',
        `📱 ${phone}`,
        `👤 ${account.name}`,
        '',
        '⚠️ This number can change, so use the one shown here each time.',
        '',
        'Then reply with the transaction ID from your Telebirr SMS.',
      ].join('\n'),
      Markup.inlineKeyboard([[copyButton(`📋 Copy ${phone}`, phone)], [Markup.button.callback('✖️ Cancel', 'pay_cancel')]]),
    );
    return;
  }

  try {
    const request =
      state.step === 'deposit_reference'
        ? await internal<PaymentRequestSummary>(`/users/${ctx.from.id}/payments/deposit`, { amount: state.amount, reference: text, accountId: state.accountId })
        : await internal<PaymentRequestSummary>(`/users/${ctx.from.id}/payments/withdraw`, { amount: state.amount, phone: text });
    paymentSteps.delete(ctx.from.id);
    await ctx.reply(
      request.kind === 'deposit'
        ? `🕓 Deposit of ${birr(request.amount)} submitted. We'll message you once it's confirmed.`
        : `🕓 Withdrawal of ${birr(request.amount)} to ${request.phone ? localPhone(request.phone) : ''} submitted. It has been taken from your balance while we send it. Balance: ${birr(request.balance)}`,
      back,
    );
  } catch (err) {
    const refused = refusal(err);
    // A mistyped ID or number can be retried; anything else ends this attempt.
    const retry = refused.code === 'BAD_REFERENCE' || refused.code === 'BAD_PHONE';
    if (!retry) paymentSteps.delete(ctx.from.id);
    await ctx.reply(`⚠️ ${refused.message}`, retry ? cancel : back);
  }
});

bot.catch(async (err, ctx) => {
  console.error('Bot error', err);
  await ctx.reply('Sorry, something went wrong. Please try again in a moment.').catch(() => undefined);
});

async function main() {
  await bot.telegram.setMyCommands([{ command: 'start', description: 'Open the main menu' }]);
  await bot.telegram.setChatMenuButton({ menuButton: { type: 'web_app', text: 'Play', web_app: { url: env.webAppUrl } } });
  await bot.launch(() => console.log(`Bot @${bot.botInfo?.username} running`));
}

void main();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
