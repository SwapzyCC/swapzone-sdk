# AGENTS.md

Guidance for AI coding agents working **on** this repository. To write code that **uses** the SDK, read [`llms-full.txt`](./llms-full.txt).

## What this is

An unofficial TypeScript client for the Swapzone API v1 (`https://api.swapzone.io/v1`): the instant exchange and the DEX aggregator. It is published from GitHub as `@swapzy/swapzone-sdk`. It is not affiliated with Swapzone: never add their logo, and never word anything as if Swapzone wrote or endorses it.

## Commands

```sh
npm install         # also builds, via `prepare`
npm run typecheck   # src + test + examples, with Node types
npm test            # vitest, fully mocked; no network, no API key
npm run build       # src -> dist, without Node types
npm run check       # all three; run it before every commit
```

## Layout

```
src/
  index.ts              every public export; a new public symbol goes here
  client.ts             Swapzone class and options; wires resources to the transport
  core.ts               Transport: auth header, URL/query building, timeouts, retries, error mapping
  errors.ts             error classes
  types.ts              request/response types, camelCase, mirroring the API
  version.ts            VERSION; a test keeps it equal to package.json
  resources/
    exchange.ts         currencies, getRate, getRates, create, get, list, listAll, markets, pairs, validateAddress, waitFor
    dex.ts              blockchains, tokens, quote, allowance, approve, swap, status, waitFor
    pagination.ts       paginate() async generator
test/                   vitest; helpers.ts has mockFetch(), json(), refusal(), rate(), transaction()
examples/               runnable scripts against the live API (need SWAPZONE_API_KEY)
```

## Invariants

Keep these. Each one is covered by a test; if you change one on purpose, update the tests and the docs with it.

1. **Zero runtime dependencies.** Only `fetch`, `AbortController`, `URL` and `Headers`. `tsconfig.build.json` sets `types: []`, so a Node-only API in `src/` fails the build. Node APIs are fine in `test/` and `examples/`.
2. **Wire-format types.** Fields stay camelCase, exactly as the API sends them. Don't rename or remap.
3. **A 2xx body with `error: true` throws `SwapzoneAPIError`** and is never retried. Swapzone reports most refusals that way; returning it as data would let a refused order look created.
4. **`exchange.create()` and `dex.swap()` are `idempotent: false`.** They are retried on 429 only. Never make them retry on a 5xx, a timeout or a connection error: that could create a duplicate.
5. **The API key goes only in the `x-api-key` header**, set last, so caller headers can't replace it. Never in a URL, an error message or a log.
6. **Numbers in queries and amounts go out as plain decimals** (`decimalString`). The API rejects exponent notation.
7. **Every thrown error extends `SwapzoneError`**, except a caller's own abort, which rejects with `signal.reason`.
8. **ESM only**, with relative imports ending in `.js`.

## Conventions

- Strict TypeScript, with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`: use `import type` for types.
- Every public method has a TSDoc comment with the HTTP endpoint, what it can throw, and an `@example` where useful.
- Comments say *why*, not *what*.
- Tests use `mockFetch()` from `test/helpers.ts`. Never hit the real API in tests. Backoff is zeroed by mocking `Math.random`.
- A change to the public API updates `README.md`, `llms-full.txt`, `llms.txt` (if the summary changes) and `CHANGELOG.md` in the same commit.
- No secrets, API keys or real wallet addresses anywhere in the repo, including tests and examples. Use placeholders such as `"<recipient LTC address>"`. Public token contracts are fine.

## Upstream API facts

Checked against the live API, which differs from the published docs in places:

- Auth: `x-api-key: <key>`. A missing key on a protected endpoint returns `401 text/plain "Access denied"`. `currencies` answers without a key.
- Errors are mostly **HTTP 200** with `{"error":true,"message":"..."}`: unknown tickers, amounts below every partner's minimum (`"Invalid argument type"`), a missing `quotaId` (`"Quota id is not found"`), partner refusals.
- Rate-limit headers: `RateLimit-Limit` (200), `RateLimit-Remaining`, and `RateLimit-Reset` as a **Unix time in seconds**.
- `get-rate`: `rateType` is `all` | `fixed` | `floating` (`float` is rejected). `chooseRate` is `best` | `all` | `recommended`; `all` returns an array. Fixed offers carry `validUntil`, and some carry `offerReferenceId` and `offerExpirationTime`. `maxAmount` may be `null`.
- `create` accepts a JSON body and wraps its answer in `{ transaction }`, as does `tx`. A `quotaId` is required unless `noQuotaId: true`.
- `transactions-list` wraps its answer in `{ responseTxs }`.
- `get-pairs` takes `adapterList` as a JSON array string, and echoes `limit` as a string.
- `validate/address` answers `"Check params"` for every input on some keys, including the docs' own example.
- DEX responses are `{ error, result }`. `tokens` returns `{ tokens, tonTokens }`, each token with a `chains` array (not the flat list the docs show). `blockchains` includes placeholder entries with `chainId: null`. `quote` returns `{ prices: [], type }` when no route exists or DEX access is not enabled.
- `dex/swap` takes `routeId` as a JSON object string. `dex/status` needs `fromHash` on the first call only.

## Releasing

1. Bump `version` in `package.json` and `src/version.ts`.
2. Add a `CHANGELOG.md` entry.
3. Run `npm run check`.
4. Commit, tag `vX.Y.Z` and push the tag. Users install with `github:SwapzyCC/swapzone-sdk#vX.Y.Z`.
