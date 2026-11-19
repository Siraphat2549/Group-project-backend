import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Prisma's own log levels. Never `query`: queries can contain user data.
 *
 * Under test, `error` is left out: many tests trigger expected database
 * errors on purpose (duplicate email / room name -> 409), and Prisma would
 * print each one even though the API catches and maps it. Unexpected errors
 * still fail the test (500 response) and are logged by the exception filter.
 */
export function prismaLogLevels(
  nodeEnv: string | undefined,
): Prisma.LogLevel[] {
  return nodeEnv === 'test' ? ['warn'] : ['warn', 'error'];
}

/**
 * Single shared Prisma client. Connects lazily on the first query, so the API
 * still boots (and /health reports the outage) when MySQL is down (NFR-9).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ log: prismaLogLevels(process.env.NODE_ENV) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
