import { SetMetadata } from '@nestjs/common';

/**
 * Rate-limit tiers. Every route gets `default`; sensitive or expensive ones
 * opt into a stricter tier with `@RateLimit(...)`.
 *
 * - `auth`:    sign-up / login - slows down password guessing and mass sign-ups
 * - `booking`: booking creation - each call takes a row lock and a transaction
 */
export type RateLimitTier = 'default' | 'auth' | 'booking';

export const RATE_LIMIT_TIER_KEY = 'rate-limit:tier';

export const RateLimit = (tier: RateLimitTier) =>
  SetMetadata(RATE_LIMIT_TIER_KEY, tier);
