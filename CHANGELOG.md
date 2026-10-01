# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-01

### Added

- `Swapzone` client covering the Swapzone API v1:
  - `exchange.currencies`, `getRate`, `getRates`, `create`, `get`, `list`, `listAll`, `markets`, `pairs` and `validateAddress`;
  - `dex.blockchains`, `tokens`, `quote`, `allowance`, `approve`, `swap` and `status`.
- `exchange.waitFor()` and `dex.waitFor()` poll until a terminal status.
- HTTP 200 responses with `error: true` are thrown as `SwapzoneAPIError`.
- Automatic retries with backoff:
  - `Retry-After` and `RateLimit-Reset` are honoured;
  - `exchange.create()` and `dex.swap()` are never retried after a 5xx or a network failure.
- Per-attempt timeouts, `AbortSignal` support and per-call overrides.
- Amounts are sent as plain decimals, never in exponent notation.
- LLM context files: `llms.txt`, `llms-full.txt` and `AGENTS.md`.

[0.1.0]: https://github.com/SwapzyCC/swapzone-sdk/releases/tag/v0.1.0
