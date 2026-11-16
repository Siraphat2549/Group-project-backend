/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest response bodies are untyped */
/**
 * Auth, profile, RBAC, caching and rate limiting against a REAL MySQL
 * database (and Redis when REDIS_URL points at a running one).
 *
 *   DATABASE_URL=mysql://.../hotel_booking_test npx prisma migrate deploy
 *   DATABASE_URL=mysql://.../hotel_booking_test npm run test:e2e
 *
 * Only rows this suite creates are touched (users @auth-e2e.test, rooms
 * "AUTH-E2E ...") and they are removed again afterwards.
 */
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

process.env.JWT_SECRET ??= 'e2e-secret-e2e-secret-e2e-secret-e2e';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.BCRYPT_ROUNDS = '4'; // fast hashes; strength is not under test here
process.env.THROTTLE_TTL_MS = '60000';
process.env.THROTTLE_LIMIT = '1000';
process.env.THROTTLE_AUTH_LIMIT = '25';
process.env.THROTTLE_BOOKING_LIMIT = '1000';
process.env.CACHE_TTL_SECONDS = '60';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

// Imported after env is set: ConfigModule validates env at import time.
/* eslint-disable @typescript-eslint/no-require-imports */
const { AppModule } =
  require('../src/app.module') as typeof import('../src/app.module');
const { configureApp } =
  require('../src/app.setup') as typeof import('../src/app.setup');
const { PrismaService } =
  require('../src/prisma/prisma.service') as typeof import('../src/prisma/prisma.service');
const { RedisService } =
  require('../src/redis/redis.service') as typeof import('../src/redis/redis.service');
/* eslint-enable @typescript-eslint/no-require-imports */

const DOMAIN = '@auth-e2e.test';
const PASSWORD = 'Secret123';

describeDb('Auth, profile, RBAC, cache & rate limit (e2e, real DB)', () => {
  let app: INestApplication<App>;
  let prisma: InstanceType<typeof PrismaService>;
  let redis: InstanceType<typeof RedisService>;
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanup() {
    await prisma.room.deleteMany({
      where: { name: { startsWith: 'AUTH-E2E ' } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  }

  async function register(name: string, password = PASSWORD) {
    const email = `${name}${DOMAIN}`;
    const res = await http()
      .post('/auth/register')
      .send({ name, email, password })
      .expect(201);
    return res.body.data as { id: number; email: string; role: Role };
  }

  async function login(name: string, password = PASSWORD) {
    const res = await http()
      .post('/auth/login')
      .send({ email: `${name}${DOMAIN}`, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  /** Rate-limit counters live in Redis for a minute: start each run clean. */
  async function resetRateLimits() {
    if (!redis.isReady) return;
    const keys = await redis.client.keys('hotel:throttle:*');
    // KEYS returns prefixed names, DEL adds the prefix again: strip it.
    if (keys.length > 0) {
      await redis.client.del(keys.map((key) => key.replace(/^hotel:/, '')));
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const nest = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    configureApp(nest);
    await nest.init();
    app = nest;
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);

    // Give the Redis connection a moment; the suite also passes without it.
    for (let i = 0; i < 20 && !redis.isReady; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await resetRateLimits();
    await cleanup();
  });

  afterAll(async () => {
    if (prisma) await cleanup();
    if (redis) await resetRateLimits();
    if (app) await app.close();
  });

  describe('Sign up (FR-1, NFR-1, NFR-4)', () => {
    it('201 with the user, and only a bcrypt hash in the database', async () => {
      const res = await http()
        .post('/auth/register')
        .send({
          name: '  Alice  ',
          email: `  Alice${DOMAIN.toUpperCase()} `,
          password: PASSWORD,
        })
        .expect(201);

      expect(res.body.message).toBe('Account created successfully');
      expect(res.body.data).toMatchObject({
        name: 'Alice',
        email: `alice${DOMAIN}`,
        role: Role.USER,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password|Secret123/i);

      const row = await prisma.user.findUniqueOrThrow({
        where: { email: `alice${DOMAIN}` },
      });
      expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
      expect(row.passwordHash).not.toContain(PASSWORD);
    });

    it('409 for an email that is already registered (any letter case)', async () => {
      const res = await http()
        .post('/auth/register')
        .send({ name: 'Alice 2', email: `ALICE${DOMAIN}`, password: PASSWORD })
        .expect(409);
      expect(res.body.message).toBe('Email is already registered');
    });

    it('400 with clear messages for invalid or incomplete data', async () => {
      const res = await http()
        .post('/auth/register')
        .send({ name: '', email: 'not-an-email', password: 'short' })
        .expect(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          'name is required',
          'email must be a valid email address',
          expect.stringContaining('password must be 8-72 characters'),
        ]),
      );
    });

    it('400 when a client tries to register itself as ADMIN', async () => {
      await http()
        .post('/auth/register')
        .send({
          name: 'Mallory',
          email: `mallory${DOMAIN}`,
          password: PASSWORD,
          role: 'ADMIN',
        })
        .expect(400);
      expect(
        await prisma.user.count({ where: { email: `mallory${DOMAIN}` } }),
      ).toBe(0);
    });
  });

  describe('Login / logout (FR-2)', () => {
    it('200 with a Bearer token that opens protected routes', async () => {
      const res = await http()
        .post('/auth/login')
        .send({ email: `alice${DOMAIN}`, password: PASSWORD })
        .expect(200);

      expect(res.body.data).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: 3600,
        user: { email: `alice${DOMAIN}`, role: Role.USER },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|Secret123/);

      await http()
        .get('/users/me')
        .set(bearer(res.body.data.accessToken as string))
        .expect(200);
    });

    it('same 401 for a wrong password and an unknown email', async () => {
      const wrong = await http()
        .post('/auth/login')
        .send({ email: `alice${DOMAIN}`, password: 'Wrong1234' })
        .expect(401);
      const unknown = await http()
        .post('/auth/login')
        .send({ email: `nobody${DOMAIN}`, password: PASSWORD })
        .expect(401);
      expect(wrong.body.message).toBe('Invalid email or password');
      expect(unknown.body).toEqual(wrong.body);
    });

    it('401 without a token, with garbage, or with a tampered token', async () => {
      const token = await login('alice');
      await http().get('/users/me').expect(401);
      await http().get('/users/me').set(bearer('garbage')).expect(401);
      await http()
        .get('/users/me')
        .set(bearer(`${token.slice(0, -2)}xx`))
        .expect(401);
    });

    it('logout revokes that token only; other sessions keep working', async () => {
      const phone = await login('alice');
      const laptop = await login('alice');

      const res = await http().post('/auth/logout').set(bearer(phone));

      if (!redis.isReady) {
        // Without Redis a logout cannot be enforced, and the API says so.
        expect(res.status).toBe(503);
        return;
      }
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Logged out successfully');
      await http().get('/users/me').set(bearer(phone)).expect(401);
      await http().post('/auth/logout').set(bearer(phone)).expect(401);
      await http().get('/users/me').set(bearer(laptop)).expect(200);
    });
  });

  describe('Profile (FR-3, FR-4)', () => {
    it('GET /users/me returns only the caller`s own profile', async () => {
      await register('bob');
      const res = await http()
        .get('/users/me')
        .set(bearer(await login('bob')))
        .expect(200);
      expect(res.body.data).toMatchObject({
        name: 'bob',
        email: `bob${DOMAIN}`,
      });
      expect(res.body.data).not.toHaveProperty('passwordHash');
    });

    it('PATCH /users/me updates the name', async () => {
      const token = await login('bob');
      const res = await http()
        .patch('/users/me')
        .set(bearer(token))
        .send({ name: 'Bob Builder' })
        .expect(200);
      expect(res.body).toMatchObject({
        message: 'Profile updated successfully',
        data: { name: 'Bob Builder' },
      });
      const row = await prisma.user.findUniqueOrThrow({
        where: { email: `bob${DOMAIN}` },
      });
      expect(row.name).toBe('Bob Builder');
    });

    it('rejects role changes, missing or wrong currentPassword, taken emails', async () => {
      const token = await login('bob');
      const patch = (body: Record<string, unknown>) =>
        http().patch('/users/me').set(bearer(token)).send(body);

      await patch({ role: 'ADMIN' }).expect(400);
      await patch({ newPassword: 'Another123' }).expect(400);
      await patch({
        newPassword: 'Another123',
        currentPassword: 'Wrong1234',
      }).expect(401);
      await patch({
        email: `alice${DOMAIN}`,
        currentPassword: PASSWORD,
      }).expect(409);

      const row = await prisma.user.findUniqueOrThrow({
        where: { email: `bob${DOMAIN}` },
      });
      expect(row.role).toBe(Role.USER);
    });

    it('a password change swaps the login password and signs out old tokens', async () => {
      await register('carol');
      const oldToken = await login('carol');
      // Tokens carry whole-second timestamps: make "before" strictly earlier.
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const res = await http()
        .patch('/users/me')
        .set(bearer(oldToken))
        .send({ newPassword: 'Another123', currentPassword: PASSWORD })
        .expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/Another123|passwordHash/);

      await http()
        .post('/auth/login')
        .send({ email: `carol${DOMAIN}`, password: PASSWORD })
        .expect(401);
      await login('carol', 'Another123');
      // The token returned by the update keeps this session alive.
      await http()
        .get('/users/me')
        .set(bearer(res.body.token.accessToken as string))
        .expect(200);
      if (redis.isReady) {
        await http().get('/users/me').set(bearer(oldToken)).expect(401);
      }
    });
  });

  describe('RBAC with real logins (FR-5..7, NFR-2, NFR-3)', () => {
    let userToken = '';
    let adminToken = '';
    let roomId = 0;

    beforeAll(async () => {
      const admin = await register('admin');
      // Admins are never created through the API: promote directly, as the seed does.
      await prisma.user.update({
        where: { id: admin.id },
        data: { role: Role.ADMIN },
      });
      adminToken = await login('admin');
      userToken = await login('alice');
    });

    it('only an admin can create a room', async () => {
      const room = { name: 'AUTH-E2E Room', capacity: 2, pricePerNight: 1000 };
      await http().post('/rooms').send(room).expect(401);
      await http().post('/rooms').set(bearer(userToken)).send(room).expect(403);
      const res = await http()
        .post('/rooms')
        .set(bearer(adminToken))
        .send(room)
        .expect(201);
      roomId = res.body.data.id as number;
    });

    it('bookings need a login; users see their own, admins see all', async () => {
      await http().get('/bookings').expect(401);
      await http().post('/bookings').send({}).expect(401);

      const mine = await http()
        .get('/bookings')
        .set(bearer(userToken))
        .expect(200);
      expect(mine.body.data).toEqual([]);

      await http()
        .patch('/bookings/1/status')
        .set(bearer(userToken))
        .send({ status: 'APPROVED' })
        .expect(403);
      await http().get('/bookings').set(bearer(adminToken)).expect(200);
    });

    describe('Response cache (Task 4)', () => {
      it('serves the room from cache, and never serves it stale after an update', async () => {
        if (!redis.isReady) return; // cache is simply off without Redis

        const first = await http().get(`/rooms/${roomId}`).expect(200);
        const second = await http().get(`/rooms/${roomId}`).expect(200);
        expect(first.headers['x-cache']).toBe('MISS');
        expect(second.headers['x-cache']).toBe('HIT');
        expect(second.body).toEqual(first.body);

        await http()
          .patch(`/rooms/${roomId}`)
          .set(bearer(adminToken))
          .send({ pricePerNight: 1500 })
          .expect(200);

        const third = await http().get(`/rooms/${roomId}`).expect(200);
        expect(third.headers['x-cache']).toBe('MISS');
        expect(Number(third.body.data.pricePerNight)).toBe(1500);
      });

      it('a deactivated room disappears for the public at once; admins bypass the cache', async () => {
        await http().get(`/rooms/${roomId}`).expect(200); // warm the cache
        await http()
          .patch(`/rooms/${roomId}`)
          .set(bearer(adminToken))
          .send({ isActive: false })
          .expect(200);

        await http().get(`/rooms/${roomId}`).expect(404);
        const admin = await http()
          .get(`/rooms/${roomId}`)
          .set(bearer(adminToken))
          .expect(200);
        expect(admin.headers['x-cache']).toBe('BYPASS');
        // What the admin saw must not have been stored for everyone else.
        await http().get(`/rooms/${roomId}`).expect(404);
      });
    });
  });

  // Last: it deliberately exhausts the auth limit for this client.
  describe('Rate limiting (Task 4)', () => {
    it('429 with Retry-After once the login limit is used up; other routes keep working', async () => {
      await resetRateLimits();
      const attempt = () =>
        http()
          .post('/auth/login')
          .send({ email: `nobody${DOMAIN}`, password: 'Wrong1234' });

      // Wrong logins are answered with 401 until the limit is reached, then
      // 429. (With Redis the counter was just reset, so exactly `limit`
      // attempts pass; on the in-memory fallback earlier logins of this
      // suite already count, so the block may come sooner.)
      const limit = Number(process.env.THROTTLE_AUTH_LIMIT);
      let allowed = 0;
      let blocked = await attempt();
      while (blocked.status === 401 && allowed <= limit) {
        allowed += 1;
        blocked = await attempt();
      }
      expect(blocked.status).toBe(429);
      expect(allowed).toBeLessThanOrEqual(limit);
      if (redis.isReady) expect(allowed).toBe(limit);
      expect(blocked.body.message).toBe(
        'Too many requests, please try again later',
      );
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

      // Limits are per route: browsing and health checks are unaffected.
      await http().get('/rooms').expect(200);
      await http().get('/health/live').expect(200);
    });
  });
});
