# Contributing

Thanks for helping out. Bug reports, fixes and improvements are all welcome.

## Setup

```sh
git clone https://github.com/SwapzyCC/swapzone-sdk.git
cd swapzone-sdk
npm install
npm run check   # typecheck + tests + build
```

The tests are fully mocked, so you don't need an API key. The scripts in `examples/` call the live API: copy `.env.example` to `.env`, add your key, then run `npx tsx --env-file=.env examples/quickstart.ts`.

## Pull requests

- Keep each pull request to one change, and add or update tests for it.
- `npm run check` must pass.
- If you change the public API, update `README.md`, `llms-full.txt` and `CHANGELOG.md` too.
- Never commit API keys or real wallet addresses.
- Read [AGENTS.md](./AGENTS.md) for the design invariants: zero runtime dependencies, camelCase wire types, 200 error bodies thrown, and no blind retries of `exchange.create()` or `dex.swap()`.

## Reporting bugs

[Open an issue](https://github.com/SwapzyCC/swapzone-sdk/issues) with:

- the SDK version;
- your runtime and its version;
- the smallest code that reproduces the problem;
- the error's class, `status` and `apiMessage`.

Remove your API key from anything you paste.
