import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** Every key this API writes is namespaced, so a shared Redis stays tidy. */
export const REDIS_KEY_PREFIX = 'hotel:';

/**
 * One shared Redis connection for caching, rate limiting and token
 * revocation.
 *
 * Redis is an optimisation, not a source of truth, so the client is tuned to
 * fail fast: while disconnected, commands reject immediately instead of
 * queueing, and each caller decides how to degrade (NFR-9). ioredis keeps
 * reconnecting in the background.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private outageLogged = false;
  readonly client: Redis;

  constructor(config: ConfigService) {
    // rediss:// URLs enable TLS automatically (managed cloud Redis).
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      keyPrefix: REDIS_KEY_PREFIX,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      commandTimeout: 2000,
      retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
    });

    this.client.on('ready', () => {
      this.outageLogged = false;
      this.logger.log('Redis connection ready');
    });
    // Without a listener ioredis prints every reconnect failure; log one
    // line per outage instead. Error codes never contain credentials.
    this.client.on('error', (error: NodeJS.ErrnoException) => {
      if (this.outageLogged) return;
      this.outageLogged = true;
      this.logger.warn(
        `Redis unavailable (${error.code ?? error.name}); cache, rate limiting and logout fall back until it returns`,
      );
    });
  }

  /** True when commands can be sent right now. */
  get isReady(): boolean {
    return this.client.status === 'ready';
  }

  async onModuleDestroy(): Promise<void> {
    // QUIT lets pending replies finish; without a live connection there is
    // nothing to wait for, so just stop the reconnect loop.
    if (this.isReady) {
      try {
        await this.client.quit();
        return;
      } catch {
        // fall through to a hard disconnect
      }
    }
    this.client.disconnect();
  }
}
