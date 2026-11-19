import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus } from '@prisma/client';
import type { BookingResponse } from '../booking.mapper';

export class BookingRoomDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Deluxe 501' })
  name!: string;

  @ApiProperty({ example: 2500 })
  pricePerNight!: number;
}

export class BookingUserDto {
  @ApiProperty({ example: 7 })
  id!: number;

  @ApiProperty({ example: 'Alice' })
  name!: string;

  @ApiProperty({ example: 'alice@example.com' })
  email!: string;
}

export class BookingResponseDto implements BookingResponse {
  @ApiProperty({ example: 12 })
  id!: number;

  @ApiProperty({
    enum: BookingStatus,
    enumName: 'BookingStatus',
    example: BookingStatus.PENDING,
    description: 'PENDING → APPROVED → PAID; any of them → CANCELLED (final)',
  })
  status!: BookingStatus;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-12-01T00:00:00.000Z',
  })
  checkIn!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-12-03T00:00:00.000Z',
  })
  checkOut!: Date;

  @ApiProperty({ example: 2 })
  nights!: number;

  @ApiProperty({ example: 2 })
  guests!: number;

  @ApiProperty({ example: 5000, description: 'nights × room.pricePerNight' })
  totalPrice!: number;

  @ApiProperty({ type: BookingRoomDto })
  room!: BookingRoomDto;

  @ApiProperty({ type: BookingUserDto })
  user!: BookingUserDto;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
