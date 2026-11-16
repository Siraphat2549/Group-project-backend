/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment -- supertest response bodies are untyped */
/**
 * Rooms / Bookings / Search / Notifications against a REAL MySQL database.
 *
 *   DATABASE_URL=mysql://.../hotel_booking_test npx prisma migrate deploy
 *   DATABASE_URL=mysql://.../hotel_booking_test npm run test:e2e
 *
 * Only rows this suite creates are touched (users @e2e.test, rooms "E2E ...").
 * Users are inserted directly and tokens signed with JWT_SECRET, so the suite
 * does not depend on the sign-up/login endpoints.
 */
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';

const uploadDir = mkdtempSync(join(tmpdir(), 'hotel-e2e-'));
process.env.UPLOAD_DIR = uploadDir;
process.env.JWT_SECRET ??= 'e2e-secret-e2e-secret-e2e-secret-e2e';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
// This suite fires far more requests per minute than a real client; rate
// limiting itself is covered in auth.e2e-spec.ts.
process.env.THROTTLE_LIMIT = '100000';
process.env.THROTTLE_AUTH_LIMIT = '100000';
process.env.THROTTLE_BOOKING_LIMIT = '100000';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

// Imported after env is set: ConfigModule validates env at import time.
/* eslint-disable @typescript-eslint/no-require-imports */
const { AppModule } =
  require('../src/app.module') as typeof import('../src/app.module');
const { configureApp } =
  require('../src/app.setup') as typeof import('../src/app.setup');
const { PrismaService } =
  require('../src/prisma/prisma.service') as typeof import('../src/prisma/prisma.service');
/* eslint-enable @typescript-eslint/no-require-imports */

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** A date N days from today, as YYYY-MM-DD (always in the future). */
function day(n: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describeDb('Rooms, bookings, search & notifications (e2e, real DB)', () => {
  let app: INestApplication<App>;
  let prisma: InstanceType<typeof PrismaService>;
  let http: ReturnType<typeof request>;
  const tokens = { admin: '', alice: '', bob: '' };
  const ids = { alice: 0, bob: 0 };

  const auth = (who: keyof typeof tokens) => ({
    Authorization: `Bearer ${tokens[who]}`,
  });

  async function cleanup() {
    const users = { email: { endsWith: '@e2e.test' } };
    const rooms = { name: { startsWith: 'E2E ' } };
    await prisma.notificationEvent.deleteMany({ where: { user: users } });
    await prisma.booking.deleteMany({
      where: { OR: [{ user: users }, { room: rooms }] },
    });
    await prisma.room.deleteMany({ where: rooms });
    await prisma.user.deleteMany({ where: users });
  }

  async function createRoom(body: Record<string, unknown>) {
    const res = await http
      .post('/rooms')
      .set(auth('admin'))
      .send(body)
      .expect(201);
    return res.body.data as { id: number; name: string };
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
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    const jwt = app.get(JwtService);

    await cleanup();
    for (const [key, role] of [
      ['admin', Role.ADMIN],
      ['alice', Role.USER],
      ['bob', Role.USER],
    ] as const) {
      const email = `${key}@e2e.test`;
      const user = await prisma.user.create({
        data: { name: key, email, role, passwordHash: 'not-used-in-e2e' },
      });
      tokens[key] = jwt.sign({ sub: user.id, email, role });
      if (key !== 'admin') ids[key] = user.id;
    }
  });

  afterAll(async () => {
    if (prisma) await cleanup();
    if (app) await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  // http is a fresh agent per call (supertest needs a new Test each time).
  beforeEach(() => {
    http = request(app.getHttpServer());
  });

  describe('Rooms (FR-8..16, NFR-3)', () => {
    it('401 without token, 403 for a regular user', async () => {
      await request(app.getHttpServer())
        .post('/rooms')
        .send({ name: 'E2E x', capacity: 2, pricePerNight: 100 })
        .expect(401);
      await request(app.getHttpServer())
        .post('/rooms')
        .set(auth('alice'))
        .send({ name: 'E2E x', capacity: 2, pricePerNight: 100 })
        .expect(403);
    });

    it('admin creates a room → 201 with success message', async () => {
      const res = await http
        .post('/rooms')
        .set(auth('admin'))
        .send({
          name: 'E2E Deluxe',
          description: 'Sea view',
          capacity: 2,
          pricePerNight: 1500.5,
        })
        .expect(201);
      expect(res.body.message).toBe('Room created successfully');
      expect(res.body.data).toMatchObject({
        name: 'E2E Deluxe',
        capacity: 2,
        pricePerNight: 1500.5,
        isActive: true,
        images: [],
      });
    });

    it('400 with clear messages for invalid / unknown fields', async () => {
      const res = await http
        .post('/rooms')
        .set(auth('admin'))
        .send({ name: '', capacity: 0, pricePerNight: -1, hacker: true })
        .expect(400);
      const msg = (res.body.message as string[]).join(' | ');
      expect(msg).toMatch(/name should not be empty/);
      expect(msg).toMatch(/capacity must not be less than 1/);
      expect(msg).toMatch(/property hacker should not exist/);
    });

    it('409 on duplicate room name', async () => {
      const res = await request(app.getHttpServer())
        .post('/rooms')
        .set(auth('admin'))
        .send({ name: 'E2E Deluxe', capacity: 2, pricePerNight: 10 })
        .expect(409);
      expect(res.body.message).toMatch(/already exists/);
    });

    it('404 with clear message for unknown room; 400 for non-numeric id', async () => {
      const res = await http.get('/rooms/999999').expect(404);
      expect(res.body.message).toBe('Room with id 999999 not found');
      await request(app.getHttpServer()).get('/rooms/abc').expect(400);
    });

    it('uploads an image, shows it in room details and serves the file', async () => {
      const room = await createRoom({
        name: 'E2E Photo',
        capacity: 2,
        pricePerNight: 900,
      });
      const up = await request(app.getHttpServer())
        .post(`/rooms/${room.id}/images`)
        .set(auth('admin'))
        .attach('image', PNG, {
          filename: 'room.png',
          contentType: 'image/png',
        })
        .expect(201);
      expect(up.body.data).toMatchObject({
        mimeType: 'image/png',
        originalName: 'room.png',
        sizeBytes: PNG.length,
      });

      const detail = await request(app.getHttpServer())
        .get(`/rooms/${room.id}`)
        .expect(200);
      expect(detail.body.data.images).toHaveLength(1);
      const url = detail.body.data.images[0].url as string;
      expect(url).toMatch(/^\/uploads\/rooms\/[0-9a-f-]+\.png$/);

      const file = await request(app.getHttpServer()).get(url).expect(200);
      expect(file.headers['content-type']).toBe('image/png');
    });

    it('rejects non-image uploads and missing files with 400', async () => {
      const room = await createRoom({
        name: 'E2E NoPhoto',
        capacity: 1,
        pricePerNight: 100,
      });
      await request(app.getHttpServer())
        .post(`/rooms/${room.id}/images`)
        .set(auth('admin'))
        .attach('image', Buffer.from('<svg/>'), {
          filename: 'x.png',
          contentType: 'image/png',
        })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/rooms/${room.id}/images`)
        .set(auth('admin'))
        .expect(400);
    });

    it('deactivated rooms are hidden from the public but visible to admins', async () => {
      const room = await createRoom({
        name: 'E2E Hidden',
        capacity: 3,
        pricePerNight: 200,
      });
      await request(app.getHttpServer())
        .patch(`/rooms/${room.id}`)
        .set(auth('admin'))
        .send({ isActive: false })
        .expect(200)
        .expect((r) =>
          expect(r.body.message).toBe('Room updated successfully'),
        );

      await request(app.getHttpServer()).get(`/rooms/${room.id}`).expect(404);
      await request(app.getHttpServer())
        .get(`/rooms/${room.id}`)
        .set(auth('admin'))
        .expect(200);

      const pub = await request(app.getHttpServer())
        .get('/rooms?limit=100&includeInactive=true')
        .expect(200);
      expect(pub.body.data.map((r: { id: number }) => r.id)).not.toContain(
        room.id,
      );
      const adm = await request(app.getHttpServer())
        .get('/rooms?limit=100&includeInactive=true')
        .set(auth('admin'))
        .expect(200);
      expect(adm.body.data.map((r: { id: number }) => r.id)).toContain(room.id);
    });

    it('deletes a never-booked room', async () => {
      const room = await createRoom({
        name: 'E2E Temp',
        capacity: 1,
        pricePerNight: 50,
      });
      await request(app.getHttpServer())
        .delete(`/rooms/${room.id}`)
        .set(auth('admin'))
        .expect(200);
      await request(app.getHttpServer()).get(`/rooms/${room.id}`).expect(404);
    });

    it('lists with pagination meta and capacity filter', async () => {
      const res = await http.get('/rooms?capacity=3&limit=5').expect(200);
      expect(res.body.meta).toMatchObject({ page: 1, limit: 5 });
      for (const r of res.body.data as { capacity: number }[]) {
        expect(r.capacity).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('Bookings (FR-17..26, NFR-2)', () => {
    let room: { id: number; name: string };

    beforeAll(async () => {
      room = await request(app.getHttpServer())
        .post('/rooms')
        .set(auth('admin'))
        .send({ name: 'E2E Booking Room', capacity: 2, pricePerNight: 1000 })
        .then((r) => r.body.data as { id: number; name: string });
    });

    const book = (
      who: keyof typeof tokens,
      checkIn: string,
      checkOut: string,
      extra: Record<string, unknown> = {},
    ) =>
      request(app.getHttpServer())
        .post('/bookings')
        .set(auth(who))
        .send({ roomId: room.id, checkIn, checkOut, ...extra });

    it('401 when not logged in', async () => {
      await request(app.getHttpServer())
        .post('/bookings')
        .send({ roomId: room.id, checkIn: day(1), checkOut: day(2) })
        .expect(401);
      await request(app.getHttpServer()).get('/bookings').expect(401);
    });

    let aliceBookingId = 0;

    it('creates a PENDING booking with computed total price', async () => {
      const res = await book('alice', day(10), day(13), { guests: 2 }).expect(
        201,
      );
      expect(res.body.message).toBe('Booking created successfully');
      expect(res.body.data).toMatchObject({
        status: 'PENDING',
        nights: 3,
        guests: 2,
        totalPrice: 3000,
        room: { id: room.id, name: 'E2E Booking Room' },
        user: { id: ids.alice, email: 'alice@e2e.test' },
      });
      expect(res.body.data.user).not.toHaveProperty('passwordHash');
      aliceBookingId = res.body.data.id;
    });

    it.each([
      ['identical', 10, 13],
      ['inside', 11, 12],
      ['overlapping start', 8, 11],
      ['overlapping end', 12, 15],
      ['covering', 9, 14],
    ])('409 double booking: %s', async (_n, a, b) => {
      const res = await book('bob', day(a), day(b)).expect(409);
      expect(res.body.message).toMatch(/already booked/);
    });

    it('allows back-to-back stays (checkout day = next checkin day)', async () => {
      await book('bob', day(13), day(15)).expect(201);
      await book('bob', day(8), day(10)).expect(201);
    });

    it.each([
      [
        'checkIn after checkOut',
        day(5),
        day(3),
        /checkIn must be before checkOut/,
      ],
      ['same day', day(5), day(5), /checkIn must be before checkOut/],
      ['in the past', day(-3), day(2), /cannot be in the past/],
      ['not ISO', '12/01/2030', day(3), /checkIn must be a valid ISO 8601/],
    ])('400 invalid dates: %s', async (_n, a, b, msg) => {
      const res = await book('alice', a, b).expect(400);
      expect(JSON.stringify(res.body.message)).toMatch(msg);
    });

    it('400 when guests exceed room capacity', async () => {
      const res = await book('alice', day(40), day(41), { guests: 3 }).expect(
        400,
      );
      expect(res.body.message).toMatch(/fits at most 2 guest/);
    });

    it('404 for unknown room', async () => {
      await request(app.getHttpServer())
        .post('/bookings')
        .set(auth('alice'))
        .send({ roomId: 999999, checkIn: day(1), checkOut: day(2) })
        .expect(404);
    });

    it('prevents double booking under concurrent requests', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          book('bob', day(50), day(52)).then((r) => r.status),
        ),
      );
      expect(results.filter((s) => s === 201)).toHaveLength(1);
      expect(results.filter((s) => s === 409)).toHaveLength(7);
    });

    it('users only see their own bookings; admins see all', async () => {
      const alice = await request(app.getHttpServer())
        .get('/bookings')
        .set(auth('alice'))
        .expect(200);
      expect(
        (alice.body.data as { user: { id: number } }[]).every(
          (b) => b.user.id === ids.alice,
        ),
      ).toBe(true);

      // userId filter is ignored for regular users
      const sneaky = await request(app.getHttpServer())
        .get(`/bookings?userId=${ids.bob}`)
        .set(auth('alice'))
        .expect(200);
      expect(sneaky.body.meta.total).toBe(alice.body.meta.total);

      const admin = await request(app.getHttpServer())
        .get(`/bookings?roomId=${room.id}&limit=100`)
        .set(auth('admin'))
        .expect(200);
      const owners = new Set(
        (admin.body.data as { user: { id: number } }[]).map((b) => b.user.id),
      );
      expect(owners).toEqual(new Set([ids.alice, ids.bob]));
    });

    it('403 when reading or cancelling someone else’s booking', async () => {
      await request(app.getHttpServer())
        .get(`/bookings/${aliceBookingId}`)
        .set(auth('bob'))
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/bookings/${aliceBookingId}/cancel`)
        .set(auth('bob'))
        .expect(403);
      await request(app.getHttpServer())
        .get(`/bookings/${aliceBookingId}`)
        .set(auth('alice'))
        .expect(200);
      await request(app.getHttpServer())
        .get('/bookings/999999')
        .set(auth('alice'))
        .expect(404);
    });

    it('only admins change status; transitions are enforced', async () => {
      await request(app.getHttpServer())
        .patch(`/bookings/${aliceBookingId}/status`)
        .set(auth('alice'))
        .send({ status: 'APPROVED' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/bookings/${aliceBookingId}/status`)
        .set(auth('admin'))
        .send({ status: 'BOGUS' })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/bookings/${aliceBookingId}/status`)
        .set(auth('admin'))
        .send({ status: 'PAID' })
        .expect(409);
      const ok = await request(app.getHttpServer())
        .patch(`/bookings/${aliceBookingId}/status`)
        .set(auth('admin'))
        .send({ status: 'APPROVED' })
        .expect(200);
      expect(ok.body.data.status).toBe('APPROVED');
    });

    it('owner cancels; the slot becomes free again', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/bookings/${aliceBookingId}/cancel`)
        .set(auth('alice'))
        .expect(200);
      expect(res.body.message).toBe('Booking cancelled successfully');
      expect(res.body.data.status).toBe('CANCELLED');

      await request(app.getHttpServer())
        .patch(`/bookings/${aliceBookingId}/cancel`)
        .set(auth('alice'))
        .expect(409);
      await book('bob', day(10), day(13)).expect(201);
    });

    it('rooms with bookings cannot be deleted (409), only deactivated', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/rooms/${room.id}`)
        .set(auth('admin'))
        .expect(409);
      expect(res.body.message).toMatch(/deactivate it instead/);
    });

    it('a deactivated room cannot be booked', async () => {
      const r = await createRoom({
        name: 'E2E Closed',
        capacity: 2,
        pricePerNight: 10,
      });
      await request(app.getHttpServer())
        .patch(`/rooms/${r.id}`)
        .set(auth('admin'))
        .send({ isActive: false })
        .expect(200);
      await request(app.getHttpServer())
        .post('/bookings')
        .set(auth('alice'))
        .send({ roomId: r.id, checkIn: day(1), checkOut: day(2) })
        .expect(404);
    });
  });

  describe('Search (FR-27..29)', () => {
    let free: { id: number };
    let busy: { id: number };
    let small: { id: number };

    beforeAll(async () => {
      const mk = (body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post('/rooms')
          .set(auth('admin'))
          .send(body)
          .then((r) => r.body.data as { id: number });
      free = await mk({
        name: 'E2E Search Free',
        capacity: 4,
        pricePerNight: 1,
      });
      busy = await mk({
        name: 'E2E Search Busy',
        capacity: 4,
        pricePerNight: 1,
      });
      small = await mk({
        name: 'E2E Search Small',
        capacity: 1,
        pricePerNight: 1,
      });
      await request(app.getHttpServer())
        .post('/bookings')
        .set(auth('alice'))
        .send({ roomId: busy.id, checkIn: day(20), checkOut: day(25) })
        .expect(201);
    });

    const search = (q: string) =>
      request(app.getHttpServer())
        .get(`/rooms/search?limit=100&${q}`)
        .expect(200)
        .then((r) => (r.body.data as { id: number }[]).map((x) => x.id));

    it('returns only rooms free for the whole range and big enough', async () => {
      const found = await search(
        `checkIn=${day(22)}&checkOut=${day(24)}&capacity=3`,
      );
      expect(found).toContain(free.id);
      expect(found).not.toContain(busy.id);
      expect(found).not.toContain(small.id);
    });

    it('a room is available again right at check-out', async () => {
      const found = await search(`checkIn=${day(25)}&checkOut=${day(27)}`);
      expect(found).toEqual(expect.arrayContaining([free.id, busy.id]));
    });

    it('400 when dates are missing or invalid', async () => {
      await request(app.getHttpServer()).get('/rooms/search').expect(400);
      await request(app.getHttpServer())
        .get(`/rooms/search?checkIn=${day(5)}&checkOut=${day(3)}`)
        .expect(400);
      await request(app.getHttpServer())
        .get('/rooms/search?checkIn=x&checkOut=y')
        .expect(400);
    });
  });

  describe('Notifications (FR-30, FR-31)', () => {
    it('records created / cancelled / status events for the booking owner', async () => {
      const res = await request(app.getHttpServer())
        .get('/notifications?limit=100')
        .set(auth('alice'))
        .expect(200);
      const types = (res.body.data as { type: string }[]).map((n) => n.type);
      expect(types).toEqual(
        expect.arrayContaining([
          'BOOKING_CREATED',
          'BOOKING_STATUS_CHANGED',
          'BOOKING_CANCELLED',
        ]),
      );
      expect(
        (res.body.data as { userId: number }[]).every(
          (n) => n.userId === ids.alice,
        ),
      ).toBe(true);
      expect(res.body.meta.unreadCount).toBeGreaterThan(0);
    });

    it('marks one / all as read; cannot touch others’ notifications', async () => {
      const list = await request(app.getHttpServer())
        .get('/notifications?unread=true')
        .set(auth('alice'))
        .expect(200);
      const id = (list.body.data as { id: number }[])[0].id;

      await request(app.getHttpServer())
        .patch(`/notifications/${id}/read`)
        .set(auth('bob'))
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/notifications/${id}/read`)
        .set(auth('alice'))
        .expect(200)
        .expect((r) => expect(r.body.data.isRead).toBe(true));

      await request(app.getHttpServer())
        .patch('/notifications/read-all')
        .set(auth('alice'))
        .expect(200);
      const after = await request(app.getHttpServer())
        .get('/notifications?unread=true')
        .set(auth('alice'))
        .expect(200);
      expect(after.body.meta.total).toBe(0);
      expect(after.body.meta.unreadCount).toBe(0);
    });

    it('401 without token', async () => {
      await request(app.getHttpServer()).get('/notifications').expect(401);
    });
  });
});
