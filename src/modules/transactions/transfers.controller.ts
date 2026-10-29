import { Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/openapi/error.schema';
import { ApiIdempotencyKey, REPLAY_HEADER } from '../../common/openapi/idempotency.decorator';
import { TransactionResponseDto } from './transactions.responses';
import type { Response } from 'express';
import { IdempotencyKey } from '../../common/decorators/idempotency-key.decorator';
import { MoneyMovementService } from './money-movement.service';
import { TransferDto } from './transactions.schemas';
import { respond } from './wallet-operations.controller';

@ApiTags('Transactions')
@Controller('transfers')
export class TransfersController {
  constructor(private readonly money: MoneyMovementService) {}

  @Post()
  @ApiOperation({
    summary: 'Send stablecoins to another wallet',
    description:
      'In the same or a different currency (toCurrency, default fromCurrency). Different currencies are converted at the current rate. Keys are scoped to the sender wallet.',
  })
  @ApiIdempotencyKey()
  @ApiCreatedResponse({ type: TransactionResponseDto.Output, headers: REPLAY_HEADER })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.UNPROCESSABLE_ENTITY)
  async transfer(
    @Body() body: TransferDto,
    @IdempotencyKey() idempotencyKey: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, await this.money.transfer({ idempotencyKey, ...body }));
  }
}
