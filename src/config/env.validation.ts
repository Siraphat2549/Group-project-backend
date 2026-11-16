export const NODE_ENVS = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export interface EnvironmentVariables {
  NODE_ENV: NodeEnv;
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  HEALTH_CHECK_TIMEOUT_MS: number;
  CORS_ORIGIN?: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  UPLOAD_DIR: string;
  BCRYPT_ROUNDS: number;
  CACHE_TTL_SECONDS: number;
  THROTTLE_TTL_MS: number;
  THROTTLE_LIMIT: number;
  THROTTLE_AUTH_LIMIT: number;
  THROTTLE_BOOKING_LIMIT: number;
  TRUST_PROXY: number;
}

/** jsonwebtoken time span: plain seconds ("3600") or number + unit ("15m", "1h", "7d"). */
const JWT_EXPIRES_IN_PATTERN = /^\d+(s|m|h|d)?$/;

export const MIN_JWT_SECRET_LENGTH = 32;

type RawEnv = Record<string, unknown>;

function readString(env: RawEnv, key: string): string | undefined {
  const value = env[key];
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    return undefined;
  }
  const str = String(value).trim();
  return str === '' ? undefined : str;
}

function readInt(
  env: RawEnv,
  key: string,
  fallback: number,
  errors: string[],
  { min, max }: { min: number; max: number },
): number {
  const raw = readString(env, key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${key} must be an integer between ${min} and ${max}`);
    return fallback;
  }
  return value;
}

function readUrl(
  env: RawEnv,
  key: string,
  protocols: string[],
  errors: string[],
): string {
  const raw = readString(env, key);
  if (raw === undefined) {
    errors.push(`${key} is required`);
    return '';
  }
  try {
    const url = new URL(raw);
    if (!protocols.includes(url.protocol)) {
      errors.push(`${key} must use one of: ${protocols.join(', ')}`);
    } else if (!url.hostname) {
      errors.push(`${key} must include a host`);
    }
  } catch {
    // Never echo the value: connection strings contain credentials.
    errors.push(`${key} is not a valid URL`);
  }
  return raw;
}

/**
 * Validates process environment at boot so misconfiguration fails fast
 * instead of surfacing as runtime errors. Messages never include values.
 */
export function validateEnv(env: RawEnv): EnvironmentVariables & RawEnv {
  const errors: string[] = [];

  const nodeEnvRaw = readString(env, 'NODE_ENV') ?? 'development';
  if (!(NODE_ENVS as readonly string[]).includes(nodeEnvRaw)) {
    errors.push(`NODE_ENV must be one of: ${NODE_ENVS.join(', ')}`);
  }

  const limitRange = { min: 1, max: 1000000 };
  const validated: EnvironmentVariables = {
    NODE_ENV: nodeEnvRaw as NodeEnv,
    PORT: readInt(env, 'PORT', 3000, errors, { min: 1, max: 65535 }),
    DATABASE_URL: readUrl(env, 'DATABASE_URL', ['mysql:'], errors),
    REDIS_URL: readUrl(env, 'REDIS_URL', ['redis:', 'rediss:'], errors),
    HEALTH_CHECK_TIMEOUT_MS: readInt(
      env,
      'HEALTH_CHECK_TIMEOUT_MS',
      3000,
      errors,
      {
        min: 100,
        max: 60000,
      },
    ),
    CORS_ORIGIN: readString(env, 'CORS_ORIGIN'),
    JWT_SECRET: readString(env, 'JWT_SECRET') ?? '',
    JWT_EXPIRES_IN: readString(env, 'JWT_EXPIRES_IN') ?? '1h',
    UPLOAD_DIR: readString(env, 'UPLOAD_DIR') ?? 'uploads',
    // 12 rounds ~ 250 ms per hash: slow for attackers, fine for a login.
    BCRYPT_ROUNDS: readInt(env, 'BCRYPT_ROUNDS', 12, errors, {
      min: 4,
      max: 15,
    }),
    // 0 disables response caching.
    CACHE_TTL_SECONDS: readInt(env, 'CACHE_TTL_SECONDS', 60, errors, {
      min: 0,
      max: 86400,
    }),
    THROTTLE_TTL_MS: readInt(env, 'THROTTLE_TTL_MS', 60000, errors, {
      min: 1000,
      max: 3600000,
    }),
    THROTTLE_LIMIT: readInt(env, 'THROTTLE_LIMIT', 120, errors, limitRange),
    THROTTLE_AUTH_LIMIT: readInt(
      env,
      'THROTTLE_AUTH_LIMIT',
      10,
      errors,
      limitRange,
    ),
    THROTTLE_BOOKING_LIMIT: readInt(
      env,
      'THROTTLE_BOOKING_LIMIT',
      20,
      errors,
      limitRange,
    ),
    // Number of reverse proxies in front of the API (0 = direct).
    TRUST_PROXY: readInt(env, 'TRUST_PROXY', 0, errors, { min: 0, max: 10 }),
  };

  if (!JWT_EXPIRES_IN_PATTERN.test(validated.JWT_EXPIRES_IN)) {
    errors.push('JWT_EXPIRES_IN must look like 900, 15m, 1h or 7d');
  }

  if (!validated.JWT_SECRET) {
    errors.push('JWT_SECRET is required');
  } else if (validated.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
    errors.push(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  - ${errors.join('\n  - ')}`,
    );
  }

  return { ...env, ...validated };
}
