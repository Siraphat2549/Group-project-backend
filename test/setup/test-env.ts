/**
 * Environment for integration + E2E tests. Defaults match
 * docker-compose.test.yml (`npm run test:db:up`). Override with
 * TEST_DATABASE_URL / TEST_REDIS_URL (e.g. in CI).
 *
 * DATABASE_URL / REDIS_URL are ALWAYS replaced, never inherited from your
 * shell or .env, so a test run can't touch a dev or production database.
 */
export const TEST_DEFAULTS = {
  DATABASE_URL:
    'mysql://hotel_test:hotel_test@127.0.0.1:3307/hotel_booking_test',
  REDIS_URL: 'redis://127.0.0.1:6380',
} as const;

/** Used only when not already set (a suite may override them). */
const SOFT_DEFAULTS: Record<string, string> = {
  JWT_SECRET: 'test-only-jwt-secret-do-not-use-anywhere-else',
  JWT_EXPIRES_IN: '15m',
  CACHE_TTL_SECONDS: '60',
  THROTTLE_TTL_MS: '60000',
  // High so normal suites never hit 429; the rate-limit suite lowers it.
  THROTTLE_LIMIT: '1000',
  THROTTLE_AUTH_LIMIT: '1000',
  THROTTLE_BOOKING_LIMIT: '1000',
  HEALTH_CHECK_TIMEOUT_MS: '1000',
};

/** Refuses any database whose name does not end in `_test`. */
export function assertTestDatabaseUrl(databaseUrl: string): void {
  let name: string;
  try {
    name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  } catch {
    // Never echo the URL: it contains credentials.
    throw new Error('Test DATABASE_URL is not a valid URL');
  }
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database "${name}": the name must end in "_test" ` +
        '(tests delete all rows). Set TEST_DATABASE_URL to a dedicated test database.',
    );
  }
}

export function applyTestEnv(env: NodeJS.ProcessEnv = process.env): void {
  env.NODE_ENV = 'test';
  env.DATABASE_URL = env.TEST_DATABASE_URL || TEST_DEFAULTS.DATABASE_URL;
  env.REDIS_URL = env.TEST_REDIS_URL || TEST_DEFAULTS.REDIS_URL;
  for (const [key, value] of Object.entries(SOFT_DEFAULTS)) {
    if (!env[key]) env[key] = value;
  }
  assertTestDatabaseUrl(env.DATABASE_URL);
}
