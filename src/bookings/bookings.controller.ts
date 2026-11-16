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
import { Role } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.interface';
import { CurrentUser, Roles } from '../auth/decorators';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { BookingsService } from './bookings.service';
import {
  CreateBookingDto,
  ListBookingsQueryDto,
  UpdateBookingStatusDto,
} from './dto/booking.dto';

/** Every booking route requires login (NFR-2). */
@Controller('bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /** FR-17..22. 201 + Pending; 409 on overlap; 400 on invalid dates. */
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    return {
      message: 'Booking created successfully',
      data: await this.bookings.create(user, dto),
    };
  }

  /** FR-23 (user: own) / FR-25 (admin: all). */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListBookingsQueryDto) {
    return this.bookings.findAll(user, query);
  }

  /** FR-24. */
  @Get(':id')
  async findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return { data: await this.bookings.findOne(user, id) };
  }

  /** Owner or admin cancels (FR-31 event recorded). */
  @Patch(':id/cancel')
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
