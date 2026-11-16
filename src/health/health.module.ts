import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DependencyHealthIndicator } from './dependency.health';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule.forRoot({ errorLogStyle: 'pretty' })],
  controllers: [HealthController],
  providers: [DependencyHealthIndicator],
})
export class HealthModule {}
