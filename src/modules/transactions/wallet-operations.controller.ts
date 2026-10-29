import { Body, Controller, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/openapi/error.schema';
import { ApiIdempotencyKey, REPLAY_HEADER } from '../../common/openapi/idempotency.decorator';
import { TransactionResponseDto } from './transactions.responses';
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

@ApiTags('Transactions')
@ApiIdempotencyKey()
@ApiCreatedResponse({ type: TransactionResponseDto.Output, headers: REPLAY_HEADER })
@ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.UNPROCESSABLE_ENTITY)
@Controller('wallets/:walletId')
export class WalletOperationsController {
  constructor(private readonly money: MoneyMovementService) {}

  @Post('deposits')
  @ApiOperation({
    summary: 'Deposit (simulated)',
    description: 'Credits the wallet immediately and records a DEPOSIT transaction.',
  })
  async deposit(
    @Param() { walletId }: WalletIdParamDto,
    @Body() body: DepositDto,
    @IdempotencyKey() idempotencyKey: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, await this.money.deposit({ walletId, idempotencyKey, ...body }));
  }

  @Post('swaps')
  @ApiOperation({
    summary: 'Swap one stablecoin for another in the same wallet',
    description:
      'Converts `amount` of fromCurrency at the current rate (rounded down). Rejected with 422 if it would overdraw the wallet.',
  })
  async swap(
    @Param() { walletId }: WalletIdParamDto,
    @Body() body: SwapDto,
    @IdempotencyKey() idempotencyKey: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, await this.money.swap({ walletId, idempotencyKey, ...body }));
  }
}
