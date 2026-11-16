import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  paginate,
  PaginatedResult,
  skipTake,
} from '../common/dto/pagination.dto';
import {
  DateRange,
  overlappingBookingsWhere,
} from '../common/utils/date-range';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateRoomDto,
  ListRoomsQueryDto,
  UpdateRoomDto,
} from './dto/room.dto';
import {
  detectImageMime,
  MAX_IMAGE_BYTES,
  RoomImageStorage,
} from './room-image.storage';
import {
  RoomImageResponse,
  RoomResponse,
  toImageResponse,
  toRoomResponse,
} from './room.mapper';

export const MAX_IMAGES_PER_ROOM = 10;

const withImages = {
  images: { orderBy: { id: 'asc' } },
} satisfies Prisma.RoomInclude;

export interface UploadedImage {
  buffer: Buffer;
  size: number;
  originalname: string;
}

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);
  private readonly storage: RoomImageStorage;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.storage = new RoomImageStorage(
      config.get<string>('UPLOAD_DIR', 'uploads'),
    );
  }

  /**
   * Lists rooms (FR-12) with capacity/price filters (FR-28). When `range`
   * is given, only rooms with no blocking booking overlapping it are
   * returned (FR-27, FR-29) — computed in one SQL query.
   */
  async findAll(
    query: ListRoomsQueryDto,
    opts: { isAdmin: boolean; range?: DateRange },
  ): Promise<PaginatedResult<RoomResponse>> {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw new BadRequestException('minPrice cannot be greater than maxPrice');
    }

    const where: Prisma.RoomWhereInput = {};
    if (!(opts.isAdmin && query.includeInactive)) where.isActive = true;
    if (query.capacity !== undefined) where.capacity = { gte: query.capacity };
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.pricePerNight = { gte: query.minPrice, lte: query.maxPrice };
    }
    if (opts.range) {
      where.bookings = { none: overlappingBookingsWhere(opts.range) };
    }

    const [rooms, total] = await this.prisma.$transaction([
      this.prisma.room.findMany({
        where,
        include: withImages,
        orderBy: [{ pricePerNight: 'asc' }, { id: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.room.count({ where }),
    ]);
    return paginate(rooms.map(toRoomResponse), total, query);
  }

  /** Room details with images (FR-13, FR-16). Inactive rooms are admin-only. */
  async findOne(id: number, isAdmin: boolean): Promise<RoomResponse> {
    const room = await this.prisma.room.findUnique({
      where: { id },
      include: withImages,
    });
    if (!room || (!room.isActive && !isAdmin)) throw roomNotFound(id);
    return toRoomResponse(room);
  }

  async create(dto: CreateRoomDto): Promise<RoomResponse> {
    const room = await this.prisma.room
      .create({ data: dto, include: withImages })
      .catch(rethrowDuplicateName(dto.name));
    this.logger.log(`Room created id=${room.id}`);
    return toRoomResponse(room);
  }

  async update(id: number, dto: UpdateRoomDto): Promise<RoomResponse> {
    await this.ensureExists(id);
    const room = await this.prisma.room
      .update({ where: { id }, data: dto, include: withImages })
      .catch(rethrowDuplicateName(dto.name));
    this.logger.log(`Room updated id=${id}`);
    return toRoomResponse(room);
  }

  /**
   * Hard delete is only allowed for rooms that were never booked; booking
   * history must be kept (NFR-8), so such rooms must be deactivated instead.
   */
  async remove(id: number): Promise<void> {
    const room = await this.prisma.room.findUnique({
      where: { id },
      include: { images: true, _count: { select: { bookings: true } } },
    });
    if (!room) throw roomNotFound(id);
    if (room._count.bookings > 0) {
      throw new ConflictException(
        `Room ${id} has bookings and cannot be deleted; deactivate it instead (PATCH /rooms/${id} with {"isActive": false})`,
      );
    }
    await this.prisma.room.delete({ where: { id } });
    await Promise.all(room.images.map((i) => this.storage.remove(i.fileName)));
    this.logger.log(`Room deleted id=${id}`);
  }

  /** Stores an uploaded image and its metadata (FR-14, FR-15). */
  async addImage(
    roomId: number,
    file: UploadedImage | undefined,
  ): Promise<RoomImageResponse> {
    if (!file) {
      throw new BadRequestException(
        'An image file is required (multipart/form-data field "image")',
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Image must be 5 MB or smaller');
    }
    const mime = detectImageMime(file.buffer);
    if (!mime) {
      throw new BadRequestException(
        'Only JPEG, PNG or WebP images are allowed',
      );
    }

    await this.ensureExists(roomId);
    const count = await this.prisma.roomImage.count({ where: { roomId } });
    if (count >= MAX_IMAGES_PER_ROOM) {
      throw new ConflictException(
        `A room can have at most ${MAX_IMAGES_PER_ROOM} images`,
      );
    }

    const { fileName, url } = await this.storage.save(file.buffer, mime);
    try {
      const image = await this.prisma.roomImage.create({
        data: {
          roomId,
          url,
          fileName,
          originalName: file.originalname.slice(0, 255),
          mimeType: mime,
          sizeBytes: file.size,
        },
      });
      this.logger.log(`Image added room=${roomId} image=${image.id}`);
      return toImageResponse(image);
    } catch (err) {
      await this.storage.remove(fileName);
      throw err;
    }
  }

  async removeImage(roomId: number, imageId: number): Promise<void> {
    const image = await this.prisma.roomImage.findFirst({
      where: { id: imageId, roomId },
    });
    if (!image) {
      throw new NotFoundException(
        `Image with id ${imageId} not found for room ${roomId}`,
      );
    }
    await this.prisma.roomImage.delete({ where: { id: imageId } });
    await this.storage.remove(image.fileName);
  }

  private async ensureExists(id: number): Promise<void> {
    const found = await this.prisma.room.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw roomNotFound(id);
  }
}

export function roomNotFound(id: number): NotFoundException {
  return new NotFoundException(`Room with id ${id} not found`);
}

function rethrowDuplicateName(name: string | undefined) {
  return (err: unknown): never => {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ConflictException(`A room named "${name}" already exists`);
    }
    throw err;
  };
}
