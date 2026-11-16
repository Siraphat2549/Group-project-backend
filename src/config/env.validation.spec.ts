import { validateEnv } from './env.validation';

const base = {
  DATABASE_URL: 'mysql://user:secret@localhost:3306/hotel_booking',
  REDIS_URL: 'redis://localhost:6379',
};

describe('validateEnv', () => {
  it('applies defaults and coerces numbers', () => {
    const env = validateEnv({ ...base, PORT: '8080' });
    expect(env.PORT).toBe(8080);
    expect(env.NODE_ENV).toBe('development');
    expect(env.HEALTH_CHECK_TIMEOUT_MS).toBe(3000);
  });

  it('accepts rediss:// for TLS redis', () => {
    expect(() =>
      validateEnv({
        ...base,
        REDIS_URL: 'rediss://:pw@cache.example.com:6380',
      }),
    ).not.toThrow();
  });

  it('reports every missing required variable', () => {
    expect(() => validateEnv({})).toThrow(
      /DATABASE_URL is required[\s\S]*REDIS_URL is required/,
    );
  });

  it('rejects invalid values', () => {
    expect(() =>
      validateEnv({ ...base, PORT: 'abc', NODE_ENV: 'staging' }),
    ).toThrow(/NODE_ENV must be one of[\s\S]*PORT must be an integer/);
    expect(() =>
      validateEnv({ ...base, DATABASE_URL: 'postgres://u:p@h/db' }),
    ).toThrow(/DATABASE_URL must use one of: mysql:/);
  });

  it('never leaks secret values in error messages', () => {
    const secret = 'sup3r-s3cret-pa55';
    expect.assertions(1);
    try {
      validateEnv({ ...base, DATABASE_URL: `not a url ${secret}` });
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
