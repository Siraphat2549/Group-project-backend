import { RedisService } from '../redis/redis.service';
import { TokenRevocationService } from './token-revocation.service';

/** Just enough of Redis for this service: SET with EX, and MGET. */
function fakeRedis() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  const state = { ready: true, failing: false };
  const client = {
    set: jest.fn((key: string, value: string, _ex: 'EX', seconds: number) => {
      if (state.failing) return Promise.reject(new Error('Redis down'));
      store.set(key, value);
      ttls.set(key, seconds);
      return Promise.resolve('OK');
    }),
    mget: jest.fn((...keys: string[]) =>
      state.failing
        ? Promise.reject(new Error('Redis down'))
        : Promise.resolve(keys.map((key) => store.get(key) ?? null)),
    ),
  };
  const redis = {
    client,
    get isReady() {
      return state.ready;
    },
  } as unknown as RedisService;
  return { redis, store, ttls, state };
}

const now = () => Math.floor(Date.now() / 1000);

describe('TokenRevocationService', () => {
  it('a token is valid until revoked, then rejected', async () => {
    const { redis } = fakeRedis();
    const service = new TokenRevocationService(redis);
    const token = { jti: 'a', iat: now(), exp: now() + 600 };

    await expect(service.isRevoked(1, token)).resolves.toBe(false);
    await service.revoke(token);
    await expect(service.isRevoked(1, token)).resolves.toBe(true);
  });

  it('revoking one token leaves the same user`s other tokens valid', async () => {
    const { redis } = fakeRedis();
    const service = new TokenRevocationService(redis);
    await service.revoke({ jti: 'phone', iat: now(), exp: now() + 600 });
    await expect(
      service.isRevoked(1, { jti: 'laptop', iat: now(), exp: now() + 600 }),
    ).resolves.toBe(false);
  });

  it('keeps the marker only until the token would expire anyway', async () => {
    const { redis, ttls, store } = fakeRedis();
    const service = new TokenRevocationService(redis);

    await service.revoke({ jti: 'a', iat: now() - 100, exp: now() + 300 });
    const ttl = ttls.get('auth:revoked:a') ?? 0;
    expect(ttl).toBeGreaterThan(295);
    expect(ttl).toBeLessThanOrEqual(300);

    await service.revoke({ jti: 'old', iat: now() - 900, exp: now() - 10 });
    expect(store.has('auth:revoked:old')).toBe(false);
  });

  it('revokeAllForUser rejects older tokens of that user only', async () => {
    const { redis } = fakeRedis();
    const service = new TokenRevocationService(redis);
    const older = { jti: 'old', iat: now() - 60, exp: now() + 600 };
    const fresh = { jti: 'new', iat: now(), exp: now() + 660 };

    await service.revokeAllForUser(1, 3600);

    await expect(service.isRevoked(1, older)).resolves.toBe(true);
    await expect(service.isRevoked(1, fresh)).resolves.toBe(false);
    await expect(service.isRevoked(2, older)).resolves.toBe(false);
  });

  it('fails open when Redis is unreachable, but revoke reports the failure', async () => {
    const { redis, state } = fakeRedis();
    const service = new TokenRevocationService(redis);
    const token = { jti: 'a', iat: now(), exp: now() + 600 };

    state.ready = false;
    await expect(service.isRevoked(1, token)).resolves.toBe(false);

    state.ready = true;
    state.failing = true;
    await expect(service.isRevoked(1, token)).resolves.toBe(false);
    await expect(service.revoke(token)).rejects.toThrow('Redis down');
  });
});
