import { Controller, Get, Param, Query } from '@nestjs/common';
import { WalletIdParamDto } from '../wallets/wallets.schemas';
import { HistoryQueryDto, TransactionIdParamDto } from './history.schemas';
import { HistoryService } from './history.service';

@Controller()
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get('wallets/:walletId/transactions')
  list(@Param() { walletId }: WalletIdParamDto, @Query() query: HistoryQueryDto) {
    return this.history.listForWallet(walletId, query);
  }

  @Get('transactions/:transactionId')
  findOne(@Param() { transactionId }: TransactionIdParamDto) {
    return this.history.findById(transactionId);
  }
}
