import { Booking, BookingStatus, Prisma } from '@prisma/client';
import { countNights } from '../common/utils/date-range';

/** Never select passwordHash or anything else sensitive (NFR-4). */
export const bookingInclude = {
  room: { select: { id: true, name: true, pricePerNight: true } },
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.BookingInclude;

export type BookingWithRelations = Prisma.BookingGetPayload<{
  include: typeof bookingInclude;
}>;

export interface BookingResponse {
  id: number;
  status: BookingStatus;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  guests: number;
  totalPrice: number;
  room: { id: number; name: string; pricePerNight: number };
  user: { id: number; name: string; email: string };
  createdAt: Date;
  updatedAt: Date;
}

export function toBookingResponse(b: BookingWithRelations): BookingResponse {
  return {
    id: b.id,
    status: b.status,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: countNights(b.checkIn, b.checkOut),
    guests: b.guests,
    totalPrice: b.totalPrice.toNumber(),
    room: {
      id: b.room.id,
      name: b.room.name,
      pricePerNight: b.room.pricePerNight.toNumber(),
    },
    user: b.user,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

export function describeStay(b: Pick<Booking, 'checkIn' | 'checkOut'>) {
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return `${d(b.checkIn)} to ${d(b.checkOut)}`;
}
