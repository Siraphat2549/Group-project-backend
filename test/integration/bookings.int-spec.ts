/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped */
// FR-17–26 · date validation (FR-19) · no double booking (FR-20) · NFR-2.
import { BookingStatus, Role } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { resetTestState } from '../utils/db-cleanup';
import { Actor, book, createActor, createRoom, stay } from '../utils/factories';
import { createTestApp, http, TestApp, waitForRedis } from '../utils/test-app';

describe('Bookings (integration)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let admin: Actor;
  let alice: Actor;
  let bob: Actor;
  let roomId: number;

  const dbStatus = async (id: number) =>
    (await prisma.booking.findUniqueOrThrow({ where: { id } })).status;
  const activeCount = (room = roomId) =>
    prisma.booking.count({
      where: { roomId: room, status: { not: BookingStatus.CANCELLED } },
    });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetTestState({
      db: prisma,
      cache: (await waitForRedis(app)).client,
    });
    admin = await createActor(app, Role.ADMIN, 'Admin');
    alice = await createActor(app, Role.USER, 'Alice');
    bob = await createActor(app, Role.USER, 'Bob');
    roomId = (
      await createRoom(app, {
        name: 'Deluxe',
        capacity: 2,
        pricePerNight: 1500,
      })
    ).id;
  });
  afterAll(() => app.close());

  describe('create', () => {
    it('IT-BK-01 POST /bookings -> 201, PENDING, total = nights × price; stored with user, room and date-times', async () => {
      const dates = stay(10, 13);
      const res = await book(app, alice, roomId, dates, 2).expect(201);

      expect(res.body.message).toBe('Booking created successfully');
      expect(res.body.data).toMatchObject({
        status: 'PENDING',
        checkIn: dates.checkIn,
        checkOut: dates.checkOut,
        nights: 3,
        guests: 2,
        totalPrice: 4500,
        room: { id: roomId, name: 'Deluxe', pricePerNight: 1500 },
        user: { id: alice.id, email: alice.email },
      });
      const row = await prisma.booking.findUniqueOrThrow({
        where: { id: res.body.data.id },
      });
      expect(row).toMatchObject({
        userId: alice.id,
        roomId,
        guests: 2,
        status: BookingStatus.PENDING,
        checkIn: new Date(dates.checkIn),
        checkOut: new Date(dates.checkOut),
      });
      expect(row.totalPrice.toNumber()).toBe(4500);
    });

    it('IT-BK-02 check-out equal to or before check-in -> 400; nothing stored', async () => {
      for (const dates of [stay(5, 5), stay(6, 4)]) {
        const res = await book(app, alice, roomId, dates).expect(400);
        expect(res.body.message).toBe('checkIn must be before checkOut');
      }
      await expect(prisma.booking.count()).resolves.toBe(0);
    });

    it('IT-BK-03 check-in in the past -> 400', async () => {
      const res = await book(app, alice, roomId, stay(-1, 2)).expect(400);
      expect(res.body.message).toBe('checkIn cannot be in the past');
      await expect(prisma.booking.count()).resolves.toBe(0);
    });

    it.each([
      // `undefined` is dropped by JSON, so the field is really absent.
      [
        'missing checkIn',
        { checkIn: undefined },
        /checkIn must be a valid ISO 8601 date string/,
      ],
      [
        'missing checkOut',
        { checkOut: undefined },
        /checkOut must be a valid ISO 8601 date string/,
      ],
      [
        'words instead of dates',
        { checkIn: 'tomorrow', checkOut: 'friday' },
        /ISO 8601/,
      ],
      [
        'impossible date',
        { checkIn: '2026-13-45', checkOut: '2026-14-01' },
        /ISO 8601/,
      ],
      ['missing roomId', { roomId: undefined }, /roomId/],
      ['guests above the room capacity', { guests: 3 }, /fits at most 2 guest/],
    ])(
      'IT-BK-04 %s -> 400 with a clear message',
      async (_c, override, message) => {
        const res = await http(app)
          .post('/bookings')
          .set(alice.auth)
          .send({ roomId, ...stay(3, 5), ...override })
          .expect(400);
        expect(JSON.stringify(res.body.message)).toMatch(message);
        await expect(prisma.booking.count()).resolves.toBe(0);
      },
    );

    it('IT-BK-05 unknown room -> 404; deactivated room -> 404', async () => {
      const unknown = await book(app, alice, 999999, stay(3, 5)).expect(404);
      expect(unknown.body.message).toBe('Room with id 999999 not found');

      const inactive = await createRoom(app, { isActive: false });
      await book(app, alice, inactive.id, stay(3, 5)).expect(404);
      await expect(prisma.booking.count()).resolves.toBe(0);
    });

    it('IT-BK-06 no token -> 401', async () => {
      await http(app)
        .post('/bookings')
        .send({ roomId, ...stay(3, 5) })
        .expect(401);
      await expect(prisma.booking.count()).resolves.toBe(0);
    });
  });

  describe('double booking (FR-20)', () => {
    beforeEach(async () => {
      await book(app, alice, roomId, stay(10, 13)).expect(201);
    });

    it('IT-BK-10 overlapping range on the same room -> 409 with a clear message', async () => {
      for (const dates of [stay(12, 15), stay(8, 11)]) {
        const res = await book(app, bob, roomId, dates).expect(409);
        expect(res.body.message).toMatch(
          /^Room "Deluxe" is already booked from .+; choose other dates or another room$/,
        );
      }
      await expect(activeCount()).resolves.toBe(1);
    });

    it.each([
      ['inside', 11, 12],
      ['enclosing', 9, 14],
      ['identical', 10, 13],
    ])(
      'IT-BK-11 range %s an existing booking -> 409',
      async (_c, inD, outD) => {
        await book(app, bob, roomId, stay(inD, outD)).expect(409);
        await expect(activeCount()).resolves.toBe(1);
      },
    );

    it('IT-BK-12 back-to-back (new check-in == existing check-out, and vice versa) -> 201', async () => {
      await book(app, bob, roomId, stay(13, 15)).expect(201);
      await book(app, bob, roomId, stay(8, 10)).expect(201);
      await expect(activeCount()).resolves.toBe(3);
    });

    it('IT-BK-13 same range on a different room -> 201', async () => {
      const other = await createRoom(app);
      await book(app, bob, other.id, stay(10, 13)).expect(201);
    });

    it('IT-BK-14 the range of a CANCELLED booking is free again -> 201', async () => {
      const existing = await prisma.booking.findFirstOrThrow({
        where: { roomId },
      });
      await http(app)
        .patch(`/bookings/${existing.id}/cancel`)
        .set(alice.auth)
        .expect(200);
      await book(app, bob, roomId, stay(10, 13)).expect(201);
      await expect(activeCount()).resolves.toBe(1);
    });
  });

  it('IT-BK-15 concurrent requests for the same room/range -> exactly one 201, the rest 409; one row in DB', async () => {
    const users = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        createActor(app, Role.USER, `Racer ${i}`),
      ),
    );
    const dates = stay(20, 22);

    const results = await Promise.all(
      users.map((u) => book(app, u, roomId, dates)),
    );
    const statuses = results.map((r) => r.status).sort();

    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    await expect(prisma.booking.count({ where: { roomId } })).resolves.toBe(1);
    // ...and exactly one "created" event was recorded.
    await expect(prisma.notificationEvent.count()).resolves.toBe(1);
  });

  describe('ownership & admin', () => {
    let aliceBooking: number;
    let bobBooking: number;

    beforeEach(async () => {
      aliceBooking = (await book(app, alice, roomId, stay(3, 5)).expect(201))
        .body.data.id;
      await book(app, alice, roomId, stay(6, 8)).expect(201);
      bobBooking = (await book(app, bob, roomId, stay(9, 11)).expect(201)).body
        .data.id;
    });

    it('IT-BK-20 GET /bookings returns only the caller’s bookings (userId filter ignored)', async () => {
      const res = await http(app)
        .get(`/bookings?userId=${bob.id}`)
        .set(alice.auth)
        .expect(200);
      expect(res.body.meta.total).toBe(2);
      expect(
        res.body.data.map((b: { user: { id: number } }) => b.user.id),
      ).toEqual([alice.id, alice.id]);
    });

    it('IT-BK-21 GET /bookings/:id of an own booking -> 200', async () => {
      const res = await http(app)
        .get(`/bookings/${aliceBooking}`)
        .set(alice.auth)
        .expect(200);
      expect(res.body.data).toMatchObject({
        id: aliceBooking,
        status: 'PENDING',
      });
    });

    it('IT-BK-22 GET /bookings/:id of another user’s booking -> 403', async () => {
      const res = await http(app)
        .get(`/bookings/${aliceBooking}`)
        .set(bob.auth)
        .expect(403);
      expect(res.body.message).toBe('You can only access your own bookings');
    });

    it('IT-BK-23 unknown booking id -> 404', async () => {
      const res = await http(app)
        .get('/bookings/999999')
        .set(alice.auth)
        .expect(404);
      expect(res.body.message).toBe('Booking with id 999999 not found');
    });

    it('IT-BK-24 user cancels an own booking -> 200, CANCELLED in the DB', async () => {
      const res = await http(app)
        .patch(`/bookings/${aliceBooking}/cancel`)
        .set(alice.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        message: 'Booking cancelled successfully',
        data: { status: 'CANCELLED' },
      });
      await expect(dbStatus(aliceBooking)).resolves.toBe(
        BookingStatus.CANCELLED,
      );

      const again = await http(app)
        .patch(`/bookings/${aliceBooking}/cancel`)
        .set(alice.auth)
        .expect(409);
      expect(again.body.message).toBe('Booking is already CANCELLED');
    });

    it('IT-BK-25 user cancels another user’s booking -> 403; DB unchanged', async () => {
      await http(app)
        .patch(`/bookings/${aliceBooking}/cancel`)
        .set(bob.auth)
        .expect(403);
      await expect(dbStatus(aliceBooking)).resolves.toBe(BookingStatus.PENDING);
    });

    it('IT-BK-26 Admin lists all bookings of all users; can filter by userId', async () => {
      const all = await http(app).get('/bookings').set(admin.auth).expect(200);
      expect(all.body.meta.total).toBe(3);

      const bobs = await http(app)
        .get(`/bookings?userId=${bob.id}`)
        .set(admin.auth)
        .expect(200);
      expect(bobs.body.data.map((b: { id: number }) => b.id)).toEqual([
        bobBooking,
      ]);
    });

    it('IT-BK-27 Admin sets APPROVED, then PAID -> 200; DB updated at each step', async () => {
      const setStatus = (status: string) =>
        http(app)
          .patch(`/bookings/${aliceBooking}/status`)
          .set(admin.auth)
          .send({ status });

      const approved = await setStatus('APPROVED').expect(200);
      expect(approved.body.message).toBe('Booking status updated to APPROVED');
      await expect(dbStatus(aliceBooking)).resolves.toBe(
        BookingStatus.APPROVED,
      );

      await setStatus('PAID').expect(200);
      await expect(dbStatus(aliceBooking)).resolves.toBe(BookingStatus.PAID);
    });

    it('IT-BK-28 a user cannot cancel a PAID booking (409); an Admin can (200)', async () => {
      for (const status of ['APPROVED', 'PAID']) {
        await http(app)
          .patch(`/bookings/${aliceBooking}/status`)
          .set(admin.auth)
          .send({ status })
          .expect(200);
      }
      const denied = await http(app)
        .patch(`/bookings/${aliceBooking}/cancel`)
        .set(alice.auth)
        .expect(409);
      expect(denied.body.message).toBe(
        'A PAID booking can only be cancelled by an admin',
      );

      await http(app)
        .patch(`/bookings/${aliceBooking}/cancel`)
        .set(admin.auth)
        .expect(200);
      await expect(dbStatus(aliceBooking)).resolves.toBe(
        BookingStatus.CANCELLED,
      );
    });

    it('IT-BK-29 invalid status value -> 400; illegal transition -> 409; DB unchanged', async () => {
      const set = (status: string) =>
        http(app)
          .patch(`/bookings/${aliceBooking}/status`)
          .set(admin.auth)
          .send({ status });

      const invalid = await set('DONE').expect(400);
      expect(JSON.stringify(invalid.body.message)).toMatch(
        /status must be one of: PENDING, APPROVED, CANCELLED, PAID/,
      );

      const skip = await set('PAID').expect(409);
      expect(skip.body.message).toMatch(
        /^Cannot change booking status from PENDING to PAID/,
      );
      await expect(dbStatus(aliceBooking)).resolves.toBe(BookingStatus.PENDING);

      await set('CANCELLED').expect(200);
      await set('APPROVED').expect(409); // CANCELLED is final
      await expect(dbStatus(aliceBooking)).resolves.toBe(
        BookingStatus.CANCELLED,
      );
    });

    it('IT-BK-30 a regular user tries to set APPROVED / PAID -> 403; DB unchanged', async () => {
      for (const status of ['APPROVED', 'PAID']) {
        const res = await http(app)
          .patch(`/bookings/${aliceBooking}/status`)
          .set(alice.auth)
          .send({ status })
          .expect(403);
        expect(res.body.message).toBe('This action requires role: ADMIN');
      }
      await expect(dbStatus(aliceBooking)).resolves.toBe(BookingStatus.PENDING);
    });
  });
});
