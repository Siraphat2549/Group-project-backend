import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.interface';
import { CurrentUser, Roles } from '../auth/decorators';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { InvalidatesCache } from '../cache/cache.decorators';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import {
  ApiAdminOnly,
  ApiAuth,
  ApiConflict,
  ApiDataResponse,
  ApiNotFound,
  ApiOwnerOnly,
  ApiPaginatedResponse,
  ApiRateLimited,
  ApiValidationError,
} from '../swagger/api-docs.decorators';
import { BookingsService } from './bookings.service';
import {
  CreateBookingDto,
  ListBookingsQueryDto,
  UpdateBookingStatusDto,
} from './dto/booking.dto';
import { BookingResponseDto } from './dto/booking-response.dto';

/** Every booking route requires login (NFR-2). */
@Controller('bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /** FR-17..22. 201 + Pending; 409 on overlap; 400 on invalid dates. */
  @Post()
  @RateLimit('booking')
  @InvalidatesCache('bookings')
  @ApiOperation({
    summary: 'Create a booking',
    description:
      'Books a room for `[checkIn, checkOut)` with status `PENDING`; `totalPrice = nights × pricePerNight`. Records a `BOOKING_CREATED` notification. Safe under concurrent requests: only one booking can win an overlapping slot.',
  })
  @ApiAuth()
  @ApiDataResponse(201, BookingResponseDto, {
    description: 'Booking created with status PENDING',
    message: 'Booking created successfully',
  })
  @ApiValidationError(
    'Invalid dates (checkOut not after checkIn, checkIn in the past, stay over 30 nights) or more guests than the room fits',
  )
  @ApiNotFound('Room (or the room is deactivated)')
  @ApiConflict('Room is already booked for an overlapping date range')
  @ApiRateLimited()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    return {
      message: 'Booking created successfully',
      data: await this.bookings.create(user, dto),
    };
  }

  /** FR-23 (user: own) / FR-25 (admin: all). */
  @Get()
  @ApiOperation({
    summary: 'List bookings',
    description:
      'Regular User: only your own bookings. Admin: every booking, optionally filtered by `userId`.',
  })
  @ApiAuth()
  @ApiPaginatedResponse(BookingResponseDto, 'Bookings, newest first')
  @ApiValidationError('Invalid query parameter')
  list(@CurrentUser() user: AuthUser, @Query() query: ListBookingsQueryDto) {
    return this.bookings.findAll(user, query);
  }

  /** FR-24. */
  @Get(':id')
  @ApiOperation({
    summary: 'View a booking',
    description: 'Your own booking, or any booking for an Admin.',
  })
  @ApiOwnerOnly('Booking belongs to another user')
  @ApiDataResponse(200, BookingResponseDto, { description: 'Booking details' })
  @ApiValidationError('id must be a number')
  @ApiNotFound('Booking')
  async findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return { data: await this.bookings.findOne(user, id) };
  }

  /** Owner or admin cancels (FR-31 event recorded). */
  @Patch(':id/cancel')
  @InvalidatesCache('bookings')
  @ApiOperation({
    summary: 'Cancel a booking',
    description:
      'The owner may cancel a `PENDING` or `APPROVED` booking; an Admin may cancel any booking that is not cancelled yet. Frees the dates and records a `BOOKING_CANCELLED` notification.',
  })
  @ApiOwnerOnly('Booking belongs to another user')
  @ApiDataResponse(200, BookingResponseDto, {
    description: 'Booking cancelled',
    message: 'Booking cancelled successfully',
  })
  @ApiValidationError('id must be a number')
  @ApiNotFound('Booking')
  @ApiConflict(
    'Already cancelled, or a PAID booking (only an Admin can cancel it)',
  )
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return {
      message: 'Booking cancelled successfully',
      data: await this.bookings.cancel(user, id),
    };
  }

  /** FR-26. Admin only. */
  @Patch(':id/status')
  @Roles(Role.ADMIN)
  @InvalidatesCache('bookings')
  @ApiOperation({
    summary: 'Change a booking status (Admin)',
    description:
      'Allowed: `PENDING → APPROVED / CANCELLED`, `APPROVED → PAID / CANCELLED`, `PAID → CANCELLED`. `CANCELLED` is final. Records a notification for the booking owner.',
  })
  @ApiAdminOnly()
  @ApiDataResponse(200, BookingResponseDto, {
    description: 'Booking status updated',
    message: 'Booking status updated to APPROVED',
  })
  @ApiValidationError('Invalid status value or id')
  @ApiNotFound('Booking')
  @ApiConflict('Transition not allowed (the message lists the allowed targets)')
  async updateStatus(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBookingStatusDto,
  ) {
    return {
      message: `Booking status updated to ${dto.status}`,
      data: await this.bookings.updateStatus(admin, id, dto.status),
    };
  }
}
