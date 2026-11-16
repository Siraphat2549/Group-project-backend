import { ConflictException } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { assertTransition, canTransition } from './booking-status';

const { PENDING, APPROVED, CANCELLED, PAID } = BookingStatus;

describe('booking status transitions (FR-21, FR-26)', () => {
  it.each([
    [PENDING, APPROVED],
    [PENDING, CANCELLED],
    [APPROVED, PAID],
    [APPROVED, CANCELLED],
    [PAID, CANCELLED],
  ])('%s → %s is allowed', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each([
    [PENDING, PAID],
    [PAID, APPROVED],
    [PAID, PENDING],
    [CANCELLED, PENDING],
    [CANCELLED, APPROVED],
    [CANCELLED, PAID],
  ])('%s → %s is rejected with 409', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(ConflictException);
  });

  it('rejects setting the same status', () => {
    expect(() => assertTransition(APPROVED, APPROVED)).toThrow(
      'Booking is already APPROVED',
    );
  });

  it('says CANCELLED is final', () => {
    expect(() => assertTransition(CANCELLED, APPROVED)).toThrow(
      /CANCELLED is final/,
    );
  });
});
