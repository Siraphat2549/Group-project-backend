import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { HealthModule } from '../src/health/health.module';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          // Port 1 is closed, so both dependencies are guaranteed to be down.
          load: [
            () => ({
              DATABASE_URL: 'mysql://user:secret@127.0.0.1:1/hotel_booking',
              REDIS_URL: 'redis://:secret@127.0.0.1:1',
              HEALTH_CHECK_TIMEOUT_MS: 1000,
            }),
          ],
        }),
        HealthModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live -> 200 without touching dependencies', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      info: { app: { status: 'up' } },
    });
  });

  it('GET /health -> 503 with per-dependency status when deps are down', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.body).toMatchObject({
      status: 'error',
      info: { app: { status: 'up' } },
      error: {
        database: { status: 'down' },
        redis: { status: 'down' },
      },
    });
    // Credentials from the connection strings must never be exposed.
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});
