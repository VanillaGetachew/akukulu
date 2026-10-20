import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../app.module';
import { loadConfig } from '../config';
import { signTelegramInitData } from '../auth/telegram-init-data';

export const BOT_TOKEN = '999999:integration-test-token';
/** The Telegram id configured as administrator in tests. */
export const ADMIN_TELEGRAM_ID = '424242';

export interface TestApp {
  app: INestApplication;
  url: string;
  close(): Promise<void>;
}

export async function startApp(databaseUrl: string, opts: { dropSchema: boolean }): Promise<TestApp> {
  process.env.DISABLE_MATCH_SWEEP = 'true';
  // Tests drive matches far faster than a human; the production limit is 10/s.
  process.env.ACTION_RATE_LIMIT_PER_SEC = '1000';
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    DB_SYNCHRONIZE: 'true',
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    JWT_SECRET: 'integration-test-secret-integration-test-secret',
    INTERNAL_API_KEY: 'internal-test-key',
    ALLOW_DEV_AUTH: 'true',
    TELEGRAM_BOT_USERNAME: 'akukulu_test_bot',
    ADMIN_TELEGRAM_IDS: ADMIN_TELEGRAM_ID,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ config, redis: null, dataSource: { dropSchema: opts.dropSchema, logging: false } })],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}`, close: () => app.close() };
}

export function client(base: string) {
  return async function api<T = any>(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : (undefined as T) };
  };
}

export function initDataFor(id: number, firstName: string, extra: Record<string, string> = {}): string {
  return signTelegramInitData(
    { user: JSON.stringify({ id, first_name: firstName, username: firstName.toLowerCase() }), auth_date: String(Math.floor(Date.now() / 1000)), ...extra },
    BOT_TOKEN,
  );
}

export function connect(base: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(base, { auth: { token }, transports: ['websocket'], forceNew: true });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

export function emitAck<T = any>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, (res: T) => resolve(res)));
}
