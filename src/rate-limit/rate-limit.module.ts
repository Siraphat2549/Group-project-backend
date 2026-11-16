import { ExecutionContext, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { RATE_LIMIT_TIER_KEY, RateLimitTier } from './rate-limit.decorator';
import { RedisThrottlerStorage } from './redis-throttler.storage';

@Module({
  providers: [RedisThrottlerStorage],
  exports: [RedisThrottlerStorage],
})
class RateLimitStorageModule {}

/**
 * Global per-IP rate limiting (Task 4, NFR-7).
 *
 * One window (`THROTTLE_TTL_MS`) with a limit picked per route from its
 * `@RateLimit` tier. Counters are kept per client IP *and* per route, so
 * hammering `/auth/login` never uses up the budget for browsing rooms.
 * Blocked requests get `429` with a `Retry-After` header; every response
 * carries `X-RateLimit-Limit/Remaining/Reset`.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RateLimitStorageModule],
      inject: [ConfigService, Reflector, RedisThrottlerStorage],
      useFactory: (
        config: ConfigService,
        reflector: Reflector,
        storage: RedisThrottlerStorage,
      ) => {
        const limits: Record<RateLimitTier, number> = {
          default: config.get<number>('THROTTLE_LIMIT', 120),
          auth: config.get<number>('THROTTLE_AUTH_LIMIT', 10),
          booking: config.get<number>('THROTTLE_BOOKING_LIMIT', 20),
        };
        return {
          storage,
          errorMessage: 'Too many requests, please try again later',
          throttlers: [
            {
              ttl: config.get<number>('THROTTLE_TTL_MS', 60000),
              limit: (ctx: ExecutionContext) => {
                const tier = reflector.getAllAndOverride<
                  RateLimitTier | undefined
                >(RATE_LIMIT_TIER_KEY, [ctx.getHandler(), ctx.getClass()]);
                return limits[tier ?? 'default'];
              },
            },
          ],
        };
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
