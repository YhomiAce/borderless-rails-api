# Borderless Rails

A stablecoin-powered cross-border payments sandbox API. It runs multi-currency wallets holding **cNGN, cGHS, cXAF, USDx and EURx**, with simulated deposits, FX swaps, wallet-to-wallet transfers (same or different currency), transaction history and live conversion rates.

Built for the Cardtonic "Operation Borderless" backend assessment.

- [Quick start](#quick-start)
- [Running the tests](#running-the-tests)
- [Tech stack and why](#tech-stack-and-why)
- [Architecture](#architecture)
- [Data model](#data-model)
- [API walkthrough](#api-walkthrough)
- [Money precision](#money-precision)
- [Idempotency](#idempotency)
- [Concurrency](#concurrency)
- [FX rates and provider failures](#fx-rates-and-provider-failures)
- [Domain events](#domain-events)
- [Assumptions](#assumptions)
- [Known limitations](#known-limitations)
- [What I would do with more time](#what-i-would-do-with-more-time)

---

## Quick start

Requirements: Docker with Compose v2.

```bash
docker compose up --build
```

This starts three services. Migrations run automatically when the API boots.

| Service                | URL                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------- |
| API                    | http://localhost:3000 (`/v1/...`)                                                     |
| Swagger UI             | http://localhost:3000/docs                                                            |
| OpenAPI JSON           | http://localhost:3000/openapi.json (also committed as [`openapi.json`](openapi.json)) |
| RabbitMQ management UI | http://localhost:15672 (login `borderless` / `borderless`)                            |
| Postgres               | `localhost:5434` (user, password and database are all `borderless`)                   |

Optional demo data, with three wallets, balances and some history. It is safe to run more than once:

```bash
docker compose exec api node dist/scripts/seed.js
```

If a port is taken on your machine, override it: `API_HOST_PORT`, `POSTGRES_HOST_PORT`, `RABBITMQ_HOST_PORT`, `RABBITMQ_UI_HOST_PORT`, e.g. `API_HOST_PORT=3001 docker compose up --build`.

### Running locally without Docker for the app

```bash
corepack enable          # or use the vendored Yarn in .yarn/releases
yarn install
cp .env.example .env     # points at the compose Postgres/RabbitMQ on localhost
docker compose up -d postgres rabbitmq
yarn start:dev
```

## Running the tests

```bash
yarn install
yarn test        # full suite: unit + integration (needs Docker running)
```

- Integration tests run against **real Postgres and RabbitMQ** started by [Testcontainers](https://testcontainers.com/), with no mocks of the database or broker. Docker must be running. The first run pulls `postgres:16-alpine` and `rabbitmq:3.13-alpine`.
- To use existing instances instead (e.g. in CI), set `TEST_DATABASE_URL` and/or `TEST_RABBITMQ_URL`.
- Other checks: `yarn lint` (ESLint with type-aware rules, plus Prettier), `yarn typecheck`.
- After changing the API surface, run `yarn openapi:generate`. A test fails if the committed `openapi.json` is out of date.

The suite has 143 tests. Highlights:

| Area              | What is proven                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money math        | exact parse/format, rejecting (not rounding) extra decimals, rounding down, 1e15-scale amounts                                                                                                 |
| Concurrency       | 20 parallel debits against a balance that covers 10 succeed exactly 10 times, and the balance never goes negative. Opposite-direction transfers don't deadlock                                 |
| Idempotency       | replays return the original response, the same key with a different body gets 422, and 10 concurrent duplicates move money once                                                                |
| Ledger invariants | after every money test: each transaction nets to zero per currency, every balance equals the sum of its ledger lines, and no user balance is negative                                          |
| FX                | live, last-known and fixed-table fallback; timeouts; invalid provider payloads; staleness; one shared request for concurrent refreshes                                                         |
| History           | ordering, sent/received direction, filters, cursor pagination with no gaps or duplicates (including rows created in the same millisecond)                                                      |
| Events            | each operation writes the right events, rejected or replayed requests write none, events reach RabbitMQ with routing keys, recovery after a broker outage, no double-publishing between relays |
| Contract          | every real response validates against its documented schema, and the spec matches the code                                                                                                     |

---

## Tech stack and why

| Area                | Choice                                                          | Why                                                                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime             | Node.js 22 LTS, TypeScript (strict, `noUncheckedIndexedAccess`) | Required                                                                                                                                                                                                         |
| Framework           | **NestJS 11**                                                   | Modules map onto the domain (wallets, fx, ledger, transactions, events), constructor injection makes infrastructure swappable in tests, and global pipes/filters give one place for validation and error mapping |
| Database            | **PostgreSQL 16**                                               | See below                                                                                                                                                                                                        |
| ORM                 | **Drizzle ORM**                                                 | Typed, SQL-shaped queries, versioned SQL migrations, and easy access to `FOR UPDATE`, `SKIP LOCKED` and raw SQL when needed                                                                                      |
| Validation and docs | **zod** + `nestjs-zod` + `@nestjs/swagger`                      | One schema per request/response gives validation, TypeScript types and the OpenAPI spec                                                                                                                          |
| Messaging           | **RabbitMQ** (topic exchange)                                   | Publishes domain events other teams can subscribe to (see [Domain events](#domain-events))                                                                                                                       |
| Tests               | Vitest + Supertest + Testcontainers                             | Real Postgres/RabbitMQ, which the concurrency and outbox tests need                                                                                                                                              |
| Tooling             | Yarn 4 (vendored), ESLint, Prettier                             | Required                                                                                                                                                                                                         |

### Why PostgreSQL

Moving money means several rows must change together: the debit, the credit, the ledger lines, the transaction record and the idempotency record either all commit or none do. Postgres gives exactly what that needs:

- **ACID transactions** across many rows and tables.
- **Row-level locks** (`SELECT … FOR UPDATE`) to serialise competing debits on the same balance.
- **`CHECK` constraints** so a user balance can never be negative, even if application code were wrong.
- **Exact `NUMERIC`** for amounts, with no floating point anywhere.
- **Unique constraints** for "one wallet per email/phone" and "one transaction per idempotency key" that hold under concurrency.

MongoDB could be made to work with multi-document transactions, but the data is relational (wallets → balances → ledger lines → transactions) and the correctness guarantees above are first-class in Postgres.

### Why no Redis

The brief allows a cache "only where it earns its place". I didn't find one:

- **Balances** must be read from the locked database row at the moment of debit; a cached balance could be stale.
- **Idempotency** records must commit in the _same_ transaction as the money movement, so they belong in Postgres.
- **FX rates** are already held in memory and saved in Postgres (so they survive restarts).

---

## Architecture

One application (the API) with Postgres and RabbitMQ:

```
                 ┌──────────────────────────── api (NestJS) ─────────────────────────────┐
HTTP /v1 ──────► │ Wallets · Transactions (deposit/swap/transfer/history) · Rates         │
                 │        │                    │                                          │
                 │        ▼                    ▼                                          │
                 │   LedgerService ◄── IdempotencyService      RatesService ◄── FX provider (open.er-api.com)
                 │   (locks, checks,          (same DB tx)      (in-memory snapshot,      │
                 │    double entry)                              background refresh)       │
                 │        │ writes events in the same DB tx                               │
                 │        ▼                                                                │
                 │   outbox_events ──► OutboxRelay ──► RabbitMQ ──► EventsLogger (example) │
                 └───────────────────────────────────────────────────────────────────────┘
                          │                                   ▲
                          ▼                                   │ other teams bind their own queues
                      PostgreSQL                          topic exchange "borderless.events"
```

- **Every money movement goes through `LedgerService.post`.** Deposits, swaps and transfers only build a list of balanced ledger lines; locking, fund checks, balance updates, ledger rows and credit/debit events all happen in that one place ([`src/modules/ledger/ledger.service.ts`](src/modules/ledger/ledger.service.ts)).
- Each operation runs in **one database transaction**: claim idempotency key → insert transaction → post ledger lines → record events → store response.
- The FX rate is priced **before** the transaction starts, so no network call happens while row locks are held.
- The outbox relay and the example consumer are NestJS modules in the same process, switchable with `OUTBOX_RELAY_ENABLED` / `EVENTS_LOGGER_ENABLED`. They could move to their own process through configuration alone.

```
src/
├─ main.ts, app.module.ts, app.setup.ts, openapi.ts
├─ config/                 env schema (validated at boot)
├─ domain/                 pure: currency registry, bigint money, FX math
├─ database/               Drizzle schema, migrator, money column type
├─ common/                 error envelope filter, Idempotency-Key decorator, OpenAPI helpers
├─ modules/
│  ├─ wallets/  fx/  ledger/  idempotency/  transactions/  events/  health/
└─ scripts/                OpenAPI generator, demo seed
drizzle/                   SQL migrations, one per feature
test/                      unit/ and integration/ (Testcontainers)
```

---

## Data model

| Table              | Purpose                                                                                                                                                       | Key constraints                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `wallets`          | User wallets plus two **system accounts** (`MINT`, `FX_POOL`)                                                                                                 | `UNIQUE(email)`, `UNIQUE(phone)`; users need an email or phone                                                                                |
| `balances`         | One row per wallet per currency; the rows that get locked                                                                                                     | PK `(wallet_id, currency)`; **`CHECK (kind = 'SYSTEM' OR amount >= 0)`**; composite FK so a balance's kind always matches its wallet          |
| `transactions`     | One row per business event (deposit, swap, transfer): sender, receiver, source and destination amount/currency, rate applied, rate source and time, timestamp | `UNIQUE(wallet_id, idempotency_key)`; amounts > 0; history indexes on `(wallet_id, created_at DESC, id DESC)` and the counterparty equivalent |
| `ledger_entries`   | Append-only double-entry lines: signed amount and balance after                                                                                               | non-zero amounts                                                                                                                              |
| `idempotency_keys` | Request fingerprint and stored response per `(scope, key)`                                                                                                    | PK `(scope, key)`                                                                                                                             |
| `fx_rates`         | Latest USD-pivoted quote per currency, source, refresh time                                                                                                   | PK `currency`                                                                                                                                 |
| `outbox_events`    | Domain events waiting to be published                                                                                                                         | partial index on unpublished rows                                                                                                             |

**Double entry.** Money is never created or destroyed; every transaction's lines net to zero in each currency:

| Operation                    | Ledger lines                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------- |
| Deposit 100 cNGN to W        | MINT −100 cNGN, W +100 cNGN                                                      |
| Swap W: 100 USDx → cNGN      | W −100 USDx, FX_POOL +100 USDx, FX_POOL −134,623.6888 cNGN, W +134,623.6888 cNGN |
| Transfer A → B, 50 cGHS      | A −50 cGHS, B +50 cGHS                                                           |
| Transfer A (USDx) → B (cGHS) | A −50 USDx, FX_POOL +50 USDx, FX_POOL −581.9958 cGHS, B +581.9958 cGHS           |

`MINT`'s balance goes negative (it equals the total issued); `FX_POOL` holds the net position from conversions. Migrations are in [`drizzle/`](drizzle), one per feature.

---

## API walkthrough

Full reference: **http://localhost:3000/docs**. All amounts are decimal **strings**. Every `POST` that moves money needs an `Idempotency-Key` header.

| Method | Path                                 | Purpose                                            |
| ------ | ------------------------------------ | -------------------------------------------------- |
| `POST` | `/v1/wallets`                        | Create a wallet (email and/or phone)               |
| `GET`  | `/v1/wallets/:walletId`              | Balances plus total in USD                         |
| `POST` | `/v1/wallets/:walletId/deposits`     | Simulated deposit                                  |
| `POST` | `/v1/wallets/:walletId/swaps`        | Swap between stablecoins in one wallet             |
| `POST` | `/v1/transfers`                      | Send to another wallet, same or different currency |
| `GET`  | `/v1/wallets/:walletId/transactions` | History: `type`, `currency`, `limit`, `cursor`     |
| `GET`  | `/v1/transactions/:transactionId`    | One transaction                                    |
| `GET`  | `/v1/rates`                          | All pairs with refresh times                       |
| `GET`  | `/health`                            | Liveness plus database check                       |

The responses below were captured from a running instance (shortened where marked).

### Create a wallet

```bash
curl -X POST localhost:3000/v1/wallets -H 'Content-Type: application/json' \
  -d '{"email":"tolu@example.com"}'
```

```json
201
{
  "id": "660a13b9-a2b1-4d8c-ba98-6288d8c608c1",
  "email": "tolu@example.com",
  "phone": null,
  "createdAt": "2026-10-29T20:45:54.336Z",
  "balances": [
    { "currency": "cNGN", "amount": "0.000000", "usdValue": "0.000000" },
    { "currency": "cGHS", "amount": "0.000000", "usdValue": "0.000000" },
    { "currency": "cXAF", "amount": "0.000000", "usdValue": "0.000000" },
    { "currency": "USDx", "amount": "0.000000", "usdValue": "0.000000" },
    { "currency": "EURx", "amount": "0.000000", "usdValue": "0.000000" }
  ],
  "totalUsd": "0.000000",
  "ratesAsOf": "2026-10-29T20:43:46.710Z"
}
```

Emails are lowercased and phones normalised to E.164 (`0803 123 4567` → `+2348031234567`), so `TOLU@example.com` is a duplicate:

```json
409
{ "error": { "code": "WALLET_EXISTS", "message": "A wallet with this email already exists",
             "details": { "field": "email" }, "requestId": "2b73bb5b-…" } }
```

### Deposit

```bash
curl -X POST localhost:3000/v1/wallets/$WALLET/deposits -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 7f9c2b1e-…' -d '{"currency":"USDx","amount":"250.00"}'
```

```json
201
{
  "id": "399ebe47-f041-4d24-a64e-162b79d2a4d1",
  "type": "DEPOSIT",
  "status": "COMPLETED",
  "fromWalletId": null,
  "toWalletId": "660a13b9-a2b1-4d8c-ba98-6288d8c608c1",
  "source": { "currency": "USDx", "amount": "250.000000" },
  "destination": { "currency": "USDx", "amount": "250.000000" },
  "rate": "1.000000000000000000",
  "rateSource": "identity",
  "rateTimestamp": null,
  "reference": null,
  "createdAt": "2026-10-29T20:45:54.416Z"
}
```

Sending the same request again with the same key returns the **same** body (same `id`) with header `Idempotent-Replayed: true`. The wallet is credited once.

### Swap

```bash
curl -X POST localhost:3000/v1/wallets/$WALLET/swaps -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: …' -d '{"fromCurrency":"USDx","toCurrency":"cNGN","amount":"100"}'
```

```json
201
{
  "id": "59c834c2-2db7-45bd-9d7a-48485374489e",
  "type": "SWAP",
  "fromWalletId": "660a13b9-…", "toWalletId": "660a13b9-…",
  "source": { "currency": "USDx", "amount": "100.000000" },
  "destination": { "currency": "cNGN", "amount": "134623.688800" },
  "rate": "1346.236888000000000000",
  "rateSource": "live",
  "rateTimestamp": "2026-10-29T20:43:46.710Z",
  "…": "…"
}
```

A swap that would overdraw is rejected and nothing changes:

```json
422
{ "error": { "code": "INSUFFICIENT_FUNDS", "message": "Insufficient EURx balance",
             "details": { "currency": "EURx", "available": "0.000000", "required": "1.000000" },
             "requestId": "2712f238-…" } }
```

### Transfer (cross-currency)

```bash
curl -X POST localhost:3000/v1/transfers -H 'Content-Type: application/json' -H 'Idempotency-Key: …' \
  -d '{"fromWalletId":"'$A'","toWalletId":"'$B'","fromCurrency":"USDx","toCurrency":"cGHS","amount":"50","reference":"School fees"}'
```

```json
201
{
  "id": "f2d82ce1-2bcc-4329-91fd-3c2b75e947d4",
  "type": "TRANSFER",
  "status": "COMPLETED",
  "fromWalletId": "660a13b9-a2b1-4d8c-ba98-6288d8c608c1",
  "toWalletId": "50f2e4e3-3219-491a-af71-1ad0b27f04b0",
  "source": { "currency": "USDx", "amount": "50.000000" },
  "destination": { "currency": "cGHS", "amount": "581.995800" },
  "rate": "11.639916000000000000",
  "rateSource": "live",
  "rateTimestamp": "2026-10-29T20:43:46.710Z",
  "reference": "School fees",
  "createdAt": "2026-10-29T20:45:54.540Z"
}
```

Leave out `toCurrency` for a same-currency transfer. Sending to the same wallet, or to an unknown wallet, is rejected (`400` / `404`).

### Balances with total in USD

```bash
curl localhost:3000/v1/wallets/$WALLET
```

```json
200
{
  "id": "660a13b9-…",
  "balances": [
    { "currency": "cNGN", "amount": "134623.688800", "usdValue": "100.000000" },
    { "currency": "cGHS", "amount": "0.000000", "usdValue": "0.000000" },
    { "currency": "cXAF", "amount": "0.000000", "usdValue": "0.000000" },
    { "currency": "USDx", "amount": "100.000000", "usdValue": "100.000000" },
    { "currency": "EURx", "amount": "0.000000", "usdValue": "0.000000" }
  ],
  "totalUsd": "200.000000",
  "ratesAsOf": "2026-10-29T20:43:46.710Z",
  "…": "…"
}
```

### History

```bash
curl "localhost:3000/v1/wallets/$WALLET/transactions?limit=2"   # filters: &type=TRANSFER &currency=cGHS
```

```json
200
{
  "data": [
    { "id": "f2d82ce1-…", "type": "TRANSFER", "direction": "SENT", "…": "…" },
    { "id": "59c834c2-…", "type": "SWAP", "direction": "INTERNAL", "…": "…" }
  ],
  "pagination": { "limit": 2, "hasMore": true, "nextCursor": "eyJ0IjoiMjAyNi0xMC0yOVQyMDo0NTo1NC40ODQ1NThaIiwi…" }
}
```

Newest first. `direction` is relative to the wallet listed: `IN` (deposit), `INTERNAL` (swap), `SENT` or `RECEIVED` (transfer). `currency` matches either side. Pass `nextCursor` back as `cursor` for the next page.

### Rates

```bash
curl localhost:3000/v1/rates
```

```json
200
{
  "base": "USDx",
  "status": "live",
  "stale": false,
  "lastAttemptAt": "2026-10-29T20:43:46.710Z",
  "currencies": [
    { "currency": "cNGN", "usdRate": "1346.236888000000000000", "source": "open.er-api.com",
      "refreshedAt": "2026-10-29T20:43:46.710Z", "providerUpdatedAt": "2026-10-29T00:02:31.000Z" }
  ],
  "pairs": [
    { "from": "cNGN", "to": "cGHS", "rate": "0.008646261370309442", "source": "live",
      "refreshedAt": "2026-10-29T20:43:46.710Z" }
  ]
}
```

Shortened: 5 currencies and all 20 directed pairs are returned.

### Errors

Every error uses one envelope: `{ "error": { "code", "message", "details?", "requestId" } }`.

| Status | Codes                                                                                                                   |
| ------ | ----------------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR` (field issues in `details`), `IDEMPOTENCY_KEY_REQUIRED`, `INVALID_IDEMPOTENCY_KEY`, `INVALID_CURSOR` |
| 404    | `WALLET_NOT_FOUND`, `TRANSACTION_NOT_FOUND`, `NOT_FOUND`                                                                |
| 409    | `WALLET_EXISTS`                                                                                                         |
| 422    | `INSUFFICIENT_FUNDS`, `AMOUNT_TOO_SMALL`, `IDEMPOTENCY_KEY_REUSED`                                                      |
| 429    | `RATE_LIMITED`                                                                                                          |
| 500    | `INTERNAL_ERROR` (no internals leaked; details are logged with the request id)                                          |

---

## Money precision

**No JavaScript `number` ever holds an amount.**

- **API:** amounts are decimal strings, e.g. `"1500.25"`. JSON numbers are rejected, since `0.1 + 0.2` problems start at `JSON.parse`. More than 6 decimal places is **rejected, not rounded**; silently rounding a client's input is a bug.
- **In code:** integer base units as `bigint` (6 decimals per coin, so 1 cNGN = `1_000_000n`). See [`src/domain/money.ts`](src/domain/money.ts).
- **In the database:** `numeric(38,0)`, which is exact and has none of the overflow risk of `int8` for high-denomination currencies like cNGN.
- **Rates:** decimal strings with 18 decimals, held as scaled `bigint` for arithmetic.
- **Conversion** uses the exact ratio of the two USD quotes and **rounds down once**: `dest = amount × usdRate[to] / usdRate[from]`. Converting through the 18-decimal cross rate would round twice, and a test caught 15,000 cNGN at 1/1500 coming out as 9.999999 USD instead of 10. The recipient never gets more than the exact value, and the dropped remainder is under one base unit (0.000001). A conversion that would deliver 0 is rejected (`AMOUNT_TOO_SMALL`).
- The `rate` recorded on each transaction is the 18-decimal cross rate, kept for audit and display.

## Idempotency

- `POST` deposits, swaps and transfers **require** an `Idempotency-Key` header. Keys are scoped to the wallet (the sender, for transfers).
- The key, a SHA-256 fingerprint of the validated request, and the response are stored in `idempotency_keys` **inside the same database transaction** as the money movement ([`idempotency.service.ts`](src/modules/idempotency/idempotency.service.ts)):
  - **Retry after success** → the stored response is returned with `Idempotent-Replayed: true`. No new transaction, no events. A replayed swap returns the original rate even if rates have since moved.
  - **Same key, different body** → `422 IDEMPOTENCY_KEY_REUSED`.
  - **Concurrent duplicates** → the second `INSERT` waits on the primary key until the first transaction finishes, then replays its result. There's no in-progress state to manage; a test fires 10 at once and money moves once.
  - **First attempt failed** (e.g. insufficient funds) → the key rolls back with it, so the client can top up and retry with the same key. Business rejections are deliberately not cached.
- Wallet creation is naturally idempotent through the unique email/phone constraints.
- A second safety net: `UNIQUE (wallet_id, idempotency_key)` on `transactions`.

## Concurrency

- `LedgerService.post` locks every affected balance row with `SELECT … FOR UPDATE`, **always in the same order** (wallet id, then currency). Two transfers A→B and B→A therefore queue rather than deadlock; there's a test for this.
- Funds are checked **after** the locks are held, so the check can't be invalidated by a concurrent request.
- Defence in depth: `CHECK (kind = 'SYSTEM' OR amount >= 0)` on `balances`. Even if application logic were wrong, Postgres refuses a negative user balance.
- READ COMMITTED plus explicit row locks; no SERIALIZABLE retry loops needed.
- No network I/O while locks are held: FX is priced before the transaction begins.
- Wallet-creation races are settled by unique constraints (one `201`, the rest `409`).

## FX rates and provider failures

- **Provider:** [open.er-api.com](https://www.exchangerate-api.com/docs/free) (no API key; covers NGN, GHS, XAF, USD and EUR). Each coin is pegged 1:1 to its fiat currency: cNGN→NGN, cGHS→GHS, cXAF→XAF, USDx→USD, EURx→EUR. Cross rates come from USD-pivoted quotes.
- **The request path never waits on the network.** Requests read an in-memory snapshot. A background refresh runs on boot and every 10 minutes (`FX_REFRESH_INTERVAL_MS`), and concurrent refreshes share one in-flight request.
- **On failure** (3s timeout, non-2xx, invalid payload or missing currency are all treated the same):
  1. **Live** rates are stored in `fx_rates` on success.
  2. If a refresh fails, the API serves the **last good rates** from Postgres, with their original `refreshedAt`, so clients see how old they are. `/v1/rates` reports `status: "degraded"`.
  3. If the provider has _never_ succeeded, the **fixed fallback table** inserted at boot is used. Transactions priced from it are labelled `rateSource: "fallback"`.
- `stale: true` is reported when any rate is older than `FX_MAX_STALENESS_MS` (36h by default; the free provider publishes daily). Swaps keep working on stale rates, a sandbox choice explained under [Assumptions](#assumptions).
- Every swap and transfer records the **rate applied, its source and its timestamp**.

## Domain events

Other teams (rewards, referrals, analytics) can react to wallet activity **without any change to this service**:

| Routing key             | When                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `wallet.created`        | wallet created (email and phone masked)                               |
| `wallet.credited`       | a user balance goes up (deposit, swap destination, transfer received) |
| `wallet.debited`        | a user balance goes down (swap source, transfer sent)                 |
| `transaction.completed` | every deposit, swap and transfer, with the full transaction           |

```json
{
  "eventId": "8769ced5-…",
  "type": "wallet.credited",
  "version": 1,
  "occurredAt": "…",
  "aggregateId": "<walletId>",
  "data": {
    "walletId": "…",
    "currency": "cGHS",
    "amount": "12.500000",
    "balanceAfter": "12.500000",
    "transactionId": "…",
    "transactionType": "DEPOSIT"
  }
}
```

- **Transactional outbox.** Events are written to `outbox_events` in the same database transaction as the money movement, so there are no lost events and no events for rolled-back changes. The relay publishes them to the durable topic exchange **`borderless.events`** on a confirm channel (`persistent`, `messageId = eventId`) and only marks them published once RabbitMQ confirms. Rows are claimed with `FOR UPDATE SKIP LOCKED`, so several API instances can relay safely.
- **Subscribing:** a team declares its own queue and binds it to the routing keys it needs (`wallet.credited`, `transaction.*`, or `#` for all). The built-in **EventsLogger** ([`events-logger.consumer.ts`](src/modules/events/consumer/events-logger.consumer.ts)) is a working example: it binds `borderless.events-logger` to `#`, deduplicates on `eventId`, and dead-letters malformed messages to `borderless.events.dlx`. Watch it in `docker compose logs -f api`, or the queues in the RabbitMQ UI.
- **RabbitMQ is not on the money path.** If it is down, deposits, swaps and transfers keep working, events wait in the outbox, and the relay and consumer reconnect and catch up. I verified this by stopping and restarting the broker.
- Delivery is **at-least-once**, so consumers deduplicate on `eventId`. Ordering is best-effort (see limitations).

---

## Assumptions

- **No authentication**, as the brief says. Anyone with a wallet id can act on it. Wallets are identified by email and/or phone; local phone numbers without a country code are read as Nigerian (`+234`).
- **All five coins use 6 decimal places** (the common on-chain convention for fiat stablecoins). It's configurable per coin in [`src/domain/currency.ts`](src/domain/currency.ts).
- **Mid-market rates, no fees or spread.** Rounding remainders (under 0.000001 per conversion) stay with the platform.
- **Deposits are simulated**: credited instantly from the `MINT` system account. There are no deposit limits.
- **The FX pool has unlimited liquidity** in every currency (it's allowed to go negative).
- **Stale rates still price swaps** (flagged, not blocked). A production system would refuse or widen spreads past a threshold.
- **Failed operations are not stored as transactions.** All operations are synchronous: a transaction either completes or the request fails, and nothing is recorded.
- Idempotency keys are kept indefinitely (no TTL clean-up yet).

## Known limitations

- **Hot system rows.** Every swap and cross-currency transfer locks the `FX_POOL` balance row for its currencies, and every deposit locks `MINT`'s. Fine for a sandbox; under real load I'd shard pool accounts or skip locking contra accounts (they have no balance floor to protect).
- **History query uses `OR`** across `wallet_id` and `counterparty_wallet_id`. Both are indexed and Postgres can combine them, but at scale a `UNION ALL` of two index-ordered scans, or a per-wallet entries table, would be faster.
- **Event ordering** is best-effort: a single relay publishes in `occurred_at` order, but retries and multiple relays can reorder. Events carry `occurredAt` and `balanceAfter` so consumers can reason about it.
- **The free FX provider updates daily**, so "live" rates can be up to a day old; `providerUpdatedAt` exposes this.
- **Subscribers receive events published after their queue is first bound** (standard topic-exchange semantics). On a brand-new stack, events from the first seconds, before the example consumer binds its queue, are not delivered to it. Queues are durable, so once bound nothing is missed across restarts, and outbox rows are kept, which makes a replay endpoint straightforward to add.
- The example consumer's deduplication is in memory (illustrative); a real consumer would persist processed `eventId`s.
- No outbox or idempotency-key retention jobs.
- Rate limiting is per instance (in-memory throttler).

## What I would do with more time

1. **Authentication and authorisation** (API keys or OAuth, with wallet ownership checks), plus audit logging of who did what.
2. **Quotes:** `POST /quotes` locking a rate for N seconds, then executing the swap or transfer against the quote id, so users see exactly what they'll get.
3. **Fees and spreads** per corridor, with fee lines in the ledger and revenue accounts.
4. **Limits and risk:** per-wallet daily limits, velocity checks, and KYC tiers.
5. **Multiple FX providers** with health scoring and circuit breakers, plus rejecting swaps on stale rates beyond a threshold.
6. **Reconciliation job** continuously asserting the ledger invariants the tests check (lines net to zero, balances equal ledger sums).
7. **Observability:** OpenTelemetry traces, Prometheus metrics (outbox lag, FX refresh failures, lock wait times).
8. **Outbox and idempotency retention** jobs, and a dashboard for unpublished events.
9. Move the relay to its own deployment when traffic justifies it (already a config switch).

---

## Configuration reference

All settings are validated at boot ([`src/config/env.ts`](src/config/env.ts)); see [`.env.example`](.env.example).

| Variable                                                           | Default                         | Purpose                                                     |
| ------------------------------------------------------------------ | ------------------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`                                                     | (required)                      | Postgres connection                                         |
| `RUN_MIGRATIONS`                                                   | `true`                          | Apply migrations on boot (serialised with an advisory lock) |
| `FX_PROVIDER_URL`                                                  | open.er-api.com USD endpoint    | Live rates                                                  |
| `FX_TIMEOUT_MS` / `FX_REFRESH_INTERVAL_MS` / `FX_MAX_STALENESS_MS` | `3000` / `600000` / `129600000` | Provider timeout, refresh cadence (0 = off), staleness flag |
| `RABBITMQ_URL`                                                     | (required if events are on)     | Broker connection                                           |
| `OUTBOX_RELAY_ENABLED` / `EVENTS_LOGGER_ENABLED`                   | `true` / `true`                 | Run the relay / example consumer in this process            |
| `OUTBOX_POLL_INTERVAL_MS` / `OUTBOX_BATCH_SIZE`                    | `500` / `100`                   | Relay cadence and batch size                                |
| `LOG_LEVEL`                                                        | `info`                          | pino log level                                              |
