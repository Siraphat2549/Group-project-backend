import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { isAdmin } from '../auth/auth-user.interface';
import type { AuthUser } from '../auth/auth-user.interface';
import { CurrentUser, Roles } from '../auth/decorators';
import { JwtAuthGuard, OptionalJwtAuthGuard, RolesGuard } from '../auth/guards';
import { CachedResponse, InvalidatesCache } from '../cache/cache.decorators';
import { parseDateRange } from '../common/utils/date-range';
import {
  ApiAdminOnly,
  ApiConflict,
  ApiDataResponse,
  ApiImageUpload,
  ApiMessageResponse,
  ApiNotFound,
  ApiOptionalAuth,
  ApiPaginatedResponse,
  ApiValidationError,
} from '../swagger/api-docs.decorators';
import { ErrorResponseDto } from '../swagger/error-response.dto';
import { ApiTag } from '../swagger/swagger';
import {
  CreateRoomDto,
  ListRoomsQueryDto,
  SearchRoomsQueryDto,
  UpdateRoomDto,
} from './dto/room.dto';
import { RoomImageResponseDto, RoomResponseDto } from './dto/room-response.dto';
import { IMAGE_FIELD, MAX_IMAGE_BYTES } from './room-image.storage';
import { RoomsService } from './rooms.service';
import type { UploadedImage } from './rooms.service';

/** Guards + matching Swagger docs (lock icon, 401, 403) in one place. */
const AdminOnly = () =>
  applyDecorators(UseGuards(JwtAuthGuard, RolesGuard), ApiAdminOnly());

/** Public route; an Admin token unlocks deactivated rooms. */
const OptionalAuth = () =>
  applyDecorators(UseGuards(OptionalJwtAuthGuard), ApiOptionalAuth());

@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  /** FR-12, FR-28. Public. Admins may pass includeInactive=true. */
  @Get()
  @OptionalAuth()
  @CachedResponse('rooms')
  @ApiOperation({
    summary: 'List rooms',
    description:
      'Public. Active rooms with their images, cheapest first, filterable by capacity and price. Cached in Redis (`X-Cache` header); with an Admin token, `includeInactive=true` also lists deactivated rooms.',
  })
  @ApiPaginatedResponse(RoomResponseDto, 'Rooms')
  @ApiValidationError('Invalid query (e.g. minPrice greater than maxPrice)')
  list(@Query() query: ListRoomsQueryDto, @CurrentUser() user?: AuthUser) {
    return this.rooms.findAll(query, { isAdmin: isAdmin(user) });
  }

  /** FR-27..29. Only rooms free for the whole [checkIn, checkOut) range. */
  @Get('search')
  @OptionalAuth()
  // Availability also changes with every booking, not only with rooms.
  @CachedResponse('rooms', 'bookings')
  @ApiTags(ApiTag.Search)
  @ApiOperation({
    summary: 'Search available rooms',
    description:
      'Public. Only rooms with **no** PENDING / APPROVED / PAID booking overlapping `[checkIn, checkOut)`, plus the same filters as `GET /rooms` (e.g. `capacity`). A room is free again on the check-out day.',
  })
  @ApiPaginatedResponse(RoomResponseDto, 'Rooms free for the whole stay')
  @ApiValidationError(
    'checkIn / checkOut missing or invalid, checkOut not after checkIn, or checkIn in the past',
  )
  search(@Query() query: SearchRoomsQueryDto, @CurrentUser() user?: AuthUser) {
    const range = parseDateRange(query.checkIn, query.checkOut);
    return this.rooms.findAll(query, { isAdmin: isAdmin(user), range });
  }

  /** FR-13, FR-16. */
  @Get(':id')
  @OptionalAuth()
  @CachedResponse('rooms')
  @ApiOperation({
    summary: 'View a room',
    description:
      'Public. Room details including image metadata and URLs. Deactivated rooms are 404 except for an Admin.',
  })
  @ApiDataResponse(200, RoomResponseDto, { description: 'Room details' })
  @ApiValidationError('id must be a number')
  @ApiNotFound('Room')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user?: AuthUser,
  ) {
    return { data: await this.rooms.findOne(id, isAdmin(user)) };
  }

  /** FR-8. */
  @Post()
  @AdminOnly()
  @Roles(Role.ADMIN)
  @InvalidatesCache('rooms')
  @ApiOperation({ summary: 'Create a room (Admin)' })
  @ApiDataResponse(201, RoomResponseDto, {
    description: 'Room created',
    message: 'Room created successfully',
  })
  @ApiValidationError()
  @ApiConflict('A room with this name already exists')
  async create(@Body() dto: CreateRoomDto) {
    return {
      message: 'Room created successfully',
      data: await this.rooms.create(dto),
    };
  }

  /** FR-9, FR-10 (send isActive=false to deactivate). */
  @Patch(':id')
  @AdminOnly()
  @Roles(Role.ADMIN)
  @InvalidatesCache('rooms')
  @ApiOperation({
    summary: 'Update or deactivate a room (Admin)',
    description:
      'Send any subset of the fields. `{ "isActive": false }` deactivates the room: hidden from guests and no longer bookable.',
  })
  @ApiDataResponse(200, RoomResponseDto, {
    description: 'Room updated',
    message: 'Room updated successfully',
  })
  @ApiValidationError()
  @ApiNotFound('Room')
  @ApiConflict('A room with this name already exists')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoomDto,
  ) {
    return {
      message: 'Room updated successfully',
      data: await this.rooms.update(id, dto),
    };
  }

  /** FR-10. Only never-booked rooms; otherwise 409 → deactivate instead. */
  @Delete(':id')
  @AdminOnly()
  @Roles(Role.ADMIN)
  @InvalidatesCache('rooms')
  @ApiOperation({
    summary: 'Delete a room (Admin)',
    description:
      'Only a room that was never booked. Otherwise 409: deactivate it with `PATCH /rooms/{id}` instead, so booking history is kept.',
  })
  @ApiMessageResponse(200, 'Room deleted', 'Room deleted successfully')
  @ApiValidationError('id must be a number')
  @ApiNotFound('Room')
  @ApiConflict('Room has bookings and cannot be deleted; deactivate it instead')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.rooms.remove(id);
    return { message: 'Room deleted successfully' };
  }

  /** FR-14, FR-15. multipart/form-data, field "image", JPEG/PNG/WebP ≤ 5 MB. */
  @Post(':id/images')
  @AdminOnly()
  @Roles(Role.ADMIN)
  @InvalidatesCache('rooms')
  @ApiOperation({
    summary: 'Upload a room image (Admin)',
    description:
      '`multipart/form-data` with one file in the `image` field: JPEG, PNG or WebP, at most 5 MB, at most 10 images per room. The file is served at the returned `url`.',
  })
  @ApiImageUpload(IMAGE_FIELD)
  @ApiDataResponse(201, RoomImageResponseDto, {
    description: 'Image stored; returns its metadata',
    message: 'Image uploaded successfully',
  })
  @ApiValidationError('No file, or not a JPEG / PNG / WebP image')
  @ApiPayloadTooLargeResponse({
    description: 'File larger than 5 MB',
    type: ErrorResponseDto,
  })
  @ApiNotFound('Room')
  @ApiConflict('The room already has the maximum of 10 images')
  @UseInterceptors(
    FileInterceptor(IMAGE_FIELD, {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    }),
  )
  async uploadImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file?: UploadedImage,
  ) {
    return {
      message: 'Image uploaded successfully',
      data: await this.rooms.addImage(id, file),
    };
  }

  @Delete(':id/images/:imageId')
  @AdminOnly()
  @Roles(Role.ADMIN)
  @InvalidatesCache('rooms')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a room image (Admin)',
    description: 'Removes the image metadata and the file.',
  })
  @ApiMessageResponse(200, 'Image deleted', 'Image deleted successfully')
  @ApiValidationError('id / imageId must be numbers')
  @ApiNotFound('Room or image')
  async removeImage(
    @Param('id', ParseIntPipe) id: number,
    @Param('imageId', ParseIntPipe) imageId: number,
  ) {
    await this.rooms.removeImage(id, imageId);
    return { message: 'Image deleted successfully' };
  }
}
