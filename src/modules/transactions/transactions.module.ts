import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { LedgerModule } from '../ledger/ledger.module';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';
import { MoneyMovementService } from './money-movement.service';
import { TransfersController } from './transfers.controller';
import { WalletOperationsController } from './wallet-operations.controller';

@Module({
  imports: [FxModule, LedgerModule, IdempotencyModule],
  controllers: [WalletOperationsController, TransfersController, HistoryController],
  providers: [MoneyMovementService, HistoryService],
})
export class TransactionsModule {}
