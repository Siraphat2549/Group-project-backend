/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- jest mock call arguments are untyped */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, NotificationType, Prisma, Role } from '@prisma/client';
import { AuthUser } from '../auth/auth-user.interface';
import { BLOCKING_STATUSES } from '../common/utils/date-range';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { BookingsService } from './bookings.service';

const alice: AuthUser = { id: 1, email: 'alice@example.com', role: Role.USER };
const bob: AuthUser = { id: 2, email: 'bob@example.com', role: Role.USER };
const admin: AuthUser = { id: 9, email: 'admin@example.com', role: Role.ADMIN };

/**
 * Dates relative to ONE fixed "now", taken once when the file loads, so the
 * "not in the past" rule passes and stays are exact whole days. Reading the
 * clock per call made inDays(10) → inDays(12) occasionally 2 days + 1 ms,
 * which countNights() correctly rounds up to 3 nights (flaky on slow CI).
 */
const NOW = Date.now();
const inDays = (days: number) =>
  new Date(NOW + days * 86_400_000).toISOString();

const ROOM = {
  id: 10,
  name: 'Deluxe',
  description: null,
  capacity: 2,
  pricePerNight: new Prisma.Decimal(1500),
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function bookingRow(data: Partial<Record<string, unknown>> = {}) {
  return {
    id: 100,
    userId: alice.id,
    roomId: ROOM.id,
    checkIn: new Date(inDays(10)),
    checkOut: new Date(inDays(12)),
    guests: 1,
    totalPrice: new Prisma.Decimal(3000),
    status: BookingStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
    room: { id: ROOM.id, name: ROOM.name, pricePerNight: ROOM.pricePerNight },
    user: { id: alice.id, name: 'Alice', email: alice.email },
    ...data,
  };
}

function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: ROOM.id }]),
    room: { findUniqueOrThrow: jest.fn().mockResolvedValue(ROOM) },
    booking: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve(bookingRow(args.data)),
      ),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(),
    },
  };
  const prisma = {
    // Interactive transactions get `tx`; batch transactions get an array.
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: typeof tx) => Promise<unknown>)(tx)
        : Promise.all(arg as Promise<unknown>[]),
    ),
    booking: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn(),
    },
  };
  const notifications = { record: jest.fn().mockResolvedValue({}) };
  const service = new BookingsService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService,
  );
  return { service, prisma, tx, notifications };
}

const dto = (over: Record<string, unknown> = {}) => ({
  roomId: ROOM.id,
  checkIn: inDays(10),
  checkOut: inDays(12),
  ...over,
});

describe('BookingsService.create', () => {
  it('UT-BK-01 creates a booking: total = nights × price, default 1 guest, event in the same transaction', async () => {
    const { service, tx, notifications } = setup();

    const result = await service.create(alice, dto());

    const data = tx.booking.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: alice.id,
      roomId: ROOM.id,
      guests: 1,
    });
    expect((data.totalPrice as Prisma.Decimal).toNumber()).toBe(3000);
    expect(data).not.toHaveProperty('status'); // PENDING is the DB default
    expect(result).toMatchObject({ nights: 2, totalPrice: 3000 });

    expect(notifications.record).toHaveBeenCalledWith(
      tx, // same transaction client as the booking
      expect.objectContaining({
        userId: alice.id,
        bookingId: 100,
        type: NotificationType.BOOKING_CREATED,
      }),
    );
  });

  it('UT-CONF-00 locks the room row before the overlap check (no race between two requests)', async () => {
    const { service, tx } = setup();
    await service.create(alice, dto());

    const lockOrder = tx.$queryRaw.mock.invocationCallOrder[0];
    const checkOrder = tx.booking.findFirst.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(checkOrder);
    expect((tx.$queryRaw.mock.calls[0][0] as string[]).join('?')).toMatch(
      /FOR UPDATE/,
    );
  });

  it('UT-CONF-01 checks overlap as half-open [checkIn, checkOut) against active statuses only', async () => {
    const { service, tx } = setup();
    const body = dto();
    await service.create(alice, body);

    expect(tx.booking.findFirst.mock.calls[0][0].where).toEqual({
      roomId: ROOM.id,
      status: { in: BLOCKING_STATUSES },
      checkIn: { lt: new Date(body.checkOut) },
      checkOut: { gt: new Date(body.checkIn) },
    });
    expect(BLOCKING_STATUSES).not.toContain(BookingStatus.CANCELLED);
  });

  it('UT-CONF-02 409 when the room is already booked; nothing is created, no event', async () => {
    const { service, tx, notifications } = setup();
    tx.booking.findFirst.mockResolvedValue({
      checkIn: new Date(inDays(11)),
      checkOut: new Date(inDays(13)),
    });

    await expect(service.create(alice, dto())).rejects.toThrow(
      ConflictException,
    );
    await expect(service.create(alice, dto())).rejects.toThrow(
      /already booked/,
    );
    expect(tx.booking.create).not.toHaveBeenCalled();
    expect(notifications.record).not.toHaveBeenCalled();
  });

  it('UT-BK-02 404 for an unknown room (the lock finds no row)', async () => {
    const { service, tx } = setup();
    tx.$queryRaw.mockResolvedValue([]);
    await expect(service.create(alice, dto())).rejects.toThrow(
      NotFoundException,
    );
    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it('UT-BK-03 404 for a deactivated room', async () => {
    const { service, tx } = setup();
    tx.room.findUniqueOrThrow.mockResolvedValue({ ...ROOM, isActive: false });
    await expect(service.create(alice, dto())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('UT-BK-04 400 when guests exceed the room capacity', async () => {
    const { service } = setup();
    await expect(service.create(alice, dto({ guests: 3 }))).rejects.toThrow(
      /fits at most 2 guest/,
    );
  });

  it.each([
    ['check-out before check-in', inDays(12), inDays(10)],
    ['check-out equal to check-in', inDays(10), inDays(10)],
    ['check-in in the past', inDays(-1), inDays(2)],
    ['stay longer than 30 nights', inDays(1), inDays(40)],
  ])(
    'UT-DATE %s -> 400 before touching the database',
    async (_case, checkIn, checkOut) => {
      const { service, prisma } = setup();
      await expect(
        service.create(alice, dto({ checkIn, checkOut })),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});

describe('BookingsService.findAll / findOne', () => {
  it('UT-ROLE-04 a regular user only ever sees their own bookings (userId filter ignored)', async () => {
    const { service, prisma } = setup();
    await service.findAll(alice, { page: 1, limit: 20, userId: bob.id });
    expect(prisma.booking.findMany.mock.calls[0][0].where.userId).toBe(
      alice.id,
    );
  });

  it('UT-ROLE-05 an admin sees all bookings, optionally filtered by userId', async () => {
    const { service, prisma } = setup();
    await service.findAll(admin, { page: 1, limit: 20 });
    await service.findAll(admin, { page: 2, limit: 5, userId: bob.id });
    expect(prisma.booking.findMany.mock.calls[0][0].where.userId).toBe(
      undefined,
    );
    expect(prisma.booking.findMany.mock.calls[1][0]).toMatchObject({
      where: { userId: bob.id },
      skip: 5,
      take: 5,
    });
  });

  it('UT-ROLE-03 403 for another user’s booking; owner and admin may read it', async () => {
    const { service, prisma } = setup();
    prisma.booking.findUnique.mockResolvedValue(bookingRow());

    await expect(service.findOne(bob, 100)).rejects.toThrow(ForbiddenException);
    await expect(service.findOne(alice, 100)).resolves.toMatchObject({
      id: 100,
    });
    await expect(service.findOne(admin, 100)).resolves.toMatchObject({
      id: 100,
    });
  });

  it('404 for an unknown booking', async () => {
    const { service, prisma } = setup();
    prisma.booking.findUnique.mockResolvedValue(null);
    await expect(service.findOne(alice, 999)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('BookingsService status changes', () => {
  function withBooking(status: BookingStatus, userId = alice.id) {
    const ctx = setup();
    ctx.tx.booking.findUnique.mockResolvedValue({
      ...bookingRow({ status, userId }),
      room: { name: ROOM.name },
    });
    ctx.tx.booking.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve(bookingRow({ userId })),
    );
    return ctx;
  }

  it('UT-STAT-04 owner cancels a PENDING booking: compare-and-set update + BOOKING_CANCELLED event', async () => {
    const { service, tx, notifications } = withBooking(BookingStatus.PENDING);

    await service.cancel(alice, 100);

    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 100, status: BookingStatus.PENDING },
      data: { status: BookingStatus.CANCELLED },
    });
    const event = notifications.record.mock.calls[0][1];
    expect(event).toMatchObject({
      userId: alice.id,
      type: NotificationType.BOOKING_CANCELLED,
    });
    expect(event.message).not.toMatch(/by an admin/);
  });

  it('UT-STAT-05 an admin cancelling someone else’s booking is named in the event', async () => {
    const { service, notifications } = withBooking(BookingStatus.APPROVED);
    await service.cancel(admin, 100);
    expect(notifications.record.mock.calls[0][1].message).toMatch(
      /was cancelled by an admin$/,
    );
  });

  it.each([BookingStatus.PAID, BookingStatus.CANCELLED])(
    'UT-STAT-06 a regular user cannot cancel a %s booking -> 409',
    async (status) => {
      const { service, tx } = withBooking(status);
      await expect(service.cancel(alice, 100)).rejects.toThrow(
        ConflictException,
      );
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
    },
  );

  it('UT-ROLE-06 a user cannot cancel another user’s booking -> 403', async () => {
    const { service, tx } = withBooking(BookingStatus.PENDING);
    await expect(service.cancel(bob, 100)).rejects.toThrow(ForbiddenException);
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it('UT-STAT-07 admin approves: BOOKING_STATUS_CHANGED event for the owner', async () => {
    const { service, notifications } = withBooking(BookingStatus.PENDING);
    await service.updateStatus(admin, 100, BookingStatus.APPROVED);
    expect(notifications.record.mock.calls[0][1]).toMatchObject({
      userId: alice.id,
      type: NotificationType.BOOKING_STATUS_CHANGED,
      message: expect.stringMatching(/is now APPROVED$/),
    });
  });

  it('UT-STAT-03 illegal transition (PENDING -> PAID) -> 409, nothing written', async () => {
    const { service, tx, notifications } = withBooking(BookingStatus.PENDING);
    await expect(
      service.updateStatus(admin, 100, BookingStatus.PAID),
    ).rejects.toThrow(/Cannot change booking status from PENDING to PAID/);
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(notifications.record).not.toHaveBeenCalled();
  });

  it('UT-STAT-08 a concurrent change (status moved meanwhile) -> 409, no event', async () => {
    const { service, tx, notifications } = withBooking(BookingStatus.PENDING);
    tx.booking.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.updateStatus(admin, 100, BookingStatus.APPROVED),
    ).rejects.toThrow(/modified by another request/);
    expect(notifications.record).not.toHaveBeenCalled();
  });

  it('404 when the booking does not exist', async () => {
    const { service, tx } = setup();
    tx.booking.findUnique.mockResolvedValue(null);
    await expect(service.cancel(alice, 999)).rejects.toThrow(NotFoundException);
  });
});
