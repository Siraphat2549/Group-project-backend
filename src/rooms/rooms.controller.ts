import {
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
import { Role } from '@prisma/client';
import { isAdmin } from '../auth/auth-user.interface';
import type { AuthUser } from '../auth/auth-user.interface';
import { CurrentUser, Roles } from '../auth/decorators';
import { JwtAuthGuard, OptionalJwtAuthGuard, RolesGuard } from '../auth/guards';
import { parseDateRange } from '../common/utils/date-range';
import {
  CreateRoomDto,
  ListRoomsQueryDto,
  SearchRoomsQueryDto,
  UpdateRoomDto,
} from './dto/room.dto';
import { IMAGE_FIELD, MAX_IMAGE_BYTES } from './room-image.storage';
import { RoomsService } from './rooms.service';
import type { UploadedImage } from './rooms.service';

const AdminOnly = () => UseGuards(JwtAuthGuard, RolesGuard);

@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  /** FR-12, FR-28. Public. Admins may pass includeInactive=true. */
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  list(@Query() query: ListRoomsQueryDto, @CurrentUser() user?: AuthUser) {
    return this.rooms.findAll(query, { isAdmin: isAdmin(user) });
  }

  /** FR-27..29. Only rooms free for the whole [checkIn, checkOut) range. */
  @Get('search')
  @UseGuards(OptionalJwtAuthGuard)
  search(@Query() query: SearchRoomsQueryDto, @CurrentUser() user?: AuthUser) {
    const range = parseDateRange(query.checkIn, query.checkOut);
    return this.rooms.findAll(query, { isAdmin: isAdmin(user), range });
  }

  /** FR-13, FR-16. */
  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
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
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.rooms.remove(id);
    return { message: 'Room deleted successfully' };
  }

  /** FR-14, FR-15. multipart/form-data, field "image", JPEG/PNG/WebP ≤ 5 MB. */
  @Post(':id/images')
  @AdminOnly()
  @Roles(Role.ADMIN)
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
  @HttpCode(HttpStatus.OK)
  async removeImage(
    @Param('id', ParseIntPipe) id: number,
    @Param('imageId', ParseIntPipe) imageId: number,
  ) {
    await this.rooms.removeImage(id, imageId);
    return { message: 'Image deleted successfully' };
  }
}
