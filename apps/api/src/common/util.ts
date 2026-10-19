import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { UserProfile } from '@akukulu/shared';
import type { UserEntity } from '../database/entities';

/** A rejected game or economy action with a machine-readable code. */
export class GameError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status = HttpStatus.BAD_REQUEST,
  ) {
    super({ code, message }, status);
  }
}

export function errorMessage(err: unknown): { code: string; message: string } {
  if (err instanceof GameError) return { code: err.code, message: err.message };
  if (err instanceof HttpException) {
    const res = err.getResponse();
    const message = typeof res === 'string' ? res : ((res as { message?: unknown }).message as string) ?? err.message;
    return { code: `HTTP_${err.getStatus()}`, message: Array.isArray(message) ? message.join(', ') : String(message) };
  }
  return { code: 'INTERNAL', message: 'Something went wrong' };
}

/* ---- tiny request validators (keeps the dependency footprint small) ---- */

export function body(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

export function optInt(value: unknown, name: string, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw new BadRequestException(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

export function reqString(value: unknown, name: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new BadRequestException(`${name} is required`);
  }
  return value.trim();
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export function displayName(u: Pick<UserEntity, 'firstName' | 'lastName' | 'username'>): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return full || (u.username ? `@${u.username}` : 'Player');
}

export function referralCodeFor(telegramId: string): string {
  return BigInt(telegramId).toString(36);
}

export function telegramIdFromReferral(code: string): string | null {
  if (!/^[0-9a-z]{1,14}$/.test(code)) return null;
  try {
    let n = 0n;
    for (const ch of code) n = n * 36n + BigInt(parseInt(ch, 36));
    return n.toString();
  } catch {
    return null;
  }
}

export function toProfile(u: UserEntity): UserProfile {
  return {
    id: u.id,
    telegramId: String(u.telegramId),
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    photoUrl: u.photoUrl,
    balance: u.balance,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt.toISOString(),
    referralCode: referralCodeFor(String(u.telegramId)),
  };
}

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
