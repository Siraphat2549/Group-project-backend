/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped */
// FR-30–31 notifications · FR-36 health with real deps.
// Rate limiting (IT-RL-*) lives in rate-limit.int-spec.ts: it needs low
// limits configured before the app module is loaded.
import { NotificationType, Role } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { resetTestState } from '../utils/db-cleanup';
import { Actor, book, createActor, createRoom, stay } from '../utils/factories';
import { createTestApp, http, TestApp, waitForRedis } from '../utils/test-app';

describe('Notifications & health (integration)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let admin: Actor;
  let alice: Actor;
  let bob: Actor;
  let roomId: number;

  const notificationsOf = (actor: Actor, query = '') =>
    http(app).get(`/notifications${query}`).set(actor.auth).expect(200);
  const typesOf = (res: { body: { data: { type: string }[] } }) =>
    res.body.data.map((n) => n.type);

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
    alice = await createActor(app, Role.USER, 'Alice');
    bob = await createActor(app, Role.USER, 'Bob');
    roomId = (await createRoom(app, { name: 'Garden Suite' })).id;
  });
  afterAll(() => app.close());

  it('IT-NOTIF-01 creating a booking records a BOOKING_CREATED event for that user', async () => {
    const booking = (await book(app, alice, roomId, stay(4, 6)).expect(201))
      .body.data;

    const res = await notificationsOf(alice);
    expect(res.body.data).toEqual([
      expect.objectContaining({
        userId: alice.id,
        bookingId: booking.id,
        type: NotificationType.BOOKING_CREATED,
        isRead: false,
        message: expect.stringMatching(
          /^Booking #\d+ for "Garden Suite" .+ was created and is pending approval$/,
        ),
      }),
    ]);
    expect(res.body.meta).toMatchObject({ total: 1, unreadCount: 1 });
    await expect(
      prisma.notificationEvent.count({
        where: { userId: alice.id, bookingId: booking.id },
      }),
    ).resolves.toBe(1);
  });

  it('IT-NOTIF-02 cancelling (by the user or an Admin) records BOOKING_CANCELLED for the owner; status changes are recorded too', async () => {
    const own = (await book(app, alice, roomId, stay(4, 6)).expect(201)).body
      .data.id;
    const other = (await book(app, alice, roomId, stay(7, 9)).expect(201)).body
      .data.id;

    await http(app)
      .patch(`/bookings/${own}/cancel`)
      .set(alice.auth)
      .expect(200);
    await http(app)
      .patch(`/bookings/${other}/status`)
      .set(admin.auth)
      .send({ status: 'APPROVED' })
      .expect(200);
    await http(app)
      .patch(`/bookings/${other}/cancel`)
      .set(admin.auth)
      .expect(200);

    const res = await notificationsOf(alice);
    // Newest first.
    expect(typesOf(res)).toEqual([
      NotificationType.BOOKING_CANCELLED,
      NotificationType.BOOKING_STATUS_CHANGED,
      NotificationType.BOOKING_CANCELLED,
      NotificationType.BOOKING_CREATED,
      NotificationType.BOOKING_CREATED,
    ]);
    expect(res.body.data[0].message).toMatch(/was cancelled by an admin$/);
    expect(res.body.data[1].message).toMatch(/is now APPROVED$/);
    expect(res.body.data[2].message).not.toMatch(/by an admin/);
    // The admin's actions never land in the admin's own feed.
    await expect(
      prisma.notificationEvent.count({ where: { userId: admin.id } }),
    ).resolves.toBe(0);
  });

  it('IT-NOTIF-03 the API returns only the caller’s events; no token -> 401; read flags are per user', async () => {
    await book(app, alice, roomId, stay(4, 6)).expect(201);
    await book(app, bob, roomId, stay(7, 9)).expect(201);

    await http(app).get('/notifications').expect(401);
    const bobs = await notificationsOf(bob);
    expect(bobs.body.data.map((n: { userId: number }) => n.userId)).toEqual([
      bob.id,
    ]);

    // Bob cannot mark Alice's notification; Alice can.
    const aliceEvent = await prisma.notificationEvent.findFirstOrThrow({
      where: { userId: alice.id },
    });
    await http(app)
      .patch(`/notifications/${aliceEvent.id}/read`)
      .set(bob.auth)
      .expect(404);
    await http(app)
      .patch(`/notifications/${aliceEvent.id}/read`)
      .set(alice.auth)
      .expect(200);
    await expect(
      prisma.notificationEvent.findUniqueOrThrow({
        where: { id: aliceEvent.id },
      }),
    ).resolves.toMatchObject({ isRead: true });

    const unread = await notificationsOf(alice, '?unread=true');
    expect(unread.body.data).toEqual([]);
    expect(unread.body.meta.unreadCount).toBe(0);
    await expect(
      prisma.notificationEvent.count({
        where: { userId: bob.id, isRead: false },
      }),
    ).resolves.toBe(1);
  });

  it('IT-NOTIF-04 mark all as read -> only the caller’s unread events', async () => {
    await book(app, alice, roomId, stay(4, 6)).expect(201);
    await book(app, alice, roomId, stay(7, 9)).expect(201);
    await book(app, bob, roomId, stay(10, 12)).expect(201);

    const res = await http(app)
      .patch('/notifications/read-all')
      .set(alice.auth)
      .expect(200);
    expect(res.body).toEqual({
      message: '2 notification(s) marked as read',
      data: { updated: 2 },
    });
    await expect(
      prisma.notificationEvent.count({ where: { isRead: false } }),
    ).resolves.toBe(1); // Bob's
  });

  it('IT-HLTH-01 GET /health with the test MySQL + Redis up -> 200, every check "up", no credentials', async () => {
    const res = await http(app).get('/health').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      info: {
        app: { status: 'up' },
        database: { status: 'up' },
        redis: { status: 'up' },
      },
      error: {},
    });
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('hotel_test'); // DB user / password
    expect(json).not.toContain('mysql://');
    expect(json).not.toContain('redis://');

    await http(app).get('/health/live').expect(200);
  });
});
