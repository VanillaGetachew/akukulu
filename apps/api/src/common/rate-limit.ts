import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config';
import { GameError } from './util';

export interface RateRule {
  /** Requests allowed in the window. */
  limit: number;
  windowSec: number;
}

const RATE_RULES = 'akukulu:rate-rules';

/** Extra, tighter limits for one route, on top of the limit every request gets. */
export const RateLimit = (...rules: RateRule[]) => SetMetadata(RATE_RULES, rules);

/** Signed-in players are counted one by one; many share an address on mobile networks. */
const SIGNED_IN: RateRule = { limit: 300, windowSec: 60 };
/** Everyone not signed in yet is counted by address. */
const ANONYMOUS: RateRule = { limit: 120, windowSec: 60 };

/** Counts requests per caller in fixed windows, in memory. */
@Injectable()
export class RateLimiter {
  /** Off in automated tests, which send hundreds of requests from one address. */
  enabled: boolean;
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private calls = 0;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.enabled = config.nodeEnv !== 'test';
  }

  /** Counts one request. Returns the seconds to wait when the limit is used up, or null. */
  take(key: string, rule: RateRule, now = Date.now()): number | null {
    if (++this.calls % 2000 === 0) {
      for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    }
    const id = `${key}|${rule.limit}/${rule.windowSec}`;
    let w = this.windows.get(id);
    if (!w || w.resetAt <= now) this.windows.set(id, (w = { count: 0, resetAt: now + rule.windowSec * 1000 }));
    w.count += 1;
    return w.count > rule.limit ? Math.max(1, Math.ceil((w.resetAt - now) / 1000)) : null;
  }

  reset() {
    this.windows.clear();
  }
}

function addressOf(req: Request): string {
  // The hosting proxy sets these; the socket address would be the proxy itself.
  const direct = req.headers['cf-connecting-ip'] ?? req.headers['true-client-ip'];
  if (typeof direct === 'string' && direct) return direct;
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

/** Applied to every HTTP request. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The bot talks to the API constantly from one address; with the right key it is not counted. */
  private isBot(req: Request): boolean {
    const provided = req.headers['x-internal-key'];
    const expected = this.config.internalApiKey;
    if (!expected || typeof provided !== 'string') return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.limiter.enabled || context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (this.isBot(req)) return true;
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    // The end of a session token is its signature, which is different for every session.
    const who = token ? `session:${token.slice(-32)}` : `address:${addressOf(req)}`;
    const general = this.limiter.take(who, token ? SIGNED_IN : ANONYMOUS);
    if (general !== null) throw new GameError('RATE_LIMITED', `Too many requests. Please wait ${general} seconds.`, 429);
    const rules = this.reflector.get<RateRule[] | undefined>(RATE_RULES, context.getHandler()) ?? [];
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    for (const rule of rules) {
      const wait = this.limiter.take(`${who}|${route}`, rule);
      if (wait !== null) throw new GameError('RATE_LIMITED', `You are doing that too often. Please wait ${wait > 90 ? `${Math.ceil(wait / 60)} minutes` : `${wait} seconds`}.`, 429);
    }
    return true;
  }
}
