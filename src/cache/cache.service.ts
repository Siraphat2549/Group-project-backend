import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';

/**
 * Groups of data a cached response depends on. Each group has a version
 * counter in Redis; bumping it makes every entry built from it unreachable.
 */
export type CacheGroup = 'rooms' | 'bookings';

export interface CacheLookup<T> {
  /** Where to store a freshly computed value; undefined = caching is off. */
  key?: string;
  /** Present only on a hit. */
  value?: T;
}

const versionKey = (group: CacheGroup) => `cache:version:${group}`;

/**
 * Redis-backed response cache with version-based invalidation.
 *
 * An entry's key embeds the current version of every group it depends on:
 *
 *   cache:data:rooms=7,bookings=42:<id>
 *
 * Invalidation is a single atomic `INCR` of the group version - O(1), no
 * `KEYS`/`SCAN`, and correct across several API instances (NFR-11). Stale
 * entries are never read again and expire through their TTL.
 *
 * Every Redis failure degrades to "no cache": reads miss, writes are
 * skipped, and the request is served from MySQL (NFR-9).
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.ttlSeconds = config.get<number>('CACHE_TTL_SECONDS', 60);
  }

  get enabled(): boolean {
    return this.ttlSeconds > 0;
  }

  /**
   * Looks up `id` among entries built from the current versions of `groups`.
   * The returned key must be reused for `store`, so a value computed from
   * data older than a concurrent invalidation lands under the old version
   * and is never served.
   */
  async lookup<T>(groups: CacheGroup[], id: string): Promise<CacheLookup<T>> {
    if (!this.enabled || !this.redis.isReady) return {};
    try {
      const versions = await this.redis.client.mget(groups.map(versionKey));
      const tag = groups.map((g, i) => `${g}=${versions[i] ?? '0'}`).join(',');
      const key = `cache:data:${tag}:${id}`;
      const raw = await this.redis.client.get(key);
      if (raw === null) return { key };
      return { key, value: JSON.parse(raw) as T };
    } catch (error) {
      this.logger.warn(`Cache read skipped: ${(error as Error).message}`);
      return {};
    }
  }

  async store(key: string, value: unknown): Promise<void> {
    if (!this.enabled || !this.redis.isReady) return;
    try {
      const raw = JSON.stringify(value);
      if (raw === undefined) return;
      await this.redis.client.set(key, raw, 'EX', this.ttlSeconds);
    } catch (error) {
      this.logger.warn(`Cache write skipped: ${(error as Error).message}`);
    }
  }

  /** Drops every cached response that depends on any of `groups`. */
  async invalidate(...groups: CacheGroup[]): Promise<void> {
    if (!this.enabled || groups.length === 0) return;
    try {
      const pipeline = this.redis.client.pipeline();
      for (const group of groups) pipeline.incr(versionKey(group));
      await pipeline.exec();
    } catch (error) {
      // Worst case: stale data for at most CACHE_TTL_SECONDS.
      this.logger.warn(
        `Cache invalidation failed for [${groups.join(', ')}], entries expire within ${this.ttlSeconds}s: ${(error as Error).message}`,
      );
    }
  }
}
