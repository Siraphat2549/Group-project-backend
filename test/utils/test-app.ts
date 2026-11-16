import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
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
  options.configure?.(app);
  setupSwagger(app);
  await app.init();
  return app;
}

/** Supertest agent bound to the app's HTTP server. */
export const http = (app: TestApp) => request(app.getHttpServer());
