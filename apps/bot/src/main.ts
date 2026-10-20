import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Markup, Telegraf, type Context } from 'telegraf';
import { ECONOMY, GAME_CATALOG, type LedgerEntrySummary, type UserProfile } from '@akukulu/shared';

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
};

if (!env.token) throw new Error('TELEGRAM_BOT_TOKEN is required');
if (!env.webAppUrl.startsWith('https://')) throw new Error('WEBAPP_URL must be an https:// URL (Telegram requirement)');
if (!env.internalKey) throw new Error('INTERNAL_API_KEY is required');

interface Summary {
  profile: UserProfile;
  rewards: { dailyAvailable: boolean; dailyPending: boolean; dailyAmount: number; referralsCount: number; referralReward: number };
  transactions: LedgerEntrySummary[];
}

async function internal<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${env.api}/internal${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-key': env.internalKey },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as T;
}

function register(ctx: Context, startParam: string | null): Promise<Summary> {
  const from = ctx.from!;
  return internal<Summary>('/users', { from, startParam });
}

const points = (n: number) => `${n.toLocaleString('en-US')} pts`;

const mainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.webApp('🎮 Play Games', env.webAppUrl)],
    [Markup.button.callback('👤 My Profile', 'profile'), Markup.button.callback('💰 Balance', 'balance')],
    [Markup.button.callback('🧾 Transactions', 'transactions'), Markup.button.callback('🎁 Rewards', 'rewards')],
    [Markup.button.callback('🤝 Refer & Earn', 'refer')],
    [
      ...(env.community ? [Markup.button.url('💬 Community', env.community)] : []),
      ...(env.support ? [Markup.button.url('🆘 Support', env.support)] : []),
    ],
  ]);

const back = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Menu', 'menu')]]);

const bot = new Telegraf(env.token);

bot.start(async (ctx) => {
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
      'Points are free virtual credits — they cannot be bought, transferred or exchanged for money.',
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
  await ctx.editMessageText(`💰 Balance: ${points(profile.balance)}\n\nVirtual points only — no cash value.`, back);
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
    `🤝 Invite friends and get ${ECONOMY.referralReward} pts when they join.\nFriends joined: ${rewards.referralsCount}\n\nYour link:\n${link}`,
    Markup.inlineKeyboard([
      [Markup.button.url('📤 Share', `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Play Ludo, Poker, Blackjack, Conquer and Crazy with me on Akukulu!')}`)],
      [Markup.button.callback('⬅️ Menu', 'menu')],
    ]),
  );
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
