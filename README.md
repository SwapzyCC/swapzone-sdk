<h1 align="center">swapzone-sdk</h1>

<p align="center">
  <b>An unofficial, fully typed TypeScript client for the <a href="https://swapzone.io">Swapzone</a> exchange aggregator API.</b><br>
  Zero dependencies · ESM · Node 22+, Bun, Deno and Cloudflare Workers
</p>

<p align="center">
  <a href="https://github.com/SwapzyCC/swapzone-sdk/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/SwapzyCC/swapzone-sdk/actions/workflows/ci.yml/badge.svg"></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6.svg">
  <img alt="Dependencies: 0" src="https://img.shields.io/badge/dependencies-0-brightgreen.svg">
</p>

> [!NOTE]
> This is a community project maintained by [Swapzy](https://swapzy.cc). It is **not affiliated with, endorsed by or supported by Swapzone**. "Swapzone" is a trademark of its owner. For API keys, account questions and the authoritative API reference, go to [swapzone.io](https://swapzone.io/partners).

```ts
import { Swapzone } from "@swapzy/swapzone-sdk";

const swapzone = new Swapzone({ apiKey: process.env.SWAPZONE_API_KEY });

const offers = await swapzone.exchange.getRates({ from: "ltc", to: "usdtsol", amount: 1, rateType: "floating" });
const best = offers.reduce((a, b) => (b.amountTo > a.amountTo ? b : a));
```

## Contents

- [Why this SDK](#why-this-sdk)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [Recipes](#recipes)
- [Error handling](#error-handling)
- [Retries, timeouts and cancellation](#retries-timeouts-and-cancellation)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Security](#security)
- [Using with AI assistants](#using-with-ai-assistants)
- [Development](#development)
- [License](#license)

## Why this SDK

- **Both APIs**: the instant exchange (currencies, rates, orders, status) and the DEX aggregator (chains, tokens, quotes, approvals, swaps, status).
- **Refusals become errors.** Swapzone answers most failures with HTTP 200 and `{"error": true}`. The SDK throws `SwapzoneAPIError` for those, so a refused order can never be mistaken for a created one.
- **Types that follow the wire format.** Field names are Swapzone's own camelCase, so their docs, your code and your logs all match.
- **Safe retries.** Rate limits are retried after the time the API asks for; `5xx` responses and dropped connections are retried on reads only. Creating an order, or a DEX swap, is never blindly retried, so a flaky network cannot create one twice.
- **Exact amounts.** Numbers are sent as plain decimals (`0.0000001`, never `1e-7`, which the API rejects). Pass a string when you need an exact value.
- **Status tracking**: `exchange.waitFor(id)` and `dex.waitFor(swapId)` poll until the swap is done.
- **Zero runtime dependencies.** Only `fetch`, so it runs anywhere that does.

## Installation

The package is installed straight from GitHub; the build runs on install.

```sh
npm install github:SwapzyCC/swapzone-sdk
# or
pnpm add github:SwapzyCC/swapzone-sdk
yarn add github:SwapzyCC/swapzone-sdk
bun add github:SwapzyCC/swapzone-sdk
```

Pin a release with a tag, e.g. `github:SwapzyCC/swapzone-sdk#v0.1.0`.

You need a Swapzone partner API key: sign up at [swapzone.io/partners](https://swapzone.io/partners/sign-up).

## Quick start

```ts
import { Swapzone } from "@swapzy/swapzone-sdk";

// Reads SWAPZONE_API_KEY from the environment when apiKey is omitted.
const swapzone = new Swapzone();

// 1. Every partner's offer for 0.5 SOL -> LTC.
const offers = await swapzone.exchange.getRates({ from: "sol", to: "ltc", amount: 0.5, rateType: "floating" });

// 2. The best one whose limits the amount fits.
const best = offers
  .filter((o) => (o.minAmount ?? 0) <= 0.5 && (o.maxAmount ?? Infinity) >= 0.5)
  .sort((a, b) => b.amountTo - a.amountTo)[0];
if (!best) throw new Error("No partner takes this amount");

// 3. Open the order with that partner.
const tx = await swapzone.exchange.create({
  from: "sol",
  to: "ltc",
  amountDeposit: 0.5,
  addressReceive: "<recipient LTC address>",
  refundAddress: "<refund SOL address>",
  quotaId: best.quotaId,
});
console.log(`Send ${tx.amountDeposit} SOL to ${tx.addressDeposit}`);

// 4. Follow it until it is done.
const done = await swapzone.exchange.waitFor(tx.id, { timeoutMs: 2 * 60 * 60 * 1000 });
console.log(done.status, done.payoutHash ?? done.hashReceive);
```

More in [`examples/`](./examples): [quickstart](./examples/quickstart.ts) (read-only), [floating-swap](./examples/floating-swap.ts) and [dex-quote](./examples/dex-quote.ts) (read-only).

## Core concepts

### Tickers and networks

Every instant-exchange call names a currency by its **ticker**: lowercase and unique across the whole list, such as `"ltc"`, `"eth"`, `"usdterc20"` or `"usdtsol"`. The same token on different chains has different tickers, so look it up by network and contract rather than by name:

```ts
const currencies = await swapzone.exchange.currencies();
const usdtOnSolana = currencies.find(
  (c) => c.network === "SOL" && c.smartContract === "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
);
// usdtOnSolana.ticker === "usdtsol"
```

EVM contract addresses can differ in case between sources: compare them lowercased. Solana mints are case-sensitive.

### Offers, partners and `quotaId`

Swapzone collects offers from many exchange partners. Each `Rate` names its partner in `adapter` and carries a `quotaId`, which identifies that partner (not that quote). Pass the chosen offer's `quotaId` to `exchange.create()` to open the order with it. Each partner has its own `minAmount` and `maxAmount` (`null` means it did not say), so filter offers by the amount before choosing.

### Floating and fixed rates

- **Floating**: the amount received follows the market until the deposit lands; `amountTo` is an estimate.
- **Fixed**: the amount received is locked until `validUntil`. Some partners also return an `offerReferenceId`: pass it to `create()` with the `quotaId`.

`rateType` defaults to `"all"`, which mixes both; pass `"floating"` or `"fixed"` to choose.

### Transaction lifecycle

`waiting` → `confirming` → `exchanging` → `sending` → `finished`. The other endings are `failed`, `refunded` and `overdue` (no deposit arrived before `payTill`). `TERMINAL_STATUSES` and `isTerminalStatus()` hold the endings.

Once finished, the payout hash is in `payoutHash` or, for some partners, `hashReceive`; check both. `amountRealReceive` is what was actually paid out.

### Amounts

The API sends some amounts as numbers (`Rate.amountTo`) and some as decimal strings (`Transaction.amountDeposit`), and the types say which. Inputs accept either; numbers are sent as plain decimals.

### The DEX aggregator

`swapzone.dex` quotes swaps that the user's own wallet signs: `quote()` returns routes, `allowance()` and `approve()` handle ERC-20 approvals, `swap()` returns the transaction to sign, and `status()`/`waitFor()` follow it. DEX access may need enabling on your API key; until then `quote()` returns an empty array.

## Recipes

### Any coin to LTC, at the best rate

```ts
async function bestOfferToLtc(from: string, amount: number) {
  const offers = await swapzone.exchange.getRates({ from, to: "ltc", amount, rateType: "floating" });
  return offers
    .filter((o) => (o.minAmount ?? 0) <= amount && (o.maxAmount ?? Infinity) >= amount)
    .sort((a, b) => b.amountTo - a.amountTo)[0];
}
```

### Fixed rate

```ts
const [offer] = (await swapzone.exchange.getRates({ from: "ltc", to: "usdcsol", amount: 2, rateType: "fixed" }))
  .sort((a, b) => b.amountTo - a.amountTo);
if (!offer) throw new Error("No fixed offer");

const tx = await swapzone.exchange.create({
  from: "ltc",
  to: "usdcsol",
  amountDeposit: 2,
  addressReceive: "<recipient SOL address>",
  refundAddress: "<refund LTC address>",
  quotaId: offer.quotaId,
  offerReferenceId: offer.offerReferenceId,
});
// Deposit before offer.validUntil, or the order may become overdue.
```

### Your recent orders

```ts
for await (const tx of swapzone.exchange.listAll({ dateFrom: new Date(Date.now() - 86_400_000) })) {
  console.log(tx._id, tx.status, tx.amountDeposit, tx.from, "->", tx.to);
}
```

### Follow a DEX swap

```ts
const status = await swapzone.dex.waitFor(swap.swapId, { fromHash: sentTxHash, timeoutMs: 30 * 60_000 });
if (status.status === "Completed") console.log("received", status.realToAmount, status.toHash);
```

## Error handling

Every error extends `SwapzoneError`:

| Class | When |
| --- | --- |
| `SwapzoneAPIError` | The API refused the request. `status` is often **200**: Swapzone reports most refusals that way. `apiMessage` has its explanation, `body` the raw response. |
| `SwapzoneAuthenticationError` | 401 or 403: the key is missing or wrong. |
| `SwapzoneRateLimitError` | 429 and out of retries. `retryAfterMs` says how long the API asked to wait. |
| `SwapzoneTimeoutError` | An attempt, or a `waitFor()`, ran out of time. |
| `SwapzoneConnectionError` | No HTTP response at all: DNS, TLS, a reset connection. |

```ts
import { SwapzoneAPIError } from "@swapzy/swapzone-sdk";

try {
  await swapzone.exchange.getRate({ from: "ltc", to: "xyz", amount: 1 });
} catch (error) {
  if (error instanceof SwapzoneAPIError) console.error(error.apiMessage); // "xyz currency is not found"
  else throw error;
}
```

Your own `AbortSignal` rejects with the signal's reason, as `fetch` does.

## Retries, timeouts and cancellation

- A **429** is retried on every call, waiting for `Retry-After` or `RateLimit-Reset` (Swapzone sends the reset as a Unix time). A wait over a minute is not sat out: the error is thrown.
- **5xx, 408, timeouts and dropped connections** are retried with exponential backoff and full jitter, but only on calls that are safe to repeat. `exchange.create()` and `dex.swap()` are never retried after one of those: the order may already exist. Look for it in `exchange.list()` before trying again.
- A **200 with `error: true`** is never retried: it is an answer, not a failure.

Every method takes `RequestOptions` as its last argument to override the client's settings for one call:

```ts
await swapzone.exchange.get(id, { timeoutMs: 5_000, maxRetries: 0, signal: AbortSignal.timeout(10_000) });
```

## Configuration

```ts
new Swapzone({
  apiKey: "...",                      // or SWAPZONE_API_KEY
  baseUrl: "https://api.swapzone.io", // default
  timeoutMs: 30_000,                  // per attempt
  maxRetries: 2,                      // after the first attempt
  headers: { "X-Request-Source": "my-app" },
  fetch: customFetch,                 // a proxy agent, a mock
});
```

The key is sent only in the `x-api-key` header, set after your headers, so they cannot replace it.

## API reference

### `swapzone.exchange`

| Method | Endpoint | Returns |
| --- | --- | --- |
| `currencies()` | `GET /v1/exchange/currencies` | `Currency[]` |
| `getRate(params)` | `GET /v1/exchange/get-rate` | `Rate`: the best offer, or `chooseRate: "recommended"` |
| `getRates(params)` | `GET /v1/exchange/get-rate?chooseRate=all` | `Rate[]`: every partner's offer |
| `create(params)` | `POST /v1/exchange/create` | `Transaction`. Not retried after a 5xx or network failure. |
| `get(id)` | `GET /v1/exchange/tx` | `Transaction` |
| `waitFor(id, options)` | polls `get()` | `Transaction` in a terminal status |
| `list(params)` | `GET /v1/exchange/transactions-list` | `TransactionSummary[]`: one page |
| `listAll(params)` | pages through `list()` | `AsyncGenerator<TransactionSummary>` |
| `markets(params)` | `GET /v1/exchange/markets` | `MarketRate[]`. Enabled per key on request. |
| `pairs(params)` | `GET /v1/exchange/get-pairs` | `PairsPage` |
| `validateAddress(params)` | `GET /v1/exchange/validate/address` | `AddressValidation`. Some keys get `"Check params"` for every input; validate locally too. |

### `swapzone.dex`

| Method | Endpoint | Returns |
| --- | --- | --- |
| `blockchains()` | `GET /v1/dex/blockchains` | `DexBlockchain[]`. Skip entries whose `chainId` is `null`. |
| `tokens()` | `GET /v1/dex/tokens` | `DexTokenList`: tokens with their per-chain addresses, plus TON jettons |
| `quote(params)` | `GET /v1/dex/quote` | `DexQuote[]` |
| `allowance(params)` | `GET /v1/dex/allow` | base-unit integer string |
| `approve(params)` | `GET /v1/dex/approve` | `{ to, data }` to sign |
| `swap(params)` | `GET /v1/dex/swap` | `DexSwap`: `{ swapId, to, data, gas, amountTotalHex }`. Not retried after a 5xx. |
| `status(params)` | `GET /v1/dex/status` | `DexSwapStatus` |
| `waitFor(swapId, options)` | polls `status()` | `DexSwapStatus` in a terminal status |

Every type is exported; see [`src/types.ts`](./src/types.ts).

## Security

- Keep the API key on a server. It identifies your partner account; never ship it to a browser or an app.
- Set `refundAddress` on every order.
- Validate addresses yourself before creating an order.
- Report vulnerabilities privately: see [SECURITY.md](./SECURITY.md).

## Using with AI assistants

- [`llms.txt`](./llms.txt): a short summary for an assistant's context.
- [`llms-full.txt`](./llms-full.txt): the complete public API, types and common mistakes in one file.
- [`AGENTS.md`](./AGENTS.md): conventions for working on this repository.

## Development

```sh
npm install
npm run check   # typecheck + tests + build
```

The tests are fully mocked and need no API key. The examples call the live API: copy `.env.example` to `.env`, add your key, then `npx tsx --env-file=.env examples/quickstart.ts`.

## License

[MIT](./LICENSE)
