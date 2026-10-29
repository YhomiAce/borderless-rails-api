import { Module } from '@nestjs/common';
import { FX_PROVIDER } from './providers/fx-provider';
import { OpenErApiProvider } from './providers/open-er-api.provider';
import { RatesController } from './rates.controller';
import { RatesService } from './rates.service';

@Module({
  controllers: [RatesController],
  providers: [{ provide: FX_PROVIDER, useClass: OpenErApiProvider }, RatesService],
  exports: [RatesService],
})
export class FxModule {}
