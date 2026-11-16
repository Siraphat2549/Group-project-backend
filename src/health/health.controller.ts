import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { DependencyHealthIndicator } from './dependency.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly dependencies: DependencyHealthIndicator,
  ) {}

  /**
   * Readiness: app + MySQL + Redis. Returns 200 when everything is up,
   * 503 when any dependency is down. Point external monitoring here.
   */
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.app(),
      () => this.dependencies.database(),
      () => this.dependencies.redis(),
    ]);
  }

  /**
   * Liveness: the process is running and serving HTTP. Does not touch
   * dependencies, so a DB blip never makes Docker restart the container.
   */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([() => this.app()]);
  }

  private app() {
    return this.indicator.check('app').up({
      uptimeSeconds: Math.floor(process.uptime()),
    });
  }
}
