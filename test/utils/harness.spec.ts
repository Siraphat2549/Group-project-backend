import { applyTestEnv, assertTestDatabaseUrl } from '../setup/test-env';
import { RawSqlClient, RawSqlExecutor, truncateAllTables } from './db-cleanup';
import { bearer, isoDateTime, uniqueEmail } from './fixtures';

describe('test harness', () => {
  describe('assertTestDatabaseUrl', () => {
    it('UT-HARN-01 accepts a *_test database', () => {
      expect(() =>
        assertTestDatabaseUrl('mysql://u:p@localhost:3307/hotel_booking_test'),
      ).not.toThrow();
    });

    it.each([
      'mysql://u:p@localhost:3306/hotel_booking',
      'mysql://u:p@localhost:3306/test_hotel',
      'mysql://u:p@localhost:3306/',
    ])('UT-HARN-02 refuses %s', (url) => {
      expect(() => assertTestDatabaseUrl(url)).toThrow(/Refusing/);
    });

    it('UT-HARN-03 does not echo credentials for an invalid URL', () => {
      expect(() => assertTestDatabaseUrl('nope secret-pw')).toThrow(
        /^Test DATABASE_URL is not a valid URL$/,
      );
    });
  });

  describe('applyTestEnv', () => {
    it('UT-HARN-04 always replaces DATABASE_URL, even if a dev URL is exported', () => {
      const env: NodeJS.ProcessEnv = {
        DATABASE_URL: 'mysql://u:p@prod-db:3306/hotel_booking',
        THROTTLE_LIMIT: '5',
      };
      applyTestEnv(env);
      expect(env.NODE_ENV).toBe('test');
      expect(env.DATABASE_URL).toMatch(/\/hotel_booking_test$/);
      expect(env.THROTTLE_LIMIT).toBe('5'); // explicit values are kept
      expect(env.JWT_SECRET).toBeTruthy();
    });

    it('UT-HARN-05 rejects a TEST_DATABASE_URL that is not a test DB', () => {
      expect(() =>
        applyTestEnv({ TEST_DATABASE_URL: 'mysql://u:p@h:3306/hotel_booking' }),
      ).toThrow(/Refusing/);
    });
  });

  describe('truncateAllTables', () => {
    function fakeDb(database: string) {
      const executed: string[] = [];
      const exec: RawSqlExecutor = {
        $queryRawUnsafe: <T>(sql: string) =>
          Promise.resolve(
            (sql.includes('DATABASE() AS name')
              ? [{ name: database }]
              : [
                  { name: 'User' },
                  { name: 'Booking' },
                  { name: '_prisma_migrations' },
                ]) as T,
          ),
        $executeRawUnsafe: (sql: string) => {
          executed.push(sql);
          return Promise.resolve(0);
        },
      };
      const db: RawSqlClient = { ...exec, $transaction: (fn) => fn(exec) };
      return { db, executed };
    }

    it('UT-HARN-06 empties every table except migrations, with FK checks off', async () => {
      const { db, executed } = fakeDb('hotel_booking_test');
      await expect(truncateAllTables(db)).resolves.toEqual(['User', 'Booking']);
      expect(executed).toEqual([
        'SET FOREIGN_KEY_CHECKS = 0',
        'DELETE FROM `User`',
        'DELETE FROM `Booking`',
        'SET FOREIGN_KEY_CHECKS = 1',
      ]);
    });

    it('UT-HARN-07 refuses to clean a non-test database', async () => {
      const { db, executed } = fakeDb('hotel_booking');
      await expect(truncateAllTables(db)).rejects.toThrow(/Refusing/);
      expect(executed).toEqual([]);
    });
  });

  describe('fixtures', () => {
    it('UT-HARN-08 isoDateTime offsets whole UTC days at the given hour', () => {
      const from = new Date('2026-11-30T23:00:00Z');
      expect(isoDateTime(1, 14, from)).toBe('2026-12-01T14:00:00.000Z');
      expect(isoDateTime(-1, 12, new Date('2026-03-01T00:00:00Z'))).toBe(
        '2026-02-28T12:00:00.000Z',
      );
    });

    it('UT-HARN-09 uniqueEmail never repeats; bearer builds the header', () => {
      expect(uniqueEmail()).not.toBe(uniqueEmail());
      expect(bearer('abc')).toBe('Bearer abc');
    });
  });
});
