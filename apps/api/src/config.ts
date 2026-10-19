/** Typed, validated environment configuration. */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  dbSynchronize: boolean;
  redisUrl: string | null;
  jwtSecret: string;
  telegramBotToken: string;
  telegramAuthMaxAgeSec: number;
  botUsername: string | null;
  webAppLink: string | null;
  allowDevAuth: boolean;
  adminTelegramIds: string[];
  internalApiKey: string | null;
  corsOrigins: string[];
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const production = nodeEnv === 'production';
  const jwtSecret = env.JWT_SECRET ?? (production ? '' : 'dev-only-insecure-secret');
  if (!jwtSecret || (production && jwtSecret.length < 32)) {
    throw new Error('JWT_SECRET must be set (at least 32 characters in production)');
  }
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN ?? '';
  if (production && !telegramBotToken) throw new Error('TELEGRAM_BOT_TOKEN is required in production');
  const allowDevAuth = !production && bool(env.ALLOW_DEV_AUTH, false);

  return {
    nodeEnv,
    port: Number(env.PORT ?? env.API_PORT ?? 4000),
    databaseUrl: env.DATABASE_URL ?? 'postgres://akukulu:akukulu@localhost:5432/akukulu',
    dbSynchronize: bool(env.DB_SYNCHRONIZE, !production),
    redisUrl: env.REDIS_URL || null,
    jwtSecret,
    telegramBotToken,
    telegramAuthMaxAgeSec: Number(env.TELEGRAM_AUTH_MAX_AGE_SEC ?? 86400),
    botUsername: env.TELEGRAM_BOT_USERNAME || null,
    webAppLink: env.TELEGRAM_WEBAPP_LINK || null,
    allowDevAuth,
    adminTelegramIds: (env.ADMIN_TELEGRAM_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    internalApiKey: env.INTERNAL_API_KEY || null,
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
