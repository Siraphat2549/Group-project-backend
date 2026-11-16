import { ConsoleLogger, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // One JSON object per line in production, ready for a log collector
    // (NFR-17); colourised text during development.
    logger: new ConsoleLogger({ json: process.env.NODE_ENV === 'production' }),
  });
  const config = app.get(ConfigService);
  configureApp(app);

  // Lets Docker/Kubernetes stop the container gracefully (SIGTERM).
  app.enableShutdownHooks();

  const corsOrigin = config.get<string>('CORS_ORIGIN');
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : true,
  });

  const port = config.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(
    `Hotel Booking API listening on port ${port} (${config.get<string>('NODE_ENV')})`,
    'Bootstrap',
  );
}

void bootstrap();
