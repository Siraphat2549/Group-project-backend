import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiResponse,
  ApiSecurity,
  ApiServiceUnavailableResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { ReferenceObject, SchemaObject } from '@nestjs/swagger';
import { PaginationMetaDto } from '../common/dto/pagination.dto';
import { ErrorResponseDto } from './error-response.dto';
import { BEARER_AUTH } from './swagger';

type SuccessStatus = 200 | 201;

interface SuccessOptions {
  description: string;
  /** Example of the `message` field (FR-34); omit for plain reads. */
  message?: string;
  /** Extra top-level properties, e.g. the fresh `token` of PATCH /users/me. */
  extra?: Record<string, SchemaObject | ReferenceObject>;
}

/**
 * Success response `{ message?, data: <model> }` (FR-34): mutations answer
 * with a message, detail reads with `{ data }` only.
 */
export const ApiDataResponse = (
  status: SuccessStatus,
  model: Type<unknown>,
  { description, message, extra }: SuccessOptions,
) =>
  applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        required: [...(message ? ['message'] : []), 'data'],
        properties: {
          ...(message ? { message: { type: 'string', example: message } } : {}),
          data: { $ref: getSchemaPath(model) },
          ...extra,
        },
      },
    }),
  );

/** List response `{ data: <model>[], meta }` with pagination meta. */
export const ApiPaginatedResponse = (
  model: Type<unknown>,
  description: string,
  meta: Type<unknown> = PaginationMetaDto,
) =>
  applyDecorators(
    ApiExtraModels(model, meta),
    ApiResponse({
      status: 200,
      description,
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(meta) },
        },
      },
    }),
  );

/** Success response that only carries `{ message }` (e.g. delete, logout). */
export const ApiMessageResponse = (
  status: SuccessStatus,
  description: string,
  message: string,
) =>
  ApiResponse({
    status,
    description,
    schema: {
      type: 'object',
      required: ['message'],
      properties: { message: { type: 'string', example: message } },
    },
  });

/** 503 — a dependency (MySQL / Redis) is down. */
export const ApiUnavailable = (description: string) =>
  ApiServiceUnavailableResponse({ description, type: ErrorResponseDto });

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

const TOKEN_401 = 'Missing, invalid, expired or logged-out access token';

/** 401 without a lock icon, e.g. wrong credentials on POST /auth/login. */
export const ApiUnauthorized = (description: string) =>
  ApiUnauthorizedResponse({ description, type: ErrorResponseDto });

/** Endpoint requires a JWT (lock icon in Swagger UI) and may return 401. */
export const ApiAuth = (description = TOKEN_401) =>
  applyDecorators(ApiBearerAuth(BEARER_AUTH), ApiUnauthorized(description));

/**
 * Public endpoint where a token is optional (pair with OptionalJwtAuthGuard):
 * guests get the public view, an Admin token adds deactivated rooms. The `{}`
 * requirement tells Swagger UI the token may be left out; it is still sent
 * once you click Authorize. No 401: a bad token is treated as a guest.
 */
export const ApiOptionalAuth = () =>
  applyDecorators(ApiBearerAuth(BEARER_AUTH), ApiSecurity({}));

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
