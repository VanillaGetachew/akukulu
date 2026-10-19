import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import type { AuthResponse } from '@akukulu/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import type { UserEntity } from '../database/entities';
import { UsersService } from '../users/users.service';
import { toProfile } from '../common/util';
import { InitDataError, verifyTelegramInitData } from './telegram-init-data';

export interface JwtPayload {
  sub: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async loginWithInitData(initData: string): Promise<AuthResponse & { startParam: string | null }> {
    let verified;
    try {
      verified = verifyTelegramInitData(initData, this.config.telegramBotToken, this.config.telegramAuthMaxAgeSec);
    } catch (err) {
      throw new UnauthorizedException(err instanceof InitDataError ? err.message : 'Invalid Telegram data');
    }
    const user = await this.users.upsertFromTelegram(verified.user, verified.startParam);
    return { ...this.issue(user), startParam: verified.startParam };
  }

  /** Local development only: sign in as a named test user without Telegram. */
  async devLogin(name: string): Promise<AuthResponse> {
    if (!this.config.allowDevAuth) throw new ForbiddenException('Development login is disabled');
    const digest = createHash('sha256').update(name.toLowerCase()).digest();
    const telegramId = (9_000_000_000_000n + BigInt(digest.readUInt32BE(0))).toString();
    const user = await this.users.upsertFromTelegram({ id: telegramId, first_name: name, username: `dev_${name.toLowerCase()}` }, null);
    return this.issue(user);
  }

  issue(user: UserEntity): AuthResponse {
    if (user.isBanned) throw new ForbiddenException('This account is suspended');
    const payload: JwtPayload = { sub: user.id };
    return { token: this.jwt.sign(payload), user: toProfile(user) };
  }

  async userFromToken(token: string): Promise<UserEntity> {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Session expired — please reopen the app');
    }
    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException('Unknown user');
    if (user.isBanned) throw new ForbiddenException('This account is suspended');
    return user;
  }
}
