/**
 * Test-data cleanup. Call `resetTestState()` in `beforeEach` of every
 * integration/E2E suite so tests never depend on each other's data:
 *
 *   beforeEach(() => resetTestState({ db: app.get(PrismaService) }));
 *
 * Typed structurally so it works with PrismaClient without importing it.
 */

export interface RawSqlExecutor {
  $queryRawUnsafe<T = unknown>(
    query: string,
    ...values: unknown[]
  ): PromiseLike<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): PromiseLike<number>;
}

export interface RawSqlClient extends RawSqlExecutor {
  $transaction<R>(fn: (tx: RawSqlExecutor) => Promise<R>): Promise<R>;
}

/** Redis client (ioredis / node-redis both have `flushdb`). */
export interface FlushableCache {
  flushdb(): Promise<unknown>;
}

const KEEP_TABLES = new Set(['_prisma_migrations']);

const quoteIdent = (name: string) => `\`${name.replace(/`/g, '``')}\``;

/** Deletes every row of every table in the *current* database. */
export async function truncateAllTables(db: RawSqlClient): Promise<string[]> {
  const [{ name: database }] = await db.$queryRawUnsafe<{ name: string }[]>(
    'SELECT DATABASE() AS name',
  );
  // Second line of defence after test-env.ts: never wipe a non-test DB.
  if (!database?.endsWith('_test')) {
    throw new Error(
      `Refusing to clean database "${database}": name must end in "_test"`,
    );
  }

  const rows = await db.$queryRawUnsafe<{ name: string }[]>(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
  );
  const tables = rows.map((r) => r.name).filter((t) => !KEEP_TABLES.has(t));

  // FOREIGN_KEY_CHECKS is per-connection, so everything must run on one
  // connection: an interactive transaction guarantees that with Prisma's pool.
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const table of tables) {
        await tx.$executeRawUnsafe(`DELETE FROM ${quoteIdent(table)}`);
      }
    } finally {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    }
  });

  return tables;
}

/** Clears all rows and (optionally) the Redis cache / rate-limit counters. */
export async function resetTestState({
  db,
  cache,
}: {
  db: RawSqlClient;
  cache?: FlushableCache;
}): Promise<void> {
  await truncateAllTables(db);
  if (cache) await cache.flushdb();
}
