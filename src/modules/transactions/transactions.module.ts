import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { LedgerModule } from '../ledger/ledger.module';
import { MoneyMovementService } from './money-movement.service';
import { TransfersController } from './transfers.controller';
import { WalletOperationsController } from './wallet-operations.controller';

@Module({
  imports: [FxModule, LedgerModule, IdempotencyModule],
  controllers: [WalletOperationsController, TransfersController],
  providers: [MoneyMovementService],
})
export class TransactionsModule {}
