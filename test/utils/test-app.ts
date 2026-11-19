import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { RedisService } from '../../src/redis/redis.service';
import { setupSwagger } from '../../src/swagger/swagger';

export type TestApp = INestApplication<App>;

export interface TestAppOptions {
  /** Override things outside our control (e.g. a clock). Never the DB. */
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  /**
   * Global setup that main.ts applies (ValidationPipe, filters, ...).
   * Keep this in sync with main.ts so tests run what production runs.
   */
  configure?: (app: TestApp) => void;
}

/**
 * Boots the real AppModule against the test DB/Redis from
 * test/setup/test-env.ts. Integration/E2E must hit real MySQL — no mocks.
 *
 *   let app: TestApp;
 *   beforeAll(async () => (app = await createTestApp()));
 *   afterAll(() => app.close());
 */
export async function createTestApp(
  options: TestAppOptions = {},
): Promise<TestApp> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.customize) builder = options.customize(builder);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<TestApp>({
    logger: ['error', 'warn'],
  });
  // Same global pipes/filters/static assets as main.ts.
  configureApp(app as unknown as NestExpressApplication);
  options.configure?.(app);
  setupSwagger(app);
  await app.init();
  return app;
}

/** Supertest agent bound to the app's HTTP server. */
export const http = (app: TestApp) => request(app.getHttpServer());

/**
 * The Redis client connects in the background. Suites that assert cache or
 * rate-limit behaviour wait for it so the first requests do not fall back.
 */
export async function waitForRedis(app: TestApp, timeoutMs = 5000) {
  const redis = app.get(RedisService);
  const deadline = Date.now() + timeoutMs;
  while (!redis.isReady && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!redis.isReady) {
    throw new Error(
      'Test Redis is not reachable. Start it: npm run test:db:up',
    );
  }
  return redis;
}
