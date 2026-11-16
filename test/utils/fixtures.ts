import { randomUUID } from 'node:crypto';

/** `Authorization` header value for a JWT. */
export const bearer = (token: string) => `Bearer ${token}`;

/** Unique, valid email so tests never collide on the unique constraint. */
export const uniqueEmail = (prefix = 'user') =>
  `${prefix}.${randomUUID().slice(0, 8)}@test.local`;

/**
 * ISO-8601 date-time `days` from `from` (default now) at `hour`:00 UTC,
 * for booking check-in / check-out (FR-18 uses date/time).
 */
export function isoDateTime(
  days: number,
  hour = 14,
  from = new Date(),
): string {
  const d = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour);
  return d.toISOString();
}
