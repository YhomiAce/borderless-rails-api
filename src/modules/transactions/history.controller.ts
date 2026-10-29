import { Controller, Get, HttpStatus, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/openapi/error.schema';
import { HistoryPageDto, TransactionResponseDto } from './transactions.responses';
import { WalletIdParamDto } from '../wallets/wallets.schemas';
import { HistoryQueryDto, TransactionIdParamDto } from './history.schemas';
import { HistoryService } from './history.service';

@ApiTags('Transactions')
@Controller()
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get('wallets/:walletId/transactions')
  @ApiOperation({
    summary: "List a wallet's transactions",
    description:
      'Deposits, swaps and transfers sent and received, newest first. Cursor-paginated; filter by type and by currency (matches either side).',
  })
  @ApiOkResponse({ type: HistoryPageDto.Output })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  list(@Param() { walletId }: WalletIdParamDto, @Query() query: HistoryQueryDto) {
    return this.history.listForWallet(walletId, query);
  }

  @Get('transactions/:transactionId')
  @ApiOperation({ summary: 'Get a single transaction' })
  @ApiOkResponse({ type: TransactionResponseDto.Output })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  findOne(@Param() { transactionId }: TransactionIdParamDto) {
    return this.history.findById(transactionId);
  }
}
