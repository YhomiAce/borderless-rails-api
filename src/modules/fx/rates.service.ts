import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { Env } from '../../config/env';
import { DRIZZLE } from '../../database/database.constants';
import { fxRates } from '../../database/schema';
import { Database } from '../../database/types';
import { CURRENCIES, Currency } from '../../domain/currency';
import { convertViaUsd, crossRate, parseRate, RATE_SCALE, ScaledRate } from '../../domain/fx';
import { Units } from '../../domain/money';
import { FALLBACK_SOURCE, FALLBACK_USD_RATES } from './fallback-rates';
import { FX_PROVIDER, FxProvider } from './providers/fx-provider';

export interface CurrencyQuote {
  currency: Currency;
  usdRate: ScaledRate;
  source: string;
  refreshedAt: Date;
  providerUpdatedAt: Date | null;
}

export type RatesStatus = 'pending' | 'live' | 'degraded';

export interface RatesSnapshot {
  quotes: Record<Currency, CurrencyQuote>;
  /**
   * "live": the last refresh succeeded. "degraded": it failed and older rates are being served.
   * "pending": no refresh has been attempted yet (e.g. refreshes disabled).
   */
  status: RatesStatus;
  lastAttemptAt: Date | null;
  lastError: string | null;
}

export interface PairQuote {
  from: Currency;
  to: Currency;
  /** Cross rate rounded to 18 decimals, for display and audit. */
  rate: ScaledRate;
  /** The USD quotes the rate was derived from; conversions use these exactly. */
  usdRateFrom: ScaledRate;
  usdRateTo: ScaledRate;
  /** "live", "fallback" (either leg comes from the fixed table) or "identity". */
  source: 'live' | 'fallback' | 'identity';
  /** The older of the two legs' refresh times. */
  refreshedAt: Date;
}

/**
 * Serves FX rates from an in-memory snapshot so requests never wait on the network.
 * Refresh order on failure: live provider → last good rates in Postgres → fixed fallback table.
 */
@Injectable()
export class RatesService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RatesService.name);
  private snapshot!: RatesSnapshot;
  private inFlight: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly refreshIntervalMs: number;
  private readonly maxStalenessMs: number;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(FX_PROVIDER) private readonly provider: FxProvider,
    config: ConfigService<Env, true>,
  ) {
    this.refreshIntervalMs = config.get('FX_REFRESH_INTERVAL_MS', { infer: true });
    this.maxStalenessMs = config.get('FX_MAX_STALENESS_MS', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    await this.seedFallback();
    await this.reloadFromDatabase();
  }

  onApplicationBootstrap(): void {
    if (this.refreshIntervalMs <= 0) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.refreshIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  getSnapshot(): RatesSnapshot {
    return this.snapshot;
  }

  isStale(now = new Date()): boolean {
    return CURRENCIES.some(
      (c) => now.getTime() - this.snapshot.quotes[c].refreshedAt.getTime() > this.maxStalenessMs,
    );
  }

  quote(from: Currency, to: Currency): PairQuote {
    const a = this.snapshot.quotes[from];
    const b = this.snapshot.quotes[to];
    const refreshedAt = a.refreshedAt < b.refreshedAt ? a.refreshedAt : b.refreshedAt;
    const legs = { from, to, usdRateFrom: a.usdRate, usdRateTo: b.usdRate, refreshedAt };
    if (from === to) return { ...legs, rate: RATE_SCALE, source: 'identity' };
    const source =
      a.source === FALLBACK_SOURCE || b.source === FALLBACK_SOURCE ? 'fallback' : 'live';
    return { ...legs, rate: crossRate(a.usdRate, b.usdRate), source };
  }

  /** Converts an amount at the given quote (exact ratio of the USD legs, rounded down once). */
  convert(amount: Units, quote: PairQuote): Units {
    return convertViaUsd(amount, quote.from, quote.to, quote.usdRateFrom, quote.usdRateTo);
  }

  /** Fetches live rates. Concurrent callers share one in-flight request. Never throws. */
  refresh(): Promise<void> {
    this.inFlight ??= this.doRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doRefresh(): Promise<void> {
    const attemptAt = new Date();
    try {
      const { rates, providerUpdatedAt } = await this.provider.fetchUsdQuotes();
      await this.db
        .insert(fxRates)
        .values(
          CURRENCIES.map((currency) => ({
            currency,
            usdRate: rates[currency],
            source: this.provider.name,
            refreshedAt: attemptAt,
            providerUpdatedAt,
          })),
        )
        .onConflictDoUpdate({
          target: fxRates.currency,
          set: {
            usdRate: sql`excluded.usd_rate`,
            source: sql`excluded.source`,
            refreshedAt: sql`excluded.refreshed_at`,
            providerUpdatedAt: sql`excluded.provider_updated_at`,
          },
        });
      await this.reloadFromDatabase({ status: 'live', lastAttemptAt: attemptAt, lastError: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`FX refresh failed, serving last known rates: ${message}`);
      // Another instance may have refreshed successfully, so prefer what's in the database.
      await this.reloadFromDatabase({
        status: 'degraded',
        lastAttemptAt: attemptAt,
        lastError: message,
      }).catch((dbError: unknown) => {
        this.logger.error(`Could not reload FX rates from the database: ${String(dbError)}`);
        this.snapshot = {
          ...this.snapshot,
          status: 'degraded',
          lastAttemptAt: attemptAt,
          lastError: message,
        };
      });
    }
  }

  private async seedFallback(): Promise<void> {
    const now = new Date();
    await this.db
      .insert(fxRates)
      .values(
        CURRENCIES.map((currency) => ({
          currency,
          usdRate: FALLBACK_USD_RATES[currency],
          source: FALLBACK_SOURCE,
          refreshedAt: now,
          providerUpdatedAt: null,
        })),
      )
      .onConflictDoNothing();
  }

  private async reloadFromDatabase(
    meta?: Pick<RatesSnapshot, 'status' | 'lastAttemptAt' | 'lastError'>,
  ): Promise<void> {
    const rows = await this.db.select().from(fxRates);
    const quotes = {} as Record<Currency, CurrencyQuote>;
    for (const row of rows) {
      quotes[row.currency] = {
        currency: row.currency,
        usdRate: parseRate(row.usdRate),
        source: row.source,
        refreshedAt: row.refreshedAt,
        providerUpdatedAt: row.providerUpdatedAt,
      };
    }
    for (const currency of CURRENCIES) {
      if (!quotes[currency]) throw new Error(`No FX rate stored for ${currency}`);
    }
    this.snapshot = {
      quotes,
      status: meta?.status ?? this.snapshot?.status ?? 'pending',
      lastAttemptAt: meta?.lastAttemptAt ?? this.snapshot?.lastAttemptAt ?? null,
      lastError: meta?.lastError ?? this.snapshot?.lastError ?? null,
    };
  }
}
