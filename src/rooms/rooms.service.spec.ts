/* eslint-disable @typescript-eslint/no-unsafe-member-access -- jest mock call arguments are untyped */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_IMAGE_BYTES } from './room-image.storage';
import { MAX_IMAGES_PER_ROOM, RoomsService } from './rooms.service';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);

const ROOM = {
  id: 1,
  name: 'Deluxe',
  description: null,
  capacity: 2,
  pricePerNight: new Prisma.Decimal(1500),
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  images: [],
};

let uploadRoot: string;
beforeEach(() => {
  uploadRoot = mkdtempSync(join(tmpdir(), 'rooms-unit-'));
});
afterEach(() => rmSync(uploadRoot, { recursive: true, force: true }));

function setup() {
  const prisma = {
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    room: {
      findMany: jest.fn().mockResolvedValue([ROOM]),
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn().mockResolvedValue(ROOM),
      create: jest.fn().mockResolvedValue(ROOM),
      update: jest.fn().mockResolvedValue(ROOM),
      delete: jest.fn().mockResolvedValue(ROOM),
    },
    roomImage: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 5, createdAt: new Date(), ...args.data }),
      ),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  };
  const config = { get: () => uploadRoot } as unknown as ConfigService;
  const service = new RoomsService(prisma as unknown as PrismaService, config);
  return { service, prisma };
}

const page = { page: 1, limit: 20 };
const roomsDir = () => join(uploadRoot, 'rooms');
const storedFiles = () =>
  existsSync(roomsDir()) ? readdirSync(roomsDir()) : [];

describe('RoomsService.findAll', () => {
  it('UT-ROOM-01 guests only see active rooms; filters map to the query', async () => {
    const { service, prisma } = setup();
    const result = await service.findAll(
      { ...page, capacity: 3, minPrice: 100, maxPrice: 900 },
      { isAdmin: false },
    );
    expect(prisma.room.findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
      capacity: { gte: 3 },
      pricePerNight: { gte: 100, lte: 900 },
    });
    expect(result.data[0].pricePerNight).toBe(1500); // Decimal -> number
    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('UT-ROOM-02 includeInactive only works for admins', async () => {
    const { service, prisma } = setup();
    await service.findAll(
      { ...page, includeInactive: true },
      { isAdmin: false },
    );
    await service.findAll(
      { ...page, includeInactive: true },
      { isAdmin: true },
    );
    expect(prisma.room.findMany.mock.calls[0][0].where.isActive).toBe(true);
    expect(prisma.room.findMany.mock.calls[1][0].where).not.toHaveProperty(
      'isActive',
    );
  });

  it('UT-SRCH-01 a date range excludes rooms with an overlapping active booking', async () => {
    const { service, prisma } = setup();
    const range = {
      checkIn: new Date('2026-12-01T14:00:00Z'),
      checkOut: new Date('2026-12-03T14:00:00Z'),
    };
    await service.findAll(page, { isAdmin: false, range });
    expect(prisma.room.findMany.mock.calls[0][0].where.bookings).toEqual({
      none: {
        status: { in: ['PENDING', 'APPROVED', 'PAID'] },
        checkIn: { lt: range.checkOut },
        checkOut: { gt: range.checkIn },
      },
    });
  });

  it('400 when minPrice > maxPrice', async () => {
    const { service } = setup();
    await expect(
      service.findAll(
        { ...page, minPrice: 500, maxPrice: 100 },
        { isAdmin: false },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('RoomsService.findOne / remove', () => {
  it('UT-ROOM-03 a deactivated room is 404 for guests but visible to admins', async () => {
    const { service, prisma } = setup();
    prisma.room.findUnique.mockResolvedValue({ ...ROOM, isActive: false });
    await expect(service.findOne(1, false)).rejects.toThrow(NotFoundException);
    await expect(service.findOne(1, true)).resolves.toMatchObject({ id: 1 });
  });

  it('UT-ROOM-04 a room with bookings cannot be deleted (409): history is kept', async () => {
    const { service, prisma } = setup();
    prisma.room.findUnique.mockResolvedValue({
      ...ROOM,
      _count: { bookings: 1 },
    });
    await expect(service.remove(1)).rejects.toThrow(/deactivate it instead/);
    expect(prisma.room.delete).not.toHaveBeenCalled();
  });

  it('UT-ROOM-05 deleting an unknown room -> 404', async () => {
    const { service, prisma } = setup();
    prisma.room.findUnique.mockResolvedValue(null);
    await expect(service.remove(99)).rejects.toThrow(NotFoundException);
  });

  it('UT-ROOM-06 a duplicate name -> 409', async () => {
    const { service, prisma } = setup();
    prisma.room.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      service.create({ name: 'Deluxe', capacity: 2, pricePerNight: 1 }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('RoomsService images', () => {
  const file = (buffer: Buffer, size = buffer.length) => ({
    buffer,
    size,
    originalname: 'room.png',
  });

  it('UT-IMG-01 stores the file and its metadata; mime comes from the bytes', async () => {
    const { service, prisma } = setup();
    const image = await service.addImage(1, file(PNG));

    expect(image.url).toMatch(/^\/uploads\/rooms\/[0-9a-f-]+\.png$/);
    expect(prisma.roomImage.create.mock.calls[0][0].data).toMatchObject({
      roomId: 1,
      mimeType: 'image/png',
      sizeBytes: PNG.length,
      originalName: 'room.png',
    });
    expect(storedFiles()).toHaveLength(1);
  });

  it.each([
    ['no file', undefined, /image file is required/],
    [
      'a non-image',
      file(Buffer.from('hello world, not an image')),
      /Only JPEG, PNG or WebP/,
    ],
    ['an oversized file', file(PNG, MAX_IMAGE_BYTES + 1), /5 MB or smaller/],
  ])(
    'UT-IMG-02 rejects %s with 400 and stores nothing',
    async (_c, upload, msg) => {
      const { service, prisma } = setup();
      await expect(service.addImage(1, upload)).rejects.toThrow(msg);
      expect(prisma.roomImage.create).not.toHaveBeenCalled();
      expect(storedFiles()).toHaveLength(0);
    },
  );

  it(`UT-IMG-03 at most ${MAX_IMAGES_PER_ROOM} images per room -> 409`, async () => {
    const { service, prisma } = setup();
    prisma.roomImage.count.mockResolvedValue(MAX_IMAGES_PER_ROOM);
    await expect(service.addImage(1, file(PNG))).rejects.toThrow(
      ConflictException,
    );
    expect(storedFiles()).toHaveLength(0);
  });

  it('UT-IMG-04 removes the written file again when the DB insert fails', async () => {
    const { service, prisma } = setup();
    prisma.roomImage.create.mockRejectedValue(new Error('db down'));
    await expect(service.addImage(1, file(PNG))).rejects.toThrow('db down');
    expect(storedFiles()).toHaveLength(0);
  });

  it('UT-IMG-05 deleting an image of another room -> 404', async () => {
    const { service, prisma } = setup();
    prisma.roomImage.findFirst.mockResolvedValue(null);
    await expect(service.removeImage(1, 5)).rejects.toThrow(NotFoundException);
    expect(prisma.roomImage.findFirst).toHaveBeenCalledWith({
      where: { id: 5, roomId: 1 },
    });
  });
});
