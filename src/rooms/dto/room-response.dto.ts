import { ApiProperty } from '@nestjs/swagger';
import type { RoomImageResponse, RoomResponse } from '../room.mapper';

/** Image metadata (FR-14–16); the file itself is served at `url`. */
export class RoomImageResponseDto implements RoomImageResponse {
  @ApiProperty({ example: 3 })
  id!: number;

  @ApiProperty({
    example: '/uploads/rooms/4f9c2a1e-8d7b-4c1a-9e33-2b6d1f0a7c55.jpg',
    description: 'Path of the image file on this API',
  })
  url!: string;

  @ApiProperty({ type: String, nullable: true, example: 'deluxe-501.jpg' })
  originalName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'image/jpeg' })
  mimeType!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 248310 })
  sizeBytes!: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class RoomResponseDto implements RoomResponse {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Deluxe 501' })
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'King bed, city view, 32 m²',
  })
  description!: string | null;

  @ApiProperty({ example: 2, description: 'Maximum number of guests' })
  capacity!: number;

  @ApiProperty({ example: 2500, description: 'Price per night' })
  pricePerNight!: number;

  @ApiProperty({
    example: true,
    description: 'false = deactivated: hidden from guests and not bookable',
  })
  isActive!: boolean;

  @ApiProperty({ type: [RoomImageResponseDto] })
  images!: RoomImageResponseDto[];

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
