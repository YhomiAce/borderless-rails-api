import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.constants';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly indicator: HealthIndicatorService,
  ) {}

  async check() {
    const session = this.indicator.check('database');
    try {
      await this.pool.query('SELECT 1');
      return session.up();
    } catch (error) {
      return session.down({ message: error instanceof Error ? error.message : 'unreachable' });
    }
  }
}
