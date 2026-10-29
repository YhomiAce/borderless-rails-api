import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RatesResponseDto } from './rates.responses';
import { CURRENCIES } from '../../domain/currency';
import { formatRate } from '../../domain/fx';
import { RatesService } from './rates.service';

@ApiTags('Rates')
@Controller('rates')
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @Get()
  @ApiOperation({
    summary: 'Current conversion rates between all supported stablecoins',
    description:
      'Live rates when available; otherwise the last good rates, or the fixed fallback table. Each rate carries its refresh time.',
  })
  @ApiOkResponse({ type: RatesResponseDto.Output })
  current() {
    const snapshot = this.rates.getSnapshot();
    return {
      base: 'USDx',
      status: snapshot.status,
      stale: this.rates.isStale(),
      lastAttemptAt: snapshot.lastAttemptAt?.toISOString() ?? null,
      currencies: CURRENCIES.map((currency) => {
        const q = snapshot.quotes[currency];
        return {
          currency,
          usdRate: formatRate(q.usdRate),
          source: q.source,
          refreshedAt: q.refreshedAt.toISOString(),
          providerUpdatedAt: q.providerUpdatedAt?.toISOString() ?? null,
        };
      }),
      pairs: CURRENCIES.flatMap((from) =>
        CURRENCIES.filter((to) => to !== from).map((to) => {
          const pair = this.rates.quote(from, to);
          return {
            from,
            to,
            rate: formatRate(pair.rate),
            source: pair.source,
            refreshedAt: pair.refreshedAt.toISOString(),
          };
        }),
      ),
    };
  }
}
