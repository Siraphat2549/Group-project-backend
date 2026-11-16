import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { resolve } from 'path';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

/**
 * Global HTTP setup shared by main.ts and the e2e tests, so tests exercise
 * exactly the same validation/error behaviour as production.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);

  // Behind a reverse proxy the client IP is in X-Forwarded-For. Trusting
  // exactly TRUST_PROXY hops keeps rate limiting and logs on the real IP
  // without letting clients spoof it.
  app.set('trust proxy', config.get<number>('TRUST_PROXY', 0));

  // Security headers. CSP is off because this is a JSON API and it would
  // block the inline scripts of Swagger UI; images must stay embeddable by
  // a frontend on another origin.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());

  // Uploaded room images (FR-15/16) are served from /uploads/...
  const uploadDir = config.get<string>('UPLOAD_DIR', 'uploads');
  app.useStaticAssets(resolve(uploadDir), {
    prefix: '/uploads/',
    index: false,
    dotfiles: 'deny',
    maxAge: '1d',
  });
}
