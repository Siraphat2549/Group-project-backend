import { ConflictException } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';

const { PENDING, APPROVED, CANCELLED, PAID } = BookingStatus;

/**
 * Allowed status changes (FR-21, FR-26):
 *
 *   PENDING ──► APPROVED ──► PAID
 *      │           │          │
 *      └───────────┴──────────┴──► CANCELLED (terminal)
 *
 * CANCELLED is terminal: re-activating would need a fresh availability
 * check, so the user should create a new booking instead.
 */
export const STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  [PENDING]: [APPROVED, CANCELLED],
  [APPROVED]: [PAID, CANCELLED],
  [PAID]: [CANCELLED],
  [CANCELLED]: [],
};

/** A regular user may cancel their own booking only before it is paid. */
export const USER_CANCELLABLE: BookingStatus[] = [PENDING, APPROVED];

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (from === to) {
    throw new ConflictException(`Booking is already ${to}`);
  }
  if (!canTransition(from, to)) {
    const allowed = STATUS_TRANSITIONS[from];
    throw new ConflictException(
      `Cannot change booking status from ${from} to ${to}` +
        (allowed.length
          ? ` (allowed: ${allowed.join(', ')})`
          : ` (${from} is final)`),
    );
  }
}
