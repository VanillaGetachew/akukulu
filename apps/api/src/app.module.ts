import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import type { DataSourceOptions } from 'typeorm';
import { APP_CONFIG, loadConfig, type AppConfig } from './config';
import { ENTITIES } from './database/entities';
import { AuthService } from './auth/auth.service';
import { AdminGuard, InternalKeyGuard, JwtAuthGuard } from './auth/guards';
import { UsersService } from './users/users.service';
import { LedgerService } from './wallet/ledger.service';
import { WalletService } from './wallet/wallet.service';
import { GamesService } from './games/games.service';
import { RoomsService } from './rooms/rooms.service';
import { RoomPresenter } from './rooms/room-presenter';
import { MatchRuntimeService } from './matches/match-runtime.service';
import { Broadcaster } from './realtime/broadcaster';
import { GameGateway } from './realtime/game.gateway';
import { PresenceService, REDIS } from './realtime/presence.service';
import {
  AuthController,
  GamesController,
  HealthController,
  LeaderboardController,
  MatchesController,
  MeController,
  RewardsController,
  RoomsController,
} from './http/public.controllers';
import { AdminController, InternalController } from './http/admin.controllers';

export interface AppModuleOptions {
  config?: AppConfig;
  /** Overrides the TypeORM connection (tests use pg-mem). */
  dataSource?: Partial<DataSourceOptions> & Record<string, unknown>;
  redis?: Redis | null;
}

@Module({})
export class AppModule {
  static forRoot(options: AppModuleOptions = {}): DynamicModule {
    const config = options.config ?? loadConfig();
    const redis = options.redis !== undefined ? options.redis : config.redisUrl ? new Redis(config.redisUrl) : null;
    return {
      module: AppModule,
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: config.databaseUrl,
          entities: ENTITIES,
          synchronize: config.dbSynchronize,
          ...(options.dataSource as object),
        } as DataSourceOptions),
        JwtModule.register({ secret: config.jwtSecret, signOptions: { expiresIn: '7d', algorithm: 'HS256' } }),
      ],
      controllers: [
        AuthController,
        HealthController,
        GamesController,
        RoomsController,
        MeController,
        RewardsController,
        MatchesController,
        LeaderboardController,
        AdminController,
        InternalController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: REDIS, useValue: redis },
        AuthService,
        JwtAuthGuard,
        AdminGuard,
        InternalKeyGuard,
        UsersService,
        LedgerService,
        WalletService,
        GamesService,
        RoomPresenter,
        RoomsService,
        MatchRuntimeService,
        Broadcaster,
        PresenceService,
        GameGateway,
      ],
    };
  }
}
