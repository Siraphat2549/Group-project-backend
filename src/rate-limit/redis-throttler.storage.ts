import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from '../redis/redis.service';

/** Same shape as @nestjs/throttler's ThrottlerStorageRecord (times in seconds). */
export interface RateLimitRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Fixed-window counter, executed atomically inside Redis so concurrent
 * requests (and several API instances) can never under-count.
 * KEYS[1] = hit counter, KEYS[2] = block flag
 * ARGV[1] = window ms, ARGV[2] = limit, ARGV[3] = block ms
 * Returns { totalHits, msUntilWindowEnds, isBlocked, msUntilUnblocked }.
 */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return { hits, ttl, 1, blockTtl }
end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], 1, 'PX', ARGV[3])
  return { hits, ttl, 1, tonumber(ARGV[3]) }
end
return { hits, ttl, 0, 0 }
`;

interface LocalWindow {
  hits: number;
  expiresAt: number;
  blockedUntil: number;
}

/** Sweep expired local windows once the map grows past this many keys. */
const LOCAL_SWEEP_THRESHOLD = 10_000;

/**
 * Rate-limit counters in Redis, shared by every API instance (NFR-11).
 *
 * If Redis is unreachable the limiter falls back to counting in this
 * process' memory rather than failing requests or dropping protection
 * altogether: limits are then enforced per instance until Redis returns.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly local = new Map<string, LocalWindow>();
  private usingFallback = false;

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<RateLimitRecord> {
    const id = `${throttlerName}:${key}`;
    if (this.redis.isReady) {
      try {
        const record = await this.incrementInRedis(
          id,
          ttl,
          limit,
          blockDuration,
        );
        if (this.usingFallback) {
          this.usingFallback = false;
          this.local.clear();
          this.logger.log('Rate limiting is back on Redis');
        }
        return record;
      } catch (error) {
        this.noteFallback((error as Error).message);
      }
    } else {
      this.noteFallback('not connected');
    }
    return this.incrementLocally(id, ttl, limit, blockDuration, Date.now());
  }

  private async incrementInRedis(
    id: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<RateLimitRecord> {
    const reply = (await this.redis.client.eval(
      INCREMENT_SCRIPT,
      2,
      `throttle:${id}:hits`,
      `throttle:${id}:blocked`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];
    const [totalHits, windowMs, blocked, blockMs] = reply;
    return {
      totalHits,
      timeToExpire: Math.ceil(windowMs / 1000),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.ceil(blockMs / 1000),
    };
  }

  /** Same algorithm as the Lua script, for one process. `now` eases testing. */
  incrementLocally(
    id: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    now: number,
  ): RateLimitRecord {
    if (this.local.size > LOCAL_SWEEP_THRESHOLD) this.sweep(now);

    let window = this.local.get(id);
    if (!window || (window.expiresAt <= now && window.blockedUntil <= now)) {
      window = { hits: 0, expiresAt: now + ttl, blockedUntil: 0 };
      this.local.set(id, window);
    } else if (window.expiresAt <= now) {
      // Window over but still blocked: keep the block, restart the count.
      window.hits = 0;
      window.expiresAt = now + ttl;
    }

    window.hits += 1;
    if (window.blockedUntil <= now && window.hits > limit) {
      window.blockedUntil = now + blockDuration;
    }
    const isBlocked = window.blockedUntil > now;
    return {
      totalHits: window.hits,
      timeToExpire: Math.ceil((window.expiresAt - now) / 1000),
      isBlocked,
      timeToBlockExpire: isBlocked
        ? Math.ceil((window.blockedUntil - now) / 1000)
        : 0,
    };
  }

  private sweep(now: number): void {
    for (const [id, window] of this.local) {
      if (window.expiresAt <= now && window.blockedUntil <= now) {
        this.local.delete(id);
      }
    }
  }

  private noteFallback(reason: string): void {
    if (this.usingFallback) return;
    this.usingFallback = true;
    this.logger.warn(
      `Rate limiting falls back to in-memory counters (Redis: ${reason})`,
    );
  }
}
