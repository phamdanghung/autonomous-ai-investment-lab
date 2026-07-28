import { Prisma } from '@prisma/client';

export class MarketDataAdvisoryLocks {
  /**
   * Acquires a transaction-scoped PostgreSQL advisory lock using the provided big integer key.
   * This lock will automatically be released when the current transaction commits or rolls back.
   *
   * It uses pg_advisory_xact_lock to ensure the lock is tied to the transaction boundary.
   */
  static async acquireTransactionLock(
    transactionClient: Prisma.TransactionClient,
    lockKey: bigint
  ): Promise<void> {
    await transactionClient.$executeRaw`
      SELECT pg_advisory_xact_lock(CAST(${lockKey} AS bigint))
    `;
  }
}
