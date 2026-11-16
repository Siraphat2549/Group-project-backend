import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
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
 * Runs once before the integration / E2E suites:
 *   1. points DATABASE_URL at the *_test database (guarded),
 *   2. waits for the test MySQL,
 *   3. rebuilds the schema from scratch (all data dropped).
 *
 * Steps 2–3 start automatically once the Prisma schema exists (prisma/).
 * Override step 3 with TEST_DB_PREPARE_CMD if the team's Prisma setup differs.
 */
export default async function globalSetup(): Promise<void> {
  applyTestEnv();

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
