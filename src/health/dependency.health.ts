import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import { probeMysql } from './probes/mysql.probe';
import { probeRedis } from './probes/redis.probe';

/** Short, credential-free reason for the public health response. */
function reason(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code ?? error.message;
  }
  return 'unknown error';
}

@Injectable()
export class DependencyHealthIndicator {
  private readonly logger = new Logger(DependencyHealthIndicator.name);

  constructor(
    private readonly indicator: HealthIndicatorService,
    private readonly config: ConfigService,
  ) {}

  private get timeoutMs(): number {
    return this.config.get<number>('HEALTH_CHECK_TIMEOUT_MS', 3000);
  }

  /**
   * Database reachability. Once PrismaService exists this can be swapped for
   * terminus' built-in PrismaHealthIndicator.pingCheck() (runs SELECT 1).
   */
  async database(key = 'database') {
    const session = this.indicator.check(key);
    const url = new URL(this.config.getOrThrow<string>('DATABASE_URL'));
    try {
      const { serverVersion } = await probeMysql(
        url.hostname,
        Number(url.port || 3306),
        this.timeoutMs,
      );
      return session.up({ serverVersion });
    } catch (error) {
      this.logger.warn(`MySQL health check failed: ${reason(error)}`);
      return session.down({ message: reason(error) });
    }
  }

  async redis(key = 'redis') {
    const session = this.indicator.check(key);
    const url = new URL(this.config.getOrThrow<string>('REDIS_URL'));
    const tls = url.protocol === 'rediss:';
    try {
      await probeRedis(
        {
          host: url.hostname,
          port: Number(url.port || 6379),
          tls,
          username: url.username ? decodeURIComponent(url.username) : undefined,
          password: url.password ? decodeURIComponent(url.password) : undefined,
        },
        this.timeoutMs,
      );
      return session.up();
    } catch (error) {
      this.logger.warn(`Redis health check failed: ${reason(error)}`);
      return session.down({ message: reason(error) });
    }
  }
}
