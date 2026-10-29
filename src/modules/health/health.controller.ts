import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

@Controller({ path: 'health', version: VERSION_NEUTRAL })
@SkipThrottle()
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([]);
  }
}
