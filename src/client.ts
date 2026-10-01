import { DEFAULTS, Transport } from "./core.js";
import { SwapzoneError } from "./errors.js";
import { Dex } from "./resources/dex.js";
import { Exchange } from "./resources/exchange.js";

export interface SwapzoneOptions {
  /**
   * Your Swapzone partner API key (https://swapzone.io/partners/account).
   * Falls back to the `SWAPZONE_API_KEY` environment variable where one exists.
   */
  apiKey?: string;
  /** Defaults to `https://api.swapzone.io`. */
  baseUrl?: string;
  /** A `fetch` to use instead of the global one: a proxy agent, a mock in tests. */
  fetch?: typeof fetch;
  /** Per attempt, in milliseconds. Defaults to 30 000. */
  timeoutMs?: number;
  /** Retries after the first attempt, for rate limits and transient failures. Defaults to 2. */
  maxRetries?: number;
  /** Extra headers on every request. `x-api-key` cannot be overridden. */
  headers?: Record<string, string>;
}

/**
 * A client for the Swapzone API v1: the instant exchange and the DEX
 * aggregator.
 *
 * Keep it on a server: the API key identifies your partner account and earns
 * your commission, and must never reach a user's browser.
 *
 * @example
 * import { Swapzone } from "@swapzy/swapzone-sdk";
 *
 * const swapzone = new Swapzone({ apiKey: process.env.SWAPZONE_API_KEY });
 * const rate = await swapzone.exchange.getRate({ from: "ltc", to: "usdtsol", amount: 1, rateType: "floating" });
 */
export class Swapzone {
  /** Instant exchange: currencies, rates, orders and their status. */
  readonly exchange: Exchange;
  /** DEX aggregator: quotes and unsigned transactions for wallet-signed swaps. */
  readonly dex: Dex;

  constructor(options: SwapzoneOptions = {}) {
    const apiKey = options.apiKey ?? readEnv("SWAPZONE_API_KEY");
    if (!apiKey) {
      throw new SwapzoneError(
        "No Swapzone API key: pass { apiKey } or set SWAPZONE_API_KEY. Get one at https://swapzone.io/partners/account.",
      );
    }

    if (typeof (options.fetch ?? globalThis.fetch) !== "function") {
      throw new SwapzoneError("No fetch in this runtime: pass { fetch } or use Node 22+.");
    }

    const transport = new Transport({
      apiKey,
      baseUrl: options.baseUrl ?? DEFAULTS.baseUrl,
      // Called unbound, some runtimes' fetch throws "Illegal invocation".
      fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      maxRetries: options.maxRetries ?? DEFAULTS.maxRetries,
      headers: { ...options.headers },
    });

    this.exchange = new Exchange(transport);
    this.dex = new Dex(transport);
  }
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name] || undefined;
}
