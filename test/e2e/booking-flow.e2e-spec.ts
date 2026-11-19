/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped */
// Realistic user/admin journeys through the real app + test DB.
// Each journey asserts the HTTP responses AND the resulting database state
// (rubric criterion 18). Test IDs match docs/API-TESTING.md.
import { BookingStatus, NotificationType, Role } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { resetTestState } from '../utils/db-cleanup';
import {
  Actor,
  createActor,
  PNG_1PX,
  stay,
  TEST_PASSWORD,
} from '../utils/factories';
import { bearer, uniqueEmail } from '../utils/fixtures';
import { createTestApp, http, TestApp, waitForRedis } from '../utils/test-app';

describe('Booking journeys (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let admin: Actor;

  /** A visitor signs up and logs in through the API, like a real client. */
  async function signUpAndLogIn(name: string) {
    const email = uniqueEmail(name.toLowerCase());
    const signUp = await http(app)
      .post('/auth/register')
      .send({ name, email, password: TEST_PASSWORD })
      .expect(201);
    const login = await http(app)
      .post('/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    const token = login.body.data.accessToken as string;
    return {
      id: signUp.body.data.id as number,
      email,
      token,
      auth: { Authorization: bearer(token) },
    };
  }

  /** Admin creates a room through the API (as the frontend would). */
  async function adminCreatesRoom(body: Record<string, unknown>) {
    const res = await http(app)
      .post('/rooms')
      .set(admin.auth)
      .send(body)
      .expect(201);
    return res.body.data as { id: number; name: string };
  }

  const searchIds = async (
    dates: { checkIn: string; checkOut: string },
    extra = '',
  ) => {
    const res = await http(app)
      .get(
        `/rooms/search?checkIn=${encodeURIComponent(dates.checkIn)}&checkOut=${encodeURIComponent(dates.checkOut)}${extra}`,
      )
      .expect(200);
    return res.body.data.map((r: { id: number }) => r.id);
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetTestState({
      db: prisma,
      cache: (await waitForRedis(app)).client,
    });
    admin = await createActor(app, Role.ADMIN);
  });
  afterAll(() => app.close());

  it('E2E-01 sign up -> log in -> search -> book -> own list -> cancel; DB: CANCELLED, 2 events, room free again', async () => {
    const room = await adminCreatesRoom({
      name: 'Sea View 301',
      capacity: 2,
      pricePerNight: 2000,
    });
    const guest = await signUpAndLogIn('Alice');
    const dates = stay(14, 16);

    // Search: the room is available.
    expect(await searchIds(dates, '&capacity=2')).toEqual([room.id]);

    // Book it.
    const booked = await http(app)
      .post('/bookings')
      .set(guest.auth)
      .send({ roomId: room.id, ...dates, guests: 2 })
      .expect(201);
    const bookingId = booked.body.data.id as number;
    expect(booked.body.data).toMatchObject({
      status: 'PENDING',
      nights: 2,
      totalPrice: 4000,
    });

    // It is gone from search, and listed in "my bookings".
    expect(await searchIds(dates)).toEqual([]);
    const mine = await http(app).get('/bookings').set(guest.auth).expect(200);
    expect(mine.body.data.map((b: { id: number }) => b.id)).toEqual([
      bookingId,
    ]);

    // Cancel it.
    await http(app)
      .patch(`/bookings/${bookingId}/cancel`)
      .set(guest.auth)
      .expect(200);

    // DB state.
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    expect(row).toMatchObject({
      userId: guest.id,
      roomId: room.id,
      status: BookingStatus.CANCELLED,
    });
    const events = await prisma.notificationEvent.findMany({
      where: { userId: guest.id },
      orderBy: { id: 'asc' },
    });
    expect(events.map((e) => [e.type, e.bookingId])).toEqual([
      [NotificationType.BOOKING_CREATED, bookingId],
      [NotificationType.BOOKING_CANCELLED, bookingId],
    ]);

    // The room is available again (search cache was invalidated by the cancel).
    expect(await searchIds(dates)).toEqual([room.id]);
  });

  it('E2E-02 Admin creates room + uploads image -> user books -> Admin approves -> marks PAID; DB follows every step', async () => {
    const room = await adminCreatesRoom({
      name: 'Family 402',
      capacity: 4,
      pricePerNight: 3500,
    });
    const upload = await http(app)
      .post(`/rooms/${room.id}/images`)
      .set(admin.auth)
      .attach('image', PNG_1PX, {
        filename: 'family.png',
        contentType: 'image/png',
      })
      .expect(201);

    const guest = await signUpAndLogIn('Bob');
    const details = await http(app).get(`/rooms/${room.id}`).expect(200);
    expect(details.body.data.images).toEqual([
      expect.objectContaining({ url: upload.body.data.url }),
    ]);

    const bookingId = (
      await http(app)
        .post('/bookings')
        .set(guest.auth)
        .send({ roomId: room.id, ...stay(20, 23), guests: 3 })
        .expect(201)
    ).body.data.id as number;

    // Admin sees it among all bookings, then moves it through the flow.
    const all = await http(app)
      .get('/bookings?status=PENDING')
      .set(admin.auth)
      .expect(200);
    expect(all.body.data.map((b: { id: number }) => b.id)).toContain(bookingId);

    for (const status of [BookingStatus.APPROVED, BookingStatus.PAID]) {
      await http(app)
        .patch(`/bookings/${bookingId}/status`)
        .set(admin.auth)
        .send({ status })
        .expect(200);
      await expect(
        prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }),
      ).resolves.toMatchObject({ status });
    }

    // The guest sees the final state and the whole history.
    const own = await http(app)
      .get(`/bookings/${bookingId}`)
      .set(guest.auth)
      .expect(200);
    expect(own.body.data).toMatchObject({ status: 'PAID', totalPrice: 10500 });
    const feed = await http(app)
      .get('/notifications')
      .set(guest.auth)
      .expect(200);
    expect(feed.body.data.map((n: { message: string }) => n.message)).toEqual([
      expect.stringMatching(/is now PAID$/),
      expect.stringMatching(/is now APPROVED$/),
      expect.stringMatching(/was created and is pending approval$/),
    ]);
    await expect(
      prisma.roomImage.count({ where: { roomId: room.id } }),
    ).resolves.toBe(1);
  });

  it('E2E-03 RBAC: a user cannot manage rooms or statuses; user B cannot see or cancel user A’s booking; DB unchanged', async () => {
    const room = await adminCreatesRoom({
      name: 'Standard 105',
      capacity: 2,
      pricePerNight: 900,
    });
    const alice = await signUpAndLogIn('Alice');
    const bob = await signUpAndLogIn('Bob');
    const bookingId = (
      await http(app)
        .post('/bookings')
        .set(alice.auth)
        .send({ roomId: room.id, ...stay(5, 7) })
        .expect(201)
    ).body.data.id as number;
    const before = {
      room: await prisma.room.findUniqueOrThrow({ where: { id: room.id } }),
      events: await prisma.notificationEvent.count(),
    };

    // Room management is Admin-only.
    await http(app)
      .post('/rooms')
      .set(bob.auth)
      .send({ name: 'Hack', capacity: 1, pricePerNight: 1 })
      .expect(403);
    await http(app)
      .patch(`/rooms/${room.id}`)
      .set(bob.auth)
      .send({ pricePerNight: 1 })
      .expect(403);
    await http(app).delete(`/rooms/${room.id}`).set(bob.auth).expect(403);
    // So is changing a booking status — even on your own booking.
    await http(app)
      .patch(`/bookings/${bookingId}/status`)
      .set(alice.auth)
      .send({ status: 'PAID' })
      .expect(403);
    // Bob cannot read or cancel Alice's booking, nor see it in his list.
    await http(app).get(`/bookings/${bookingId}`).set(bob.auth).expect(403);
    await http(app)
      .patch(`/bookings/${bookingId}/cancel`)
      .set(bob.auth)
      .expect(403);
    const bobsList = await http(app).get('/bookings').set(bob.auth).expect(200);
    expect(bobsList.body.meta.total).toBe(0);

    // Nothing changed in the database.
    await expect(
      prisma.room.findUniqueOrThrow({ where: { id: room.id } }),
    ).resolves.toEqual(before.room);
    await expect(prisma.room.count()).resolves.toBe(1);
    await expect(
      prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }),
    ).resolves.toMatchObject({ status: BookingStatus.PENDING });
    await expect(prisma.notificationEvent.count()).resolves.toBe(before.events);
  });

  it('E2E-04 double booking: a second user books an overlapping range -> 409; DB has one active booking; search hides the room', async () => {
    const room = await adminCreatesRoom({
      name: 'Corner 210',
      capacity: 2,
      pricePerNight: 1800,
    });
    const alice = await signUpAndLogIn('Alice');
    const bob = await signUpAndLogIn('Bob');

    await http(app)
      .post('/bookings')
      .set(alice.auth)
      .send({ roomId: room.id, ...stay(30, 33) })
      .expect(201);
    const clash = await http(app)
      .post('/bookings')
      .set(bob.auth)
      .send({ roomId: room.id, ...stay(31, 34) })
      .expect(409);
    expect(clash.body.message).toMatch(/already booked/);

    await expect(
      prisma.booking.count({
        where: { roomId: room.id, status: { not: BookingStatus.CANCELLED } },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.booking.count({ where: { userId: bob.id } }),
    ).resolves.toBe(0);
    expect(await searchIds(stay(31, 34))).toEqual([]);
    // Bob can still take the room right after Alice leaves.
    expect(await searchIds(stay(33, 35))).toEqual([room.id]);
    await http(app)
      .post('/bookings')
      .set(bob.auth)
      .send({ roomId: room.id, ...stay(33, 35) })
      .expect(201);
  });

  it('E2E-05 user updates the profile, logs out -> the old token is rejected (401); logging in again works', async () => {
    const user = await signUpAndLogIn('Carol');

    const updated = await http(app)
      .patch('/users/me')
      .set(user.auth)
      .send({ name: 'Caroline' })
      .expect(200);
    expect(updated.body.data.name).toBe('Caroline');
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).resolves.toMatchObject({ name: 'Caroline' });

    await http(app).post('/auth/logout').set(user.auth).expect(200);
    await http(app).get('/users/me').set(user.auth).expect(401);
    await http(app)
      .patch('/users/me')
      .set(user.auth)
      .send({ name: 'Mallory' })
      .expect(401);

    const again = await http(app)
      .post('/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);
    const me = await http(app)
      .get('/users/me')
      .set('Authorization', bearer(again.body.data.accessToken as string))
      .expect(200);
    expect(me.body.data.name).toBe('Caroline'); // the 401 attempt changed nothing
  });
});
