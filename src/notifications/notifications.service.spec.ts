/* eslint-disable @typescript-eslint/no-unsafe-member-access -- jest mock call arguments are untyped */
import { NotFoundException } from '@nestjs/common';
import { NotificationType, Role } from '@prisma/client';
import { AuthUser } from '../auth/auth-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

const alice: AuthUser = { id: 1, email: 'alice@example.com', role: Role.USER };
const admin: AuthUser = { id: 9, email: 'admin@example.com', role: Role.ADMIN };

function setup() {
  const notificationEvent = {
    create: jest.fn().mockResolvedValue({ id: 1 }),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(2),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 7, isRead: true }),
  };
  const prisma = {
    notificationEvent,
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const service = new NotificationsService(prisma as unknown as PrismaService);
  return { service, notificationEvent };
}

const page = { page: 1, limit: 20 };

describe('NotificationsService', () => {
  it('UT-NOTIF-01 record() writes with the given client (the booking transaction)', async () => {
    const { service } = setup();
    const tx = {
      notificationEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const input = {
      userId: 1,
      bookingId: 2,
      type: NotificationType.BOOKING_CREATED,
      message: 'created',
    };
    await service.record(tx as unknown as PrismaService, input);
    expect(tx.notificationEvent.create).toHaveBeenCalledWith({ data: input });
  });

  it('UT-NOTIF-02 a user lists only their own events, with unreadCount', async () => {
    const { service, notificationEvent } = setup();
    const result = await service.list(alice, { ...page, all: true });

    expect(notificationEvent.findMany.mock.calls[0][0].where).toEqual({
      userId: alice.id, // `all` is ignored for regular users
    });
    expect(result.meta).toMatchObject({ total: 4, unreadCount: 2 });
  });

  it('UT-NOTIF-03 an admin may list every user’s events; unread filter applies', async () => {
    const { service, notificationEvent } = setup();
    await service.list(admin, { ...page, all: true, unread: true });
    expect(notificationEvent.findMany.mock.calls[0][0].where).toEqual({
      isRead: false,
    });
  });

  it('UT-NOTIF-04 marking someone else’s (or an unknown) notification -> 404', async () => {
    const { service, notificationEvent } = setup();
    notificationEvent.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.markRead(alice, 7)).rejects.toThrow(NotFoundException);
    expect(notificationEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 7, userId: alice.id },
      data: { isRead: true },
    });
  });

  it('UT-NOTIF-05 mark all read only touches the caller’s unread events', async () => {
    const { service, notificationEvent } = setup();
    notificationEvent.updateMany.mockResolvedValue({ count: 3 });
    await expect(service.markAllRead(alice)).resolves.toBe(3);
    expect(notificationEvent.updateMany).toHaveBeenCalledWith({
      where: { userId: alice.id, isRead: false },
      data: { isRead: true },
    });
  });
});
