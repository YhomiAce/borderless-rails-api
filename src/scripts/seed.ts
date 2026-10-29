/**
 * Seeds demo wallets with balances and a little history, through the real services so every
 * movement is a proper ledger posting. Safe to re-run: wallets are matched by email/phone and
 * operations reuse fixed idempotency keys, so repeats are replays rather than new money.
 *
 * Usage: docker compose exec api node dist/scripts/seed.js   (or `yarn db:seed` after a build)
 */
import './seed-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { eq, or } from 'drizzle-orm';
import { AppModule } from '../app.module';
import { DRIZZLE } from '../database/database.constants';
import { wallets } from '../database/schema';
import { Database } from '../database/types';
import { formatAmount } from '../domain/money';
import { MoneyMovementService } from '../modules/transactions/money-movement.service';
import { WalletExistsError } from '../modules/wallets/wallets.errors';
import { WalletsService } from '../modules/wallets/wallets.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const db = app.get<Database>(DRIZZLE);
  const walletsService = app.get(WalletsService);
  const money = app.get(MoneyMovementService);

  async function wallet(identity: { email?: string; phone?: string }): Promise<string> {
    try {
      return (await walletsService.create(identity)).wallet.id;
    } catch (error) {
      if (!(error instanceof WalletExistsError)) throw error;
      const [existing] = await db
        .select({ id: wallets.id })
        .from(wallets)
        .where(
          or(
            identity.email ? eq(wallets.email, identity.email) : undefined,
            identity.phone ? eq(wallets.phone, identity.phone) : undefined,
          ),
        );
      return existing!.id;
    }
  }

  const ada = await wallet({ email: 'ada@example.com' });
  const kwame = await wallet({ phone: '+233241234567' });
  const amara = await wallet({ email: 'amara@example.com', phone: '+237677123456' });

  await money.deposit({
    walletId: ada,
    currency: 'USDx',
    amount: '1000',
    idempotencyKey: 'seed-ada-usdx',
  });
  await money.deposit({
    walletId: ada,
    currency: 'cNGN',
    amount: '250000',
    idempotencyKey: 'seed-ada-cngn',
  });
  await money.deposit({
    walletId: kwame,
    currency: 'cGHS',
    amount: '5000',
    idempotencyKey: 'seed-kwame-cghs',
  });
  await money.deposit({
    walletId: amara,
    currency: 'EURx',
    amount: '300',
    idempotencyKey: 'seed-amara-eurx',
  });
  await money.swap({
    walletId: ada,
    fromCurrency: 'USDx',
    toCurrency: 'cNGN',
    amount: '100',
    idempotencyKey: 'seed-ada-swap',
  });
  await money.transfer({
    fromWalletId: ada,
    toWalletId: kwame,
    fromCurrency: 'USDx',
    toCurrency: 'cGHS',
    amount: '50',
    reference: 'Seed: school fees',
    idempotencyKey: 'seed-ada-to-kwame',
  });
  await money.transfer({
    fromWalletId: kwame,
    toWalletId: amara,
    fromCurrency: 'cGHS',
    toCurrency: 'cXAF',
    amount: '200',
    reference: 'Seed: supplier payment',
    idempotencyKey: 'seed-kwame-to-amara',
  });

  console.table(
    await Promise.all(
      [ada, kwame, amara].map(async (id) => {
        const view = await walletsService.findById(id);
        return {
          walletId: id,
          identity: view.wallet.email ?? view.wallet.phone,
          totalUsd: formatAmount(view.totalUsd, 'USDx'),
        };
      }),
    ),
  );
  await app.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
