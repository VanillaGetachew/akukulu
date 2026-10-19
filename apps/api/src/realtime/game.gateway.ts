import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { ActionAck } from '@akukulu/shared';
import { AuthService } from '../auth/auth.service';
import { MatchRuntimeService } from '../matches/match-runtime.service';
import { RoomsService } from '../rooms/rooms.service';
import { GameError, errorMessage } from '../common/util';
import { Broadcaster, roomChannel, spectatorChannel, userChannel } from './broadcaster';
import { PresenceService } from './presence.service';

interface SocketData {
  userId: string;
}

const actionsPerSecond = () => Number(process.env.ACTION_RATE_LIMIT_PER_SEC ?? 10);

/**
 * Socket.IO entry point. Clients authenticate with their session JWT in the
 * handshake; every match action is forwarded to the server-authoritative runtime.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class GameGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(GameGateway.name);

  constructor(
    private readonly auth: AuthService,
    private readonly rooms: RoomsService,
    private readonly runtime: MatchRuntimeService,
    private readonly broadcaster: Broadcaster,
    private readonly presence: PresenceService,
  ) {}

  afterInit(server: Server) {
    this.broadcaster.attach(server);
    // Authenticate during the handshake so no event is handled before the user is known.
    server.use((socket, next) => {
      const token = (socket.handshake.auth as { token?: unknown })?.token;
      if (typeof token !== 'string') return next(new Error('Unauthorized'));
      this.auth
        .userFromToken(token)
        .then((user) => {
          (socket.data as SocketData).userId = user.id;
          next();
        })
        .catch(() => next(new Error('Unauthorized')));
    });
  }

  async handleConnection(socket: Socket) {
    const userId = (socket.data as SocketData).userId;
    if (!userId) {
      socket.disconnect(true);
      return;
    }
    await socket.join(userChannel(userId));
    socket.on('disconnect', () => {
      void this.presence
        .disconnected(userId, socket.id)
        .then(() => this.runtime.refreshPresence(userId))
        .catch(() => undefined);
    });
    await this.presence.connected(userId, socket.id);
    void this.runtime.refreshPresence(userId).catch(() => undefined);
  }

  private userId(socket: Socket): string {
    const id = (socket.data as SocketData).userId;
    if (!id) throw new GameError('UNAUTHORIZED', 'Unauthorized');
    return id;
  }

  @SubscribeMessage('room:subscribe')
  async roomSubscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { code?: unknown }) {
    try {
      const userId = this.userId(socket);
      if (typeof body?.code !== 'string') throw new GameError('BAD_REQUEST', 'Room code required');
      const room = await this.rooms.getByCode(body.code);
      await socket.join(roomChannel(room.code));
      if (room.matchId) {
        const match = await this.runtime.getMatch(room.matchId);
        if (match) {
          const isPlayer = await this.runtime.isPlayer(match.id, userId);
          if (!isPlayer) await socket.join(spectatorChannel(match.id));
          socket.emit('match:state', await this.runtime.payloadFor(match, isPlayer ? userId : null));
        }
      }
      return { ok: true, room };
    } catch (err) {
      return { ok: false, ...this.err(err) };
    }
  }

  @SubscribeMessage('room:unsubscribe')
  async roomUnsubscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { code?: unknown }) {
    if (typeof body?.code === 'string') await socket.leave(roomChannel(body.code.toUpperCase()));
    return { ok: true };
  }

  /** Reconnection: re-sends the latest personalised state for a match. */
  @SubscribeMessage('match:subscribe')
  async matchSubscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { matchId?: unknown }): Promise<ActionAck> {
    try {
      const userId = this.userId(socket);
      if (typeof body?.matchId !== 'string') throw new GameError('BAD_REQUEST', 'matchId required');
      const match = await this.runtime.getMatch(body.matchId);
      if (!match) throw new GameError('NOT_FOUND', 'Match not found');
      const isPlayer = await this.runtime.isPlayer(match.id, userId);
      if (!isPlayer) await socket.join(spectatorChannel(match.id));
      socket.emit('match:state', await this.runtime.payloadFor(match, isPlayer ? userId : null));
      return { ok: true };
    } catch (err) {
      return { ok: false, ...this.err(err) };
    }
  }

  @SubscribeMessage('match:action')
  async matchAction(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { matchId?: unknown; clientActionId?: unknown; action?: unknown },
  ): Promise<ActionAck> {
    try {
      const userId = this.userId(socket);
      if (!(await this.presence.allowAction(userId, actionsPerSecond()))) {
        return { ok: false, code: 'RATE_LIMITED', error: 'Slow down a little' };
      }
      if (typeof body?.matchId !== 'string') throw new GameError('BAD_REQUEST', 'matchId required');
      await this.runtime.act(body.matchId, userId, String(body.clientActionId ?? ''), body.action as Record<string, unknown>);
      return { ok: true };
    } catch (err) {
      return { ok: false, ...this.err(err) };
    }
  }

  private err(err: unknown): { code: string; error: string } {
    const { code, message } = errorMessage(err);
    if (code === 'INTERNAL') this.logger.error(err);
    return { code, error: message };
  }
}
