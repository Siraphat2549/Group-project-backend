/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped */
// Rate limiting (Task 4). Limits are read when the app module is loaded, so
// they are lowered here first and the app is required afterwards.
import { Role } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { resetTestState } from '../utils/db-cleanup';

const AUTH_LIMIT = 3;
const BOOKING_LIMIT = 2;
process.env.THROTTLE_AUTH_LIMIT = String(AUTH_LIMIT);
process.env.THROTTLE_BOOKING_LIMIT = String(BOOKING_LIMIT);

/* eslint-disable @typescript-eslint/no-require-imports */
const { createTestApp, http, waitForRedis } =
  require('../utils/test-app') as typeof import('../utils/test-app');
const { book, createActor, createRoom, stay } =
  require('../utils/factories') as typeof import('../utils/factories');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('Rate limiting (integration)', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  // Counters live in Redis; flushing it gives every test a fresh window.
  beforeEach(async () =>
    resetTestState({ db: prisma, cache: (await waitForRedis(app)).client }),
  );
  afterAll(() => app.close());

  it('IT-RL-01 POST /auth/login over the limit -> 429 with Retry-After; other routes keep working', async () => {
    const attempt = () =>
      http(app)
        .post('/auth/login')
        .send({ email: 'nobody@test.local', password: 'Wrong-pass1' });

    for (let i = 0; i < AUTH_LIMIT; i++) {
      const res = await attempt().expect(401);
      expect(res.headers['x-ratelimit-limit']).toBe(String(AUTH_LIMIT));
      expect(res.headers['x-ratelimit-remaining']).toBe(
        String(AUTH_LIMIT - 1 - i),
      );
    }

    const blocked = await attempt().expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.body.statusCode).toBe(429);

    // The limit is per route: browsing still works for the same client.
    await http(app).get('/rooms').expect(200);
    await http(app).get('/health').expect(200);
  });

  it('IT-RL-02 POST /bookings over the limit -> 429; no booking is created by the blocked request', async () => {
    const user = await createActor(app, Role.USER);
    const room = await createRoom(app);

    for (let i = 0; i < BOOKING_LIMIT; i++) {
      await book(app, user, room.id, stay(10 + i * 3, 11 + i * 3)).expect(201);
    }
    await book(app, user, room.id, stay(30, 31)).expect(429);

    await expect(prisma.booking.count()).resolves.toBe(BOOKING_LIMIT);
    // Reading bookings is a different route and is not affected.
    await http(app).get('/bookings').set(user.auth).expect(200);
  });
});
