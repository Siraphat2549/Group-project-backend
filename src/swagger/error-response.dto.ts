import { ApiProperty } from '@nestjs/swagger';

/**
 * Shape of every error response (NestJS HttpException default).
 * If a global exception filter changes the shape (e.g. adds `path` or
 * `timestamp`), update this DTO so the docs stay accurate.
 */
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({
    description: 'Human-readable reason; an array for validation errors',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'checkOut must be after checkIn',
  })
  message!: string | string[];

  @ApiProperty({ example: 'Bad Request' })
  error!: string;
}
