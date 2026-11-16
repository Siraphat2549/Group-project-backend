import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Booking,
  BookingStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { AuthUser, isAdmin } from '../auth/auth-user.interface';
import {
  paginate,
  PaginatedResult,
  skipTake,
} from '../common/dto/pagination.dto';
import {
  countNights,
  overlappingBookingsWhere,
  parseDateRange,
} from '../common/utils/date-range';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { roomNotFound } from '../rooms/rooms.service';
import {
  bookingInclude,
  BookingResponse,
  describeStay,
  toBookingResponse,
} from './booking.mapper';
import { assertTransition, USER_CANCELLABLE } from './booking-status';
import { CreateBookingDto, ListBookingsQueryDto } from './dto/booking.dto';

const TX_OPTIONS = {
  // Each read sees the latest committed rows (needed after waiting on the lock).
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 5_000,
  timeout: 10_000,
};

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * FR-17..20, FR-22, FR-30.
   *
   * Double booking is prevented even under concurrent requests: the room row
   * is locked (SELECT ... FOR UPDATE) for the duration of the transaction,
   * so two requests for the same room are serialised and the second one sees
   * the first one's booking in its overlap check.
   */
  async create(
    user: AuthUser,
    dto: CreateBookingDto,
  ): Promise<BookingResponse> {
    const range = parseDateRange(dto.checkIn, dto.checkOut);
    const guests = dto.guests ?? 1;

    const booking = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM \`Room\` WHERE id = ${dto.roomId} FOR UPDATE`;
      if (locked.length === 0) throw roomNotFound(dto.roomId);

      const room = await tx.room.findUniqueOrThrow({
        where: { id: dto.roomId },
      });
      if (!room.isActive) throw roomNotFound(dto.roomId);
      if (guests > room.capacity) {
        throw new BadRequestException(
          `Room "${room.name}" fits at most ${room.capacity} guest(s); requested ${guests}`,
        );
      }

      const clash = await tx.booking.findFirst({
        where: { roomId: room.id, ...overlappingBookingsWhere(range) },
        select: { checkIn: true, checkOut: true },
      });
      if (clash) {
        throw new ConflictException(
          `Room "${room.name}" is already booked from ${describeStay(clash)}; choose other dates or another room`,
        );
      }

      const nights = countNights(range.checkIn, range.checkOut);
      const created = await tx.booking.create({
        data: {
          userId: user.id,
          roomId: room.id,
          checkIn: range.checkIn,
          checkOut: range.checkOut,
          guests,
          totalPrice: room.pricePerNight.mul(nights),
          // status defaults to PENDING in the schema (FR-22)
        },
        include: bookingInclude,
      });

      await this.notifications.record(tx, {
        userId: user.id,
        bookingId: created.id,
        type: NotificationType.BOOKING_CREATED,
        message: `Booking #${created.id} for "${room.name}" (${describeStay(created)}) was created and is pending approval`,
      });
      return created;
    }, TX_OPTIONS);

    this.logger.log(
      `Booking created id=${booking.id} user=${user.id} room=${booking.roomId}`,
    );
    return toBookingResponse(booking);
  }

  /** FR-23 (own bookings) and FR-25 (admin: all bookings, filterable). */
  async findAll(
    user: AuthUser,
    query: ListBookingsQueryDto,
  ): Promise<PaginatedResult<BookingResponse>> {
    const where: Prisma.BookingWhereInput = {
      status: query.status,
      roomId: query.roomId,
      userId: isAdmin(user) ? query.userId : user.id,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        include: bookingInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...skipTake(query),
      }),
      this.prisma.booking.count({ where }),
    ]);
    return paginate(rows.map(toBookingResponse), total, query);
  }

  /** FR-24. Owners and admins only. */
  async findOne(user: AuthUser, id: number): Promise<BookingResponse> {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: bookingInclude,
    });
    if (!booking) throw bookingNotFound(id);
    assertCanAccess(user, booking);
    return toBookingResponse(booking);
  }

  /** FR-6 / FR-31: owner (before payment) or admin cancels a booking. */
  cancel(user: AuthUser, id: number): Promise<BookingResponse> {
    return this.changeStatus(user, id, BookingStatus.CANCELLED);
  }

  /** FR-26: admin approves / marks paid / cancels. */
  updateStatus(
    admin: AuthUser,
    id: number,
    status: BookingStatus,
  ): Promise<BookingResponse> {
    return this.changeStatus(admin, id, status);
  }

  private async changeStatus(
    actor: AuthUser,
    id: number,
    to: BookingStatus,
  ): Promise<BookingResponse> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id },
        include: { room: { select: { name: true } } },
      });
      if (!booking) throw bookingNotFound(id);
      assertCanAccess(actor, booking);

      if (!isAdmin(actor) && !USER_CANCELLABLE.includes(booking.status)) {
        throw new ConflictException(
          booking.status === BookingStatus.CANCELLED
            ? 'Booking is already CANCELLED'
            : `A ${booking.status} booking can only be cancelled by an admin`,
        );
      }
      assertTransition(booking.status, to);

      // Compare-and-set on the old status: a concurrent change makes this a 409
      // instead of silently overwriting it.
      const { count } = await tx.booking.updateMany({
        where: { id, status: booking.status },
        data: { status: to },
      });
      if (count === 0) {
        throw new ConflictException(
          'Booking was modified by another request; reload and try again',
        );
      }

      const cancelled = to === BookingStatus.CANCELLED;
      const byAdmin = actor.id !== booking.userId ? ' by an admin' : '';
      await this.notifications.record(tx, {
        userId: booking.userId,
        bookingId: id,
        type: cancelled
          ? NotificationType.BOOKING_CANCELLED
          : NotificationType.BOOKING_STATUS_CHANGED,
        message: cancelled
          ? `Booking #${id} for "${booking.room.name}" (${describeStay(booking)}) was cancelled${byAdmin}`
          : `Booking #${id} for "${booking.room.name}" is now ${to}`,
      });

      return tx.booking.findUniqueOrThrow({
        where: { id },
        include: bookingInclude,
      });
    }, TX_OPTIONS);

    this.logger.log(
      `Booking status changed id=${id} to=${to} by user=${actor.id}`,
    );
    return toBookingResponse(updated);
  }
}

function bookingNotFound(id: number): NotFoundException {
  return new NotFoundException(`Booking with id ${id} not found`);
}

function assertCanAccess(user: AuthUser, booking: Pick<Booking, 'userId'>) {
  if (!isAdmin(user) && booking.userId !== user.id) {
    throw new ForbiddenException('You can only access your own bookings');
  }
}
