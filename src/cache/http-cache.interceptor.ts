import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { Request, Response } from 'express';
import { from, Observable, of } from 'rxjs';
import { mergeMap, tap } from 'rxjs/operators';
import { AuthUser, isAdmin } from '../auth/auth-user.interface';
import { CACHED_GROUPS_KEY, INVALIDATED_GROUPS_KEY } from './cache.decorators';
import { CacheGroup, CacheService } from './cache.service';

/** Tells clients (and the tests) how the response was produced. */
export const CACHE_HEADER = 'X-Cache';

/**
 * Stable cache id for a request: path + query with keys sorted, so
 * `?a=1&b=2` and `?b=2&a=1` share one entry. Hashed to keep keys short and
 * free of user-controlled characters.
 */
export function requestCacheId(req: Pick<Request, 'path' | 'query'>): string {
  const query = Object.entries(req.query)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .sort()
    .join('&');
  return createHash('sha256').update(`${req.path}?${query}`).digest('hex');
}

/**
 * Global interceptor driven by two decorators:
 *
 * - `@CachedResponse(...groups)` on a GET handler: serve from Redis when
 *   possible, otherwise run the handler and cache its result.
 * - `@InvalidatesCache(...groups)` on a mutation: after it succeeds, bump
 *   the group versions so no stale response is served.
 *
 * Admin requests always bypass the cache: admins can see deactivated rooms,
 * and what they see must never leak into the shared public entries.
 */
@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const invalidates = this.groups(INVALIDATED_GROUPS_KEY, ctx);
    if (invalidates.length > 0) {
      return next.handle().pipe(
        mergeMap(async (body: unknown) => {
          // Awaited, so the client gets its answer only after the old
          // entries are gone and its next read is guaranteed fresh.
          await this.cache.invalidate(...invalidates);
          return body;
        }),
      );
    }

    const groups = this.groups(CACHED_GROUPS_KEY, ctx);
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request & { user?: AuthUser }>();
    if (groups.length === 0 || req.method !== 'GET' || !this.cache.enabled) {
      return next.handle();
    }

    const res = http.getResponse<Response>();
    if (isAdmin(req.user)) {
      res.setHeader(CACHE_HEADER, 'BYPASS');
      return next.handle();
    }

    return from(this.cache.lookup<unknown>(groups, requestCacheId(req))).pipe(
      mergeMap(({ key, value }) => {
        if (value !== undefined) {
          res.setHeader(CACHE_HEADER, 'HIT');
          return of(value);
        }
        res.setHeader(CACHE_HEADER, 'MISS');
        return next.handle().pipe(
          // Only successful responses reach `tap`; errors are never cached.
          tap((body: unknown) => {
            if (key) void this.cache.store(key, body);
          }),
        );
      }),
    );
  }

  private groups(metadataKey: string, ctx: ExecutionContext): CacheGroup[] {
    return (
      this.reflector.get<CacheGroup[] | undefined>(
        metadataKey,
        ctx.getHandler(),
      ) ?? []
    );
  }
}
