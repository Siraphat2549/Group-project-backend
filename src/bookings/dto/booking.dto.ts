import { BookingStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateBookingDto {
  @IsInt()
  @Min(1)
  roomId!: number;

  /** ISO 8601, e.g. "2026-12-01" or "2026-12-01T14:00:00+07:00". */
  @IsISO8601({ strict: true })
  checkIn!: string;

  @IsISO8601({ strict: true })
  checkOut!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  guests?: number;
}

export class UpdateBookingStatusDto {
  @IsEnum(BookingStatus, {
    message: `status must be one of: ${Object.values(BookingStatus).join(', ')}`,
  })
  status!: BookingStatus;
}

export class ListBookingsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(BookingStatus, {
    message: `status must be one of: ${Object.values(BookingStatus).join(', ')}`,
  })
  status?: BookingStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomId?: number;

  /** Admin only; regular users always get just their own bookings. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;
}
