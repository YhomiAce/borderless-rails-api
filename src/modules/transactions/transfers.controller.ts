import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IdempotencyKey } from '../../common/decorators/idempotency-key.decorator';
import { MoneyMovementService } from './money-movement.service';
import { TransferDto } from './transactions.schemas';
import { respond } from './wallet-operations.controller';

@Controller('transfers')
export class TransfersController {
  constructor(private readonly money: MoneyMovementService) {}

  @Post()
  async transfer(
    @Body() body: TransferDto,
    @IdempotencyKey() idempotencyKey: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, await this.money.transfer({ idempotencyKey, ...body }));
  }
}
