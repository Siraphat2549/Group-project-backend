export const NODE_ENVS = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export interface EnvironmentVariables {
  NODE_ENV: NodeEnv;
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  HEALTH_CHECK_TIMEOUT_MS: number;
  CORS_ORIGIN?: string;
}

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
  };

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  - ${errors.join('\n  - ')}`,
    );
  }

  return { ...env, ...validated };
}
