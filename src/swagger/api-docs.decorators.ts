import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from './error-response.dto';
import { BEARER_AUTH } from './swagger';

/**
 * Reusable Swagger decorators so every endpoint documents the same error
 * responses. Example:
 *
 *   @ApiTags(ApiTag.Bookings)
 *   @Controller('bookings')
 *   export class BookingsController {
 *     @Post()
 *     @ApiOperation({ summary: 'Create a booking' })
 *     @ApiCreatedResponse({ type: BookingResponseDto })
 *     @ApiAuth()
 *     @ApiValidationError()
 *     @ApiNotFound('Room')
 *     @ApiConflict('Room is already booked for an overlapping time range')
 *     @ApiRateLimited()
 *     create(@Body() dto: CreateBookingDto) {}
 *   }
 */

/** Endpoint requires a JWT (lock icon in Swagger UI) and may return 401. */
export const ApiAuth = () =>
  applyDecorators(
    ApiBearerAuth(BEARER_AUTH),
    ApiUnauthorizedResponse({
      description: 'Missing, invalid or expired access token',
      type: ErrorResponseDto,
    }),
  );

/** Admin-only endpoint: 401 without a token, 403 for a Regular User. */
export const ApiAdminOnly = () =>
  applyDecorators(
    ApiAuth(),
    ApiForbiddenResponse({
      description: 'Logged in, but not an Admin',
      type: ErrorResponseDto,
    }),
  );

/** Resource owned by a user (e.g. a booking): 403 when it is someone else's. */
export const ApiOwnerOnly = (
  description = 'Resource belongs to another user',
) =>
  applyDecorators(
    ApiAuth(),
    ApiForbiddenResponse({ description, type: ErrorResponseDto }),
  );

/** 400 — invalid or incomplete data (FR-32). */
export const ApiValidationError = (
  description = 'Invalid or incomplete data',
) => ApiBadRequestResponse({ description, type: ErrorResponseDto });

/** 404 — room / booking not found (FR-33). */
export const ApiNotFound = (resource = 'Resource') =>
  ApiNotFoundResponse({
    description: `${resource} not found`,
    type: ErrorResponseDto,
  });

/** 409 — e.g. double booking (FR-20) or duplicate email. */
export const ApiConflict = (description: string) =>
  ApiConflictResponse({ description, type: ErrorResponseDto });

/** 429 — rate-limited endpoints (/auth, booking creation). */
export const ApiRateLimited = () =>
  ApiTooManyRequestsResponse({
    description: 'Too many requests — rate limit exceeded, retry later',
    type: ErrorResponseDto,
  });

/**
 * multipart/form-data upload with a single file field (FR-14 room image).
 * Pair with `@UseInterceptors(FileInterceptor(field))`.
 */
export const ApiImageUpload = (field = 'image') =>
  applyDecorators(
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: [field],
        properties: { [field]: { type: 'string', format: 'binary' } },
      },
    }),
  );
