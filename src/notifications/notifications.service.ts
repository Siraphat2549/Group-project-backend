import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationEvent, NotificationType, Prisma } from '@prisma/client';
import { AuthUser, isAdmin } from '../auth/auth-user.interface';
import { paginate, skipTake } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { ListNotificationsQueryDto } from './dto/notification.dto';

export interface RecordEventInput {
  userId: number;
  bookingId: number;
  type: NotificationType;
  message: string;
}

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Booking events for the frontend to poll (FR-30, FR-31). Events are written
 * with the same transaction client as the booking change, so a booking
 * never exists without its event (and vice versa).
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  record(db: Db, input: RecordEventInput): Promise<NotificationEvent> {
    return db.notificationEvent.create({ data: input });
  }

  async list(user: AuthUser, query: ListNotificationsQueryDto) {
    const where: Prisma.NotificationEventWhereInput = {};
    if (!(query.all && isAdmin(user))) where.userId = user.id;
    if (query.unread) where.isRead = false;

    const [rows, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notificationEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...skipTake(query),
      }),
      this.prisma.notificationEvent.count({ where }),
      this.prisma.notificationEvent.count({
        where: { userId: user.id, isRead: false },
      }),
    ]);
    const page = paginate(rows, total, query);
    return { ...page, meta: { ...page.meta, unreadCount } };
  }

  /** Users can only mark their own notifications. */
  async markRead(user: AuthUser, id: number): Promise<NotificationEvent> {
    const result = await this.prisma.notificationEvent.updateMany({
      where: { id, userId: user.id },
      data: { isRead: true },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Notification with id ${id} not found`);
    }
    return this.prisma.notificationEvent.findUniqueOrThrow({ where: { id } });
  }

  async markAllRead(user: AuthUser): Promise<number> {
    const { count } = await this.prisma.notificationEvent.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
    return count;
  }
}
