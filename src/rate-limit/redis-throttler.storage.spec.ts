import { RedisService } from '../redis/redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';

const WINDOW = 60_000;
const LIMIT = 3;

function storageWith(redis: Partial<RedisService>) {
  return new RedisThrottlerStorage(redis as RedisService);
}

describe('RedisThrottlerStorage', () => {
  it('maps the Redis script reply (ms) to a throttler record (seconds)', async () => {
    const evalMock = jest
      .fn<Promise<number[]>, unknown[]>()
      .mockResolvedValue([2, 59_100, 0, 0]);
    const storage = storageWith({
      isReady: true,
      client: { eval: evalMock } as never,
    });

    const record = await storage.increment(
      'ip-route',
      WINDOW,
      LIMIT,
      WINDOW,
      'default',
    );

    expect(record).toEqual({
      totalHits: 2,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    // script, key count, 2 keys, then window / limit / block duration
    expect(evalMock.mock.calls[0].slice(1)).toEqual([
      2,
      'throttle:default:ip-route:hits',
      'throttle:default:ip-route:blocked',
      WINDOW,
      LIMIT,
      WINDOW,
    ]);
  });

  it('keeps limiting in memory when Redis is down', async () => {
    const storage = storageWith({ isReady: false });
    const hits = [];
    for (let i = 0; i < LIMIT + 1; i++) {
      hits.push(await storage.increment('k', WINDOW, LIMIT, WINDOW, 'default'));
    }
    expect(hits.map((h) => h.isBlocked)).toEqual([false, false, false, true]);
    expect(hits[3].timeToBlockExpire).toBe(60);
  });

  it('falls back to memory when a Redis command fails mid-flight', async () => {
    const storage = storageWith({
      isReady: true,
      client: {
        eval: jest.fn().mockRejectedValue(new Error('Command timed out')),
      } as never,
    });
    await expect(
      storage.increment('k', WINDOW, LIMIT, WINDOW, 'default'),
    ).resolves.toMatchObject({ totalHits: 1, isBlocked: false });
  });

  describe('in-memory window', () => {
    const t0 = 1_000_000;
    const hit = (storage: RedisThrottlerStorage, id: string, at: number) =>
      storage.incrementLocally(id, WINDOW, LIMIT, WINDOW, at);

    it('allows up to the limit, then blocks', () => {
      const storage = storageWith({ isReady: false });
      expect(hit(storage, 'a', t0)).toMatchObject({
        totalHits: 1,
        isBlocked: false,
      });
      hit(storage, 'a', t0 + 1);
      expect(hit(storage, 'a', t0 + 2)).toMatchObject({
        totalHits: 3,
        isBlocked: false,
      });
      expect(hit(storage, 'a', t0 + 3)).toMatchObject({
        totalHits: 4,
        isBlocked: true,
      });
    });

    it('counts each client/route key separately', () => {
      const storage = storageWith({ isReady: false });
      for (let i = 0; i < LIMIT + 1; i++) hit(storage, 'a', t0);
      expect(hit(storage, 'b', t0)).toMatchObject({
        totalHits: 1,
        isBlocked: false,
      });
    });

    it('starts a fresh window once the old one and its block are over', () => {
      const storage = storageWith({ isReady: false });
      for (let i = 0; i < LIMIT + 1; i++) hit(storage, 'a', t0);
      expect(hit(storage, 'a', t0 + WINDOW - 1).isBlocked).toBe(true);
      expect(hit(storage, 'a', t0 + WINDOW + 1)).toMatchObject({
        totalHits: 1,
        isBlocked: false,
      });
    });
  });
});
