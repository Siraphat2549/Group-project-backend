import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { AuthUser } from '../../auth/auth-user.interface';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Accept a caller-supplied id only if it is short and harmless to log. */
const SAFE_REQUEST_ID = /^[\w.-]{1,64}$/;

/**
 * One log line per request, written when the response is sent (NFR-15/16):
 *
 *   GET /rooms/3 200 12ms ip=203.0.113.9 user=42 req=5f0c...
 *
 * Only metadata is logged. Request bodies, query strings and headers are
 * left out on purpose: they carry passwords and tokens (NFR-4).
 *
 * Each response also gets an `X-Request-Id`; a client can quote it in a bug
 * report and the matching log line is one search away.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request & { user?: AuthUser }, res: Response, next: NextFunction) {
    const startedAt = process.hrtime.bigint();
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId =
      incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, requestId);

    res.on('finish', () => {
      const path = req.originalUrl.split('?')[0];
      const { statusCode } = res;
      // Health probes hit every few seconds; only log them when they fail.
      if (path.startsWith('/health') && statusCode < 400) return;

      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const line =
        `${req.method} ${path} ${statusCode} ${ms.toFixed(0)}ms` +
        ` ip=${req.ip ?? '-'} user=${req.user?.id ?? '-'} req=${requestId}`;

      if (statusCode >= 500) this.logger.error(line);
      else if (statusCode >= 400) this.logger.warn(line);
      else this.logger.log(line);
    });

    next();
  }
}
