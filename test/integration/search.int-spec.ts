/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped */
// FR-27–29: search returns only rooms truly available for the range.
import { BookingStatus, Role } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { resetTestState } from '../utils/db-cleanup';
import { Actor, createActor, createRoom, stay } from '../utils/factories';
import { isoDateTime } from '../utils/fixtures';
import { createTestApp, http, TestApp, waitForRedis } from '../utils/test-app';

describe('Search & availability (integration)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let user: Actor;

  /** GET /rooms/search for days [inDays, outDays) from today; returns room ids. */
  async function search(inDays: number, outDays: number, extra = '') {
    const { checkIn, checkOut } = stay(inDays, outDays);
    const res = await http(app)
      .get(
        `/rooms/search?checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(checkOut)}${extra}`,
      )
      .expect(200);
    return (res.body.data as { id: number }[])
      .map((r) => r.id)
      .sort((a, b) => a - b);
  }

  /** Inserts a booking directly, bypassing the API's own conflict check. */
  function insertBooking(
    roomId: number,
    inDays: number,
    outDays: number,
    status: BookingStatus = BookingStatus.PENDING,
  ) {
    return prisma.booking.create({
      data: {
        userId: user.id,
        roomId,
        checkIn: new Date(isoDateTime(inDays)),
        checkOut: new Date(isoDateTime(outDays)),
        totalPrice: 1000,
        status,
      },
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetTestState({
      db: prisma,
      cache: (await waitForRedis(app)).client,
    });
    user = await createActor(app, Role.USER);
  });
  afterAll(() => app.close());

  it('IT-SRCH-01 date range -> only rooms with no overlapping active booking', async () => {
    const booked = await createRoom(app);
    const free = await createRoom(app);
    await insertBooking(booked.id, 10, 13);

    expect(await search(10, 13)).toEqual([free.id]); // identical range
    expect(await search(11, 12)).toEqual([free.id]); // inside
    expect(await search(8, 11)).toEqual([free.id]); // overlaps the start
    expect(await search(12, 15)).toEqual([free.id]); // overlaps the end
    expect(await search(9, 14)).toEqual([free.id]); // encloses it
    expect(await search(20, 22)).toEqual([booked.id, free.id]); // other dates
  });

  it.each([BookingStatus.PENDING, BookingStatus.APPROVED, BookingStatus.PAID])(
    'IT-SRCH-01b a %s booking blocks the room',
    async (status) => {
      const room = await createRoom(app);
      await insertBooking(room.id, 10, 12, status);
      expect(await search(10, 12)).toEqual([]);
    },
  );

  it('IT-SRCH-02 capacity filter -> only rooms that fit at least that many guests', async () => {
    const small = await createRoom(app, { capacity: 2 });
    const large = await createRoom(app, { capacity: 4 });
    expect(await search(5, 6, '&capacity=2')).toEqual([small.id, large.id]);
    expect(await search(5, 6, '&capacity=3')).toEqual([large.id]);
    expect(await search(5, 6, '&capacity=5')).toEqual([]);
  });

  it('IT-SRCH-03 date range and capacity are applied together', async () => {
    const smallFree = await createRoom(app, { capacity: 2 });
    const largeBooked = await createRoom(app, { capacity: 4 });
    const largeFree = await createRoom(app, { capacity: 4 });
    await insertBooking(largeBooked.id, 10, 12);

    expect(await search(10, 12, '&capacity=3')).toEqual([largeFree.id]);
    expect(await search(10, 12, '&capacity=1')).toEqual([
      smallFree.id,
      largeFree.id,
    ]);
  });

  it('IT-SRCH-04 deactivated rooms are never returned (not even with includeInactive)', async () => {
    const active = await createRoom(app);
    await createRoom(app, { isActive: false });
    expect(await search(5, 6)).toEqual([active.id]);
    expect(await search(5, 6, '&includeInactive=true')).toEqual([active.id]);
  });

  it('IT-SRCH-05 a room whose only bookings are CANCELLED is returned', async () => {
    const room = await createRoom(app);
    await insertBooking(room.id, 10, 12, BookingStatus.CANCELLED);
    expect(await search(10, 12)).toEqual([room.id]);
  });

  it('IT-SRCH-06 back-to-back with an existing booking is returned (stays are [checkIn, checkOut))', async () => {
    const room = await createRoom(app);
    await insertBooking(room.id, 10, 12);
    expect(await search(12, 14)).toEqual([room.id]); // starts at its check-out
    expect(await search(8, 10)).toEqual([room.id]); // ends at its check-in
  });

  it.each([
    ['missing checkIn', `checkOut=${isoDateTime(3)}`, /checkIn/],
    ['missing checkOut', `checkIn=${isoDateTime(3)}`, /checkOut/],
    [
      'reversed range',
      `checkIn=${isoDateTime(5)}&checkOut=${isoDateTime(3)}`,
      /checkIn must be before checkOut/,
    ],
    [
      'equal dates',
      `checkIn=${isoDateTime(5)}&checkOut=${isoDateTime(5)}`,
      /checkIn must be before checkOut/,
    ],
    ['not a date', 'checkIn=tomorrow&checkOut=later', /ISO 8601/],
    [
      'check-in in the past',
      `checkIn=${isoDateTime(-2)}&checkOut=${isoDateTime(2)}`,
      /checkIn cannot be in the past/,
    ],
    [
      'stay over 30 nights',
      `checkIn=${isoDateTime(1)}&checkOut=${isoDateTime(40)}`,
      /cannot be longer than 30 nights/,
    ],
  ])(
    'IT-SRCH-07 %s -> 400 with a clear message',
    async (_c, query, message) => {
      const res = await http(app)
        .get(`/rooms/search?${query.replace(/\+/g, '%2B')}`)
        .expect(400);
      expect(JSON.stringify(res.body.message)).toMatch(message);
    },
  );
});
