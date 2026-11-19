import { Controller, Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { DependencyHealthIndicator } from './dependency.health';

// Monitoring must never be rate limited into reporting a false outage.
@SkipThrottle()
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
  @ApiOperation({
    summary: 'Readiness check (app + MySQL + Redis)',
    description:
      'For monitoring and deployment checks: 200 when everything is up, 503 with the failing dependency under `error`. Never rate limited; never includes credentials.',
  })
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
  @ApiOperation({
    summary: 'Liveness check (process only)',
    description:
      'Used by the Docker HEALTHCHECK. Does not touch MySQL or Redis, so a short database outage never restarts the container.',
  })
  live() {
    return this.health.check([() => this.app()]);
  }

  private app() {
    return this.indicator.check('app').up({
      uptimeSeconds: Math.floor(process.uptime()),
    });
  }
}
