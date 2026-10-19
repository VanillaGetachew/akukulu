import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface VerifiedInitData {
  user: TelegramWebAppUser;
  authDate: number;
  startParam: string | null;
  queryId: string | null;
}

export class InitDataError extends Error {}

/**
 * Verifies Telegram Mini App `initData` as documented at
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   secret_key = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   hash       = hex(HMAC_SHA256(key = secret_key, message = data_check_string))
 *
 * where data_check_string is every received field except `hash`, sorted by key,
 * formatted as `key=value` and joined with "\n".
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number,
  nowSec = Math.floor(Date.now() / 1000),
): VerifiedInitData {
  if (!botToken) throw new InitDataError('Telegram bot token is not configured');
  if (typeof initData !== 'string' || initData.length === 0 || initData.length > 8192) {
    throw new InitDataError('initData is missing');
  }
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) throw new InitDataError('initData hash is missing');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  const received = Buffer.from(hash, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new InitDataError('initData signature is invalid');
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) throw new InitDataError('initData auth_date is invalid');
  if (maxAgeSec > 0 && nowSec - authDate > maxAgeSec) throw new InitDataError('initData has expired');

  let user: TelegramWebAppUser;
  try {
    user = JSON.parse(params.get('user') ?? '');
  } catch {
    throw new InitDataError('initData user is invalid');
  }
  if (!user || typeof user.id !== 'number' || typeof user.first_name !== 'string') {
    throw new InitDataError('initData user is invalid');
  }
  return { user, authDate, startParam: params.get('start_param'), queryId: params.get('query_id') };
}

/** Builds signed initData — for tests and local tooling only. */
export function signTelegramInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}
