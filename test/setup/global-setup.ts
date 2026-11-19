import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import Redis from 'ioredis';
import { probeMysql } from '../../src/health/probes/mysql.probe';
import { applyTestEnv } from './test-env';

const ROOT = join(__dirname, '..', '..');

async function waitForMysql(databaseUrl: string, timeoutMs = 60_000) {
  const url = new URL(databaseUrl);
  const port = Number(url.port || 3306);
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      await probeMysql(url.hostname, port, 1000);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(1000);
    }
  }
  throw new Error(
    `Test MySQL at ${url.hostname}:${port} is not reachable (${lastError}).\n` +
      'Start it with: npm run test:db:up',
  );
}

/**
 * Empties the test Redis, so nothing from an earlier run leaks into this one.
 * Rate-limit blocks outlive the request that caused them (60 s by default):
 * without this, `npm run test:e2e` started right after `test:integration`
 * (as CI does) inherits the rate-limit suite's block and answers 429.
 *
 * REDIS_URL is always the test Redis here (applyTestEnv replaces it). If that
 * Redis is down, only warn: the suites that need it fail with a clear message.
 */
async function flushTestRedis(redisUrl: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    // A fresh client per attempt; every step is bounded, so a Redis that
    // accepts the connection but never answers (e.g. paused) cannot hang.
    const redis = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 2000,
      commandTimeout: 2000,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      retryStrategy: () => null, // no auto-reconnect; this loop retries
    });
    redis.on('error', () => undefined); // reported below, once
    try {
      await withTimeout(
        (async () => {
          await redis.connect();
          await redis.flushdb();
        })(),
        3000,
      );
      console.log('[test] test Redis flushed');
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(500);
    } finally {
      redis.disconnect();
    }
  }
  console.warn(
    `[test] test Redis not reachable (${lastError}); suites that need it will fail. Start it with: npm run test:db:up`,
  );
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Runs once before the integration / E2E suites:
 *   1. points DATABASE_URL / REDIS_URL at the test services (guarded),
 *   2. empties the test Redis (cache, rate-limit counters and blocks),
 *   3. waits for the test MySQL,
 *   4. rebuilds the schema from scratch (all data dropped).
 *
 * Steps 3–4 start automatically once the Prisma schema exists (prisma/).
 * Override step 4 with TEST_DB_PREPARE_CMD if the team's Prisma setup differs.
 */
export default async function globalSetup(): Promise<void> {
  applyTestEnv();
  await flushTestRedis(process.env.REDIS_URL!);

  if (!existsSync(join(ROOT, 'prisma'))) {
    console.log(
      '\n[test] prisma/ not found yet — skipping test DB preparation.',
    );
    return;
  }

  await waitForMysql(process.env.DATABASE_URL!);

  const hasMigrations = existsSync(join(ROOT, 'prisma', 'migrations'));
  const command =
    process.env.TEST_DB_PREPARE_CMD ??
    (hasMigrations
      ? 'npx prisma migrate reset --force'
      : 'npx prisma db push --force-reset');

  console.log(`\n[test] preparing test database: ${command}`);
  execSync(command, { cwd: ROOT, stdio: 'inherit', env: process.env });
}
