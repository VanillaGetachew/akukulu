import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { GameError } from '../common/util';

export interface LedgerOperation {
  userId: string;
  /** Signed: negative debits. */
  amount: number;
  type: string;
  description: string;
  /** Globally unique key — applying the same key twice is a no-op. */
  key: string;
  matchId?: string | null;
}

export interface LedgerResult {
  applied: boolean;
  balance: number;
}

/** pg returns `[rows, rowCount]` for UPDATE via TypeORM's raw query API. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0];
  return (result as Record<string, unknown>[]) ?? [];
}

/**
 * The only code path allowed to change a user's balance. Every movement is a
 * ledger row with a unique idempotency key, written in the caller's transaction,
 * and the balance update refuses to go below zero.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly dataSource: DataSource) {}

  async apply(manager: EntityManager, op: LedgerOperation): Promise<LedgerResult> {
    if (!Number.isInteger(op.amount)) throw new GameError('BAD_AMOUNT', 'Ledger amounts must be whole points');
    const inserted = rowsOf(
      await manager.query(
        `INSERT INTO ledger_entries (id, "userId", amount, "balanceAfter", type, description, "idempotencyKey", "matchId", "createdAt")
         VALUES ($1, $2, $3, 0, $4, $5, $6, $7, now())
         ON CONFLICT ("idempotencyKey") DO NOTHING
         RETURNING id`,
        [randomUUID(), op.userId, op.amount, op.type, op.description, op.key, op.matchId ?? null],
      ),
    );
    if (inserted.length === 0) {
      const [row] = rowsOf(await manager.query(`SELECT balance FROM users WHERE id = $1`, [op.userId]));
      return { applied: false, balance: Number(row?.balance ?? 0) };
    }
    const updated = rowsOf(
      await manager.query(
        `UPDATE users SET balance = balance + $2, "updatedAt" = now() WHERE id = $1 AND balance + $2 >= 0 RETURNING balance`,
        [op.userId, op.amount],
      ),
    );
    if (updated.length === 0) {
      throw new GameError('INSUFFICIENT_BALANCE', 'Not enough points for this action');
    }
    const balance = Number(updated[0].balance);
    await manager.query(`UPDATE ledger_entries SET "balanceAfter" = $2 WHERE id = $1`, [inserted[0].id, balance]);
    return { applied: true, balance };
  }

  /** Applies a single operation in its own transaction. */
  async applyStandalone(op: LedgerOperation): Promise<LedgerResult> {
    return this.dataSource.transaction((manager) => this.apply(manager, op));
  }

  async balancesFor(manager: EntityManager, userIds: string[]): Promise<Record<string, number>> {
    if (userIds.length === 0) return {};
    const rows = rowsOf(await manager.query(`SELECT id, balance FROM users WHERE id = ANY($1)`, [userIds]));
    return Object.fromEntries(rows.map((r) => [String(r.id), Number(r.balance)]));
  }
}
