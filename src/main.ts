import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

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
