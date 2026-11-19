import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  roomId!: number;

  /** ISO 8601, e.g. "2026-12-01" or "2026-12-01T14:00:00+07:00". */
  @ApiProperty({
    example: '2026-12-01',
    description:
      'ISO 8601 date or date-time (e.g. 2026-12-01T14:00:00+07:00); not in the past',
  })
  @IsISO8601({ strict: true })
  checkIn!: string;

  @ApiProperty({
    example: '2026-12-03',
    description:
      'ISO 8601, after checkIn, at most 30 nights later. Back-to-back stays are allowed',
  })
  @IsISO8601({ strict: true })
  checkOut!: string;

  @ApiPropertyOptional({
    example: 2,
    minimum: 1,
    maximum: 20,
    default: 1,
    description: 'Must not exceed the room capacity',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  guests?: number;
}

export class UpdateBookingStatusDto {
  @ApiProperty({
    enum: BookingStatus,
    enumName: 'BookingStatus',
    example: BookingStatus.APPROVED,
    description:
      'Allowed: PENDING → APPROVED / CANCELLED, APPROVED → PAID / CANCELLED, PAID → CANCELLED',
  })
  @IsEnum(BookingStatus, {
    message: `status must be one of: ${Object.values(BookingStatus).join(', ')}`,
  })
  status!: BookingStatus;
}

export class ListBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BookingStatus, enumName: 'BookingStatus' })
  @IsOptional()
  @IsEnum(BookingStatus, {
    message: `status must be one of: ${Object.values(BookingStatus).join(', ')}`,
  })
  status?: BookingStatus;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomId?: number;

  /** Admin only; regular users always get just their own bookings. */
  @ApiPropertyOptional({
    example: 7,
    minimum: 1,
    description: 'Admin only. Regular users always get just their own bookings',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;
}
