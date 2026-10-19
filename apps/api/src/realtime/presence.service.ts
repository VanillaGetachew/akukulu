import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

/**
 * Online presence and per-user action rate limiting. Uses Redis when configured
 * (shared across API instances) and falls back to process memory for local dev.
 */
@Injectable()
export class PresenceService implements OnModuleDestroy {
  private readonly localSockets = new Map<string, Set<string>>();
  private readonly localBuckets = new Map<string, { second: number; count: number }>();

  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  async connected(userId: string, socketId: string) {
    if (this.redis) {
      await this.redis.multi().sadd(`presence:${userId}`, socketId).expire(`presence:${userId}`, 86400).sadd('presence:users', userId).exec();
      return;
    }
    if (!this.localSockets.has(userId)) this.localSockets.set(userId, new Set());
    this.localSockets.get(userId)!.add(socketId);
  }

  async disconnected(userId: string, socketId: string) {
    if (this.redis) {
      await this.redis.srem(`presence:${userId}`, socketId);
      if ((await this.redis.scard(`presence:${userId}`)) === 0) await this.redis.srem('presence:users', userId);
      return;
    }
    const set = this.localSockets.get(userId);
    set?.delete(socketId);
    if (set && set.size === 0) this.localSockets.delete(userId);
  }

  async onlineMap(userIds: string[]): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const id of userIds) {
      out[id] = this.redis ? (await this.redis.scard(`presence:${id}`)) > 0 : (this.localSockets.get(id)?.size ?? 0) > 0;
    }
    return out;
  }

  async onlineCount(): Promise<number> {
    if (this.redis) return this.redis.scard('presence:users');
    return this.localSockets.size;
  }

  async allowAction(userId: string, perSecond: number): Promise<boolean> {
    const second = Math.floor(Date.now() / 1000);
    if (this.redis) {
      const key = `rl:${userId}:${second}`;
      const [[, count]] = (await this.redis.multi().incr(key).expire(key, 2).exec()) as [[unknown, number]];
      return count <= perSecond;
    }
    const bucket = this.localBuckets.get(userId);
    if (!bucket || bucket.second !== second) {
      this.localBuckets.set(userId, { second, count: 1 });
      return true;
    }
    bucket.count++;
    return bucket.count <= perSecond;
  }
}
