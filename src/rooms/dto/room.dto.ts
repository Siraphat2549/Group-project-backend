import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { toBool, trim } from '../../common/utils/transforms';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateRoomDto {
  @ApiProperty({
    example: 'Deluxe 501',
    maxLength: 100,
    description: 'Must be unique',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    example: 'King bed, city view, 32 m²',
    maxLength: 2000,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({
    example: 2,
    minimum: 1,
    maximum: 20,
    description: 'Maximum number of guests',
  })
  @IsInt()
  @Min(1)
  @Max(20)
  capacity!: number;

  @ApiProperty({
    example: 2500,
    minimum: 0.01,
    maximum: 99_999_999,
    description: 'Price per night, up to 2 decimal places',
  })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(99_999_999)
  pricePerNight!: number;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description: 'false = deactivated (hidden from guests, not bookable)',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** All fields optional; send `isActive: false` to deactivate (FR-10). */
export class UpdateRoomDto extends PartialType(CreateRoomDto) {}

export class ListRoomsQueryDto extends PaginationQueryDto {
  /** Minimum number of guests the room must fit (FR-28). */
  @ApiPropertyOptional({
    example: 2,
    minimum: 1,
    description: 'Only rooms that fit at least this many guests',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity?: number;

  @ApiPropertyOptional({ example: 1000, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({
    example: 5000,
    minimum: 0,
    description: 'Must be ≥ minPrice',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  /** Admin only: also return deactivated rooms. Ignored for other callers. */
  @ApiPropertyOptional({
    example: false,
    description:
      'Admin only: also return deactivated rooms. Ignored for other callers',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeInactive?: boolean;
}

/** GET /rooms/search: date range is mandatory (FR-27, FR-29). */
export class SearchRoomsQueryDto extends ListRoomsQueryDto {
  @ApiProperty({
    example: '2026-12-01',
    description: 'ISO 8601 date or date-time; not in the past',
  })
  @IsISO8601({ strict: true })
  checkIn!: string;

  @ApiProperty({
    example: '2026-12-03',
    description:
      'ISO 8601, after checkIn, at most 30 nights later. The stay is [checkIn, checkOut)',
  })
  @IsISO8601({ strict: true })
  checkOut!: string;
}
