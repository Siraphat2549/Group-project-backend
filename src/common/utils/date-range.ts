import { BadRequestException } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Longest stay accepted in a single booking or search. */
export const MAX_STAY_NIGHTS = 30;

/**
 * Statuses that occupy a room. Cancelled bookings free the slot again,
 * so they never block availability or cause a double-booking conflict.
 */
export const BLOCKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.APPROVED,
  BookingStatus.PAID,
];

export interface DateRange {
  checkIn: Date;
  checkOut: Date;
}

/**
 * Validates a check-in/check-out pair (FR-19):
 *  - both are real dates
 *  - check-in is strictly before check-out
 *  - check-in is not in the past (unless allowPast)
 *  - stay is at most MAX_STAY_NIGHTS
 * Throws 400 with a human-readable message otherwise.
 */
export function parseDateRange(
  checkInRaw: string,
  checkOutRaw: string,
  { now = new Date(), allowPast = false } = {},
): DateRange {
  const checkIn = new Date(checkInRaw);
  const checkOut = new Date(checkOutRaw);

  if (Number.isNaN(checkIn.getTime())) {
    throw new BadRequestException('checkIn is not a valid date');
  }
  if (Number.isNaN(checkOut.getTime())) {
    throw new BadRequestException('checkOut is not a valid date');
  }
  if (checkIn.getTime() >= checkOut.getTime()) {
    throw new BadRequestException('checkIn must be before checkOut');
  }
  if (!allowPast && checkIn.getTime() < now.getTime()) {
    throw new BadRequestException('checkIn cannot be in the past');
  }
  if (countNights(checkIn, checkOut) > MAX_STAY_NIGHTS) {
    throw new BadRequestException(
      `A stay cannot be longer than ${MAX_STAY_NIGHTS} nights`,
    );
  }
  return { checkIn, checkOut };
}

/** Billable nights; any partial day counts as a full night. */
export function countNights(checkIn: Date, checkOut: Date): number {
  return Math.ceil((checkOut.getTime() - checkIn.getTime()) / MS_PER_DAY);
}

/**
 * Half-open interval overlap: [aIn, aOut) and [bIn, bOut) clash iff
 * aIn < bOut && bIn < aOut. Back-to-back stays (one checks out the
 * moment the next checks in) do NOT overlap.
 */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return (
    a.checkIn.getTime() < b.checkOut.getTime() &&
    b.checkIn.getTime() < a.checkOut.getTime()
  );
}

/**
 * Prisma `where` fragment matching bookings that occupy any part of `range`.
 * Must stay equivalent to rangesOverlap().
 */
export function overlappingBookingsWhere(range: DateRange) {
  return {
    status: { in: BLOCKING_STATUSES },
    checkIn: { lt: range.checkOut },
    checkOut: { gt: range.checkIn },
  };
}
