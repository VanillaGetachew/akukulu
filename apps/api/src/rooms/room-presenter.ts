import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import type { RoomSummary } from '@akukulu/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import { RoomEntity, RoomPlayerEntity, UserEntity } from '../database/entities';
import { displayName } from '../common/util';

@Injectable()
export class RoomPresenter {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  inviteLink(code: string): string | null {
    if (this.config.webAppLink) return `${this.config.webAppLink}?startapp=room_${code}`;
    if (this.config.botUsername) return `https://t.me/${this.config.botUsername}?start=room_${code}`;
    return null;
  }

  async summaries(rooms: RoomEntity[], manager: EntityManager = this.dataSource.manager): Promise<RoomSummary[]> {
    if (rooms.length === 0) return [];
    const seats = await manager.getRepository(RoomPlayerEntity).find({
      where: { roomId: In(rooms.map((r) => r.id)) },
      order: { seat: 'ASC' },
    });
    const users = await manager.getRepository(UserEntity).findBy({ id: In([...new Set(seats.map((s) => s.userId))]) });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rooms.map((room) => ({
      id: room.id,
      code: room.code,
      gameSlug: room.gameSlug,
      visibility: room.visibility,
      status: room.status,
      hostId: room.hostId,
      maxPlayers: room.maxPlayers,
      minPlayers: room.minPlayers,
      stake: room.stake,
      config: room.config,
      matchId: room.matchId,
      inviteLink: room.visibility === 'private' || room.status === 'waiting' ? this.inviteLink(room.code) : null,
      createdAt: room.createdAt.toISOString(),
      players: seats
        .filter((s) => s.roomId === room.id)
        .map((s) => {
          const u = byId.get(s.userId);
          return {
            userId: s.userId,
            seat: s.seat,
            ready: s.ready,
            displayName: u ? displayName(u) : 'Player',
            photoUrl: u?.photoUrl ?? null,
          };
        }),
    }));
  }

  async summary(room: RoomEntity, manager?: EntityManager): Promise<RoomSummary> {
    return (await this.summaries([room], manager))[0];
  }
}
