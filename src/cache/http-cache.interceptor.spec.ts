import { CallHandler, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { lastValueFrom, of, throwError } from 'rxjs';
import { RedisService } from '../redis/redis.service';
import { CachedResponse, InvalidatesCache } from './cache.decorators';
import { CacheService } from './cache.service';
import {
  CACHE_HEADER,
  HttpCacheInterceptor,
  requestCacheId,
} from './http-cache.interceptor';

/** In-memory stand-in for the four Redis commands the cache uses. */
function fakeRedis() {
  const store = new Map<string, string>();
  const state = { ready: true };
  const client = {
    mget: (keys: string[]) =>
      Promise.resolve(keys.map((key) => store.get(key) ?? null)),
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    set: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    },
    pipeline: () => {
      const keys: string[] = [];
      const pipeline = {
        incr: (key: string) => {
          keys.push(key);
          return pipeline;
        },
        exec: () => {
          for (const key of keys) {
            store.set(key, String(Number(store.get(key) ?? 0) + 1));
          }
          return Promise.resolve([]);
        },
      };
      return pipeline;
    },
  };
  const redis = {
    client,
    get isReady() {
      return state.ready;
    },
  } as unknown as RedisService;
  return { redis, store, state };
}

class Routes {
  @CachedResponse('rooms')
  listRooms() {}

  @CachedResponse('rooms', 'bookings')
  searchRooms() {}

  @InvalidatesCache('rooms')
  updateRoom() {}

  @InvalidatesCache('bookings')
  createBooking() {}

  plain() {}
}

function setup(ttlSeconds = 60) {
  const { redis, store, state } = fakeRedis();
  const cache = new CacheService(redis, {
    get: () => ttlSeconds,
  } as unknown as ConfigService);
  const interceptor = new HttpCacheInterceptor(new Reflector(), cache);
  const routes = new Routes();

  /** Runs one request through the interceptor; `body` is what the handler returns. */
  async function call(
    handler: keyof Routes,
    body: unknown,
    req: Record<string, unknown> = {},
  ) {
    const headers: Record<string, string> = {};
    const request = { method: 'GET', path: '/rooms', query: {}, ...req };
    const ctx = {
      // Only used as a metadata key, never called.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      getHandler: () => routes[handler],
      getClass: () => Routes,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({
          setHeader: (name: string, value: string) => (headers[name] = value),
        }),
      }),
    } as unknown as ExecutionContext;
    const handle = jest.fn(() =>
      body instanceof Error ? throwError(() => body) : of(body),
    );
    const result: unknown = await lastValueFrom(
      interceptor.intercept(ctx, { handle } as CallHandler),
    );
    // Let the fire-and-forget cache write settle before the next request.
    await new Promise((resolve) => setImmediate(resolve));
    return {
      result,
      cache: headers[CACHE_HEADER],
      handlerRan: handle.mock.calls.length > 0,
    };
  }

  return { call, store, state };
}

describe('HttpCacheInterceptor', () => {
  it('MISS runs the handler, HIT serves the stored body without it', async () => {
    const { call } = setup();
    const first = await call('listRooms', { data: [{ id: 1 }] });
    const second = await call('listRooms', { data: 'handler must not run' });

    expect(first).toMatchObject({ cache: 'MISS', handlerRan: true });
    expect(second).toEqual({
      result: { data: [{ id: 1 }] },
      cache: 'HIT',
      handlerRan: false,
    });
  });

  it('keeps a separate entry per path and query', async () => {
    const { call } = setup();
    await call('listRooms', 'capacity 2', { query: { capacity: '2' } });
    const other = await call('listRooms', 'capacity 4', {
      query: { capacity: '4' },
    });
    const same = await call('listRooms', 'x', { query: { capacity: '2' } });

    expect(other).toMatchObject({ cache: 'MISS', result: 'capacity 4' });
    expect(same).toMatchObject({ cache: 'HIT', result: 'capacity 2' });
  });

  it('a room change drops room list and search entries', async () => {
    const { call } = setup();
    await call('listRooms', 'old list');
    await call('searchRooms', 'old search', { path: '/rooms/search' });

    await call('updateRoom', { message: 'Room updated' }, { method: 'PATCH' });

    expect(await call('listRooms', 'new list')).toMatchObject({
      cache: 'MISS',
      result: 'new list',
    });
    expect(
      await call('searchRooms', 'new search', { path: '/rooms/search' }),
    ).toMatchObject({ cache: 'MISS', result: 'new search' });
  });

  it('a booking change drops search entries but keeps the room list', async () => {
    const { call } = setup();
    await call('listRooms', 'list');
    await call('searchRooms', 'room 1 is free', { path: '/rooms/search' });

    await call(
      'createBooking',
      { message: 'Booking created' },
      { method: 'POST' },
    );

    expect(
      await call('searchRooms', 'room 1 is taken', { path: '/rooms/search' }),
    ).toMatchObject({ cache: 'MISS', result: 'room 1 is taken' });
    expect(await call('listRooms', 'x')).toMatchObject({
      cache: 'HIT',
      result: 'list',
    });
  });

  it('a failed mutation does not invalidate, a failed read is not cached', async () => {
    const { call } = setup();
    await call('listRooms', 'list');
    await expect(
      call('updateRoom', new Error('validation failed'), { method: 'PATCH' }),
    ).rejects.toThrow('validation failed');
    expect(await call('listRooms', 'x')).toMatchObject({ cache: 'HIT' });

    await expect(
      call('listRooms', new Error('boom'), { path: '/rooms/9' }),
    ).rejects.toThrow('boom');
    expect(await call('listRooms', 'ok', { path: '/rooms/9' })).toMatchObject({
      cache: 'MISS',
      result: 'ok',
    });
  });

  it('admins bypass the cache in both directions', async () => {
    const { call } = setup();
    const admin = { user: { id: 1, email: 'a@b.c', role: Role.ADMIN } };

    const adminView = await call('listRooms', 'with inactive rooms', admin);
    const publicView = await call('listRooms', 'active rooms only');
    const adminAgain = await call('listRooms', 'fresh admin view', admin);

    expect(adminView).toMatchObject({ cache: 'BYPASS', handlerRan: true });
    expect(publicView).toMatchObject({
      cache: 'MISS',
      result: 'active rooms only',
    });
    expect(adminAgain).toMatchObject({
      cache: 'BYPASS',
      result: 'fresh admin view',
    });
  });

  it('serves from the database when Redis is down', async () => {
    const { call, state } = setup();
    state.ready = false;
    expect(await call('listRooms', 'from db')).toMatchObject({
      cache: 'MISS',
      result: 'from db',
      handlerRan: true,
    });
    expect(await call('listRooms', 'from db again')).toMatchObject({
      cache: 'MISS',
      result: 'from db again',
    });
  });

  it('does nothing for undecorated routes or when CACHE_TTL_SECONDS=0', async () => {
    const plain = await setup().call('plain', 'x');
    expect(plain).toMatchObject({ cache: undefined, handlerRan: true });

    const disabled = setup(0);
    await disabled.call('listRooms', 'a');
    expect(await disabled.call('listRooms', 'b')).toMatchObject({
      cache: undefined,
      result: 'b',
    });
  });
});

describe('requestCacheId', () => {
  it('ignores query parameter order but not values', () => {
    const a = requestCacheId({ path: '/rooms', query: { a: '1', b: '2' } });
    const b = requestCacheId({ path: '/rooms', query: { b: '2', a: '1' } });
    const c = requestCacheId({ path: '/rooms', query: { a: '1', b: '3' } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
