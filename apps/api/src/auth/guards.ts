import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config';
import type { UserEntity } from '../database/entities';
import { AuthService } from './auth.service';

type AuthedRequest = Request & { user?: UserEntity };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Missing session token');
    req.user = await this.auth.userFromToken(token);
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user?.isAdmin) throw new ForbiddenException('Administrator access required');
    return true;
  }
}

/** Protects bot-to-API calls with a shared secret header. */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.internalApiKey;
    const provided = context.switchToHttp().getRequest<Request>().headers['x-internal-key'];
    if (!expected || typeof provided !== 'string') throw new UnauthorizedException();
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): UserEntity => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user!;
});
