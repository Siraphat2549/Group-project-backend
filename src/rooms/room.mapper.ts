import { Room, RoomImage } from '@prisma/client';

export type RoomWithImages = Room & { images: RoomImage[] };

export interface RoomImageResponse {
  id: number;
  url: string;
  originalName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: Date;
}

export interface RoomResponse {
  id: number;
  name: string;
  description: string | null;
  capacity: number;
  pricePerNight: number;
  isActive: boolean;
  images: RoomImageResponse[];
  createdAt: Date;
  updatedAt: Date;
}

export function toImageResponse(img: RoomImage): RoomImageResponse {
  return {
    id: img.id,
    url: img.url,
    originalName: img.originalName,
    mimeType: img.mimeType,
    sizeBytes: img.sizeBytes,
    createdAt: img.createdAt,
  };
}

export function toRoomResponse(room: RoomWithImages): RoomResponse {
  return {
    id: room.id,
    name: room.name,
    description: room.description,
    capacity: room.capacity,
    // Decimal -> number so clients get JSON numbers, not strings.
    pricePerNight: room.pricePerNight.toNumber(),
    isActive: room.isActive,
    images: room.images.map(toImageResponse),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}
