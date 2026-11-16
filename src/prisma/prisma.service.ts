import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Single shared Prisma client. Connects lazily on the first query, so the API
 * still boots (and /health reports the outage) when MySQL is down (NFR-9).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    // Only warnings/errors; never log queries (they can contain user data).
    super({ log: ['warn', 'error'] });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
