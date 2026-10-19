import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { ServerToClientEvents } from '@akukulu/shared';

export const userChannel = (userId: string) => `user:${userId}`;
export const roomChannel = (code: string) => `room:${code}`;
export const spectatorChannel = (matchId: string) => `match:${matchId}:spectators`;

/**
 * Thin wrapper around the Socket.IO server so services can publish without
 * depending on the gateway. With the Redis adapter, emits reach every API instance.
 */
@Injectable()
export class Broadcaster {
  private server: Server<Record<string, never>, ServerToClientEvents> | null = null;

  attach(server: Server) {
    this.server = server as never;
  }

  emit<E extends keyof ServerToClientEvents>(channel: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    if (!this.server) return;
    (this.server.to(channel).emit as (e: string, ...a: unknown[]) => void)(event, ...args);
  }

  toUser<E extends keyof ServerToClientEvents>(userId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    this.emit(userChannel(userId), event, ...args);
  }
}
