/**
 * Writes the OpenAPI spec file (default docs/openapi.json) and reports
 * endpoints that are under-documented.
 *
 *   npm run openapi         # write + report
 *   npm run openapi:check   # write + exit 1 if any documentation error
 *
 * Uses Nest "preview" mode: modules are scanned but no provider is created,
 * so no DB/Redis connection is needed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { lintOpenApiDocument } from './openapi-lint';
import { buildOpenApiDocument } from './swagger';

// Env validation runs when AppModule is loaded; placeholders are enough
// because preview mode never connects to anything.
process.env.DATABASE_URL ??= 'mysql://openapi:openapi@127.0.0.1:3306/openapi';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.JWT_SECRET ??= 'openapi-export-placeholder-not-a-real-secret';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const outArg = args.find((a) => !a.startsWith('--'));

  // Imported only after the env placeholders above are set.
  const { AppModule } = await import('../app.module.js');
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: ['error'],
  });
  const document = buildOpenApiDocument(app);

  const out = resolve(outArg ?? 'docs/openapi.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);

  const { operations, errors, warnings } = lintOpenApiDocument(document);
  console.log(`OpenAPI spec written to ${out} (${operations} operations)`);
  warnings.forEach((w) => console.warn(`  warn  ${w}`));
  errors.forEach((e) => console.error(`  error ${e}`));

  if (errors.length === 0) {
    console.log('Every endpoint is documented.');
    return 0;
  }
  console.error(`${errors.length} documentation error(s).`);
  return strict ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
