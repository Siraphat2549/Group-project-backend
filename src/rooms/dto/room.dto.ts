import { PartialType } from '@nestjs/mapped-types';
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
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsInt()
  @Min(1)
  @Max(20)
  capacity!: number;

  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(99_999_999)
  pricePerNight!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** All fields optional; send `isActive: false` to deactivate (FR-10). */
export class UpdateRoomDto extends PartialType(CreateRoomDto) {}

export class ListRoomsQueryDto extends PaginationQueryDto {
  /** Minimum number of guests the room must fit (FR-28). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  /** Admin only: also return deactivated rooms. Ignored for other callers. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeInactive?: boolean;
}

/** GET /rooms/search: date range is mandatory (FR-27, FR-29). */
export class SearchRoomsQueryDto extends ListRoomsQueryDto {
  @IsISO8601({ strict: true })
  checkIn!: string;

  @IsISO8601({ strict: true })
  checkOut!: string;
}
