import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { resolve } from 'path';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

/**
 * Global HTTP setup shared by main.ts and the e2e tests, so tests exercise
 * exactly the same validation/error behaviour as production.
 */
export function configureApp(app: NestExpressApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());

  // Uploaded room images (FR-15/16) are served from /uploads/...
  const uploadDir = app.get(ConfigService).get<string>('UPLOAD_DIR', 'uploads');
  app.useStaticAssets(resolve(uploadDir), {
    prefix: '/uploads/',
    index: false,
    dotfiles: 'deny',
    maxAge: '1d',
  });
}
