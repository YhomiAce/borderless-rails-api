import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IdempotencyKey } from '../../common/decorators/idempotency-key.decorator';
import { IdempotentResult } from '../idempotency/idempotency.service';
import { WalletIdParamDto } from '../wallets/wallets.schemas';
import { MoneyMovementService } from './money-movement.service';
import { TransactionResponse } from './transaction.presenter';
import { DepositDto, SwapDto } from './transactions.schemas';

/** Sends a stored or fresh outcome, flagging replays of an earlier request. */
export function respond(res: Response, result: IdempotentResult<TransactionResponse>) {
  res.status(result.status);
  if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
  return result.body;
}

@Controller('wallets/:walletId')
export class WalletOperationsController {
  constructor(private readonly money: MoneyMovementService) {}

  @Post('deposits')
  async deposit(
    @Param() { walletId }: WalletIdParamDto,
    @Body() body: DepositDto,
    @IdempotencyKey() idempotencyKey: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, await this.money.deposit({ walletId, idempotencyKey, ...body }));
  }

  @Post('swaps')
  async swap(
    @Param() { walletId }: WalletIdParamDto,
    @Body() body: SwapDto,
    @IdempotencyKey() idempotencyKey: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, await this.money.swap({ walletId, idempotencyKey, ...body }));
  }
}
