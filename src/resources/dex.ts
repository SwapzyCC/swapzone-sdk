import { sleep, type RequestOptions, type Transport } from "../core.js";
import { SwapzoneTimeoutError } from "../errors.js";
import type {
  DexAllowanceParams,
  DexApproveParams,
  DexBlockchain,
  DexQuote,
  DexQuoteParams,
  DexStatusParams,
  DexSwap,
  DexSwapParams,
  DexSwapStatus,
  DexSwapStatusName,
  DexTokenList,
  DexTransactionRequest,
} from "../types.js";

/** DEX statuses a swap never leaves. */
export const DEX_TERMINAL_STATUSES: readonly DexSwapStatusName[] = ["Completed", "Failed", "Fallback"];

/** Whether a DEX swap in this status is done for good. */
export function isDexTerminalStatus(status: DexSwapStatusName): boolean {
  return DEX_TERMINAL_STATUSES.includes(status);
}

export interface DexWaitForOptions {
  /** The source-chain transaction hash, sent with the first poll to register it. */
  fromHash?: string;
  /** When to stop. Defaults to `DEX_TERMINAL_STATUSES`. */
  until?: readonly DexSwapStatusName[] | ((status: DexSwapStatus) => boolean);
  /** Between polls, in milliseconds. Defaults to 10 000. */
  intervalMs?: number;
  /** Give up after this long, in milliseconds, with a `SwapzoneTimeoutError`. Defaults to no limit. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called with the first poll, and again whenever the status changes. */
  onUpdate?: (status: DexSwapStatus, previous: DexSwapStatus | undefined) => void;
}

type Wrapped<T> = { error: false; result: T };

/**
 * The DEX aggregator: on-chain and cross-chain token swaps that the user's own
 * wallet signs. Nothing here holds funds; each call returns data or an
 * unsigned transaction.
 */
export class Dex {
  constructor(private readonly transport: Transport) {}

  /**
   * Chains the DEX aggregator can swap on.
   *
   * `GET /v1/dex/blockchains`
   */
  blockchains(options?: RequestOptions): Promise<DexBlockchain[]> {
    return this.get<DexBlockchain[]>("/v1/dex/blockchains", undefined, options);
  }

  /**
   * Tokens the DEX aggregator can swap. Each token lists the chains it is on,
   * with its address and decimals there; TON jettons come separately.
   *
   * `GET /v1/dex/tokens`
   *
   * @example
   * const { tokens } = await swapzone.dex.tokens();
   * const usdc = tokens.find((t) => t.symbol === "USDC")?.chains.find((c) => c.chainId === 56);
   */
  tokens(options?: RequestOptions): Promise<DexTokenList> {
    return this.get<DexTokenList>("/v1/dex/tokens", undefined, options);
  }

  /**
   * Routes for a swap, one per provider and bridge. Pick one and keep it
   * whole: `swap()` needs its `adapter`, `id` and `toAmount`. An empty array
   * means no provider would route it; DEX access may also need enabling on
   * your API key.
   *
   * `GET /v1/dex/quote`
   *
   * @example
   * const routes = await swapzone.dex.quote({
   *   fromChainId: 1,
   *   toChainId: 56,
   *   fromTokenAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
   *   toTokenAddress: "<USDC contract on BSC>",
   *   fromAmount: 0.05,
   *   slippage: 1,
   * });
   */
  async quote(params: DexQuoteParams, options?: RequestOptions): Promise<DexQuote[]> {
    const { prices } = await this.get<{ prices: DexQuote[] }>("/v1/dex/quote", { ...params }, options);
    return prices;
  }

  /**
   * How much of `fromTokenAddress` the route's contract may already spend
   * for `fromAddress`, as a base-unit integer string.
   *
   * `GET /v1/dex/allow`
   */
  async allowance(params: DexAllowanceParams, options?: RequestOptions): Promise<string> {
    const { allowance } = await this.get<{ allowance: string }>("/v1/dex/allow", { ...params }, options);
    return allowance;
  }

  /**
   * The approval transaction to send from `fromAddress` before swapping a
   * token whose `allowance()` is short.
   *
   * `GET /v1/dex/approve`
   */
  approve(params: DexApproveParams, options?: RequestOptions): Promise<DexTransactionRequest> {
    return this.get<DexTransactionRequest>("/v1/dex/approve", { ...params }, options);
  }

  /**
   * The swap transaction to sign and send from `fromAddress`, and the
   * `swapId` to track it by.
   *
   * `GET /v1/dex/swap`
   *
   * A GET, but it registers a swap: only a 429 is retried, as with
   * `exchange.create()`.
   */
  swap(params: DexSwapParams, options?: RequestOptions): Promise<DexSwap> {
    return this.get<DexSwap>("/v1/dex/swap", { ...params }, options, false);
  }

  /**
   * A swap's progress. Send `fromHash` with the first call, once the
   * transaction is broadcast, so Swapzone can follow it.
   *
   * `GET /v1/dex/status`
   */
  status(params: DexStatusParams, options?: RequestOptions): Promise<DexSwapStatus> {
    return this.get<DexSwapStatus>("/v1/dex/status", { ...params }, options);
  }

  /**
   * Polls a swap until it reaches a terminal status (or whatever `until`
   * says), and returns the last status. `Failed` and `Fallback` are not errors:
   * check `status` on the result.
   *
   * @throws {SwapzoneTimeoutError} when `timeoutMs` passes first.
   */
  async waitFor(swapId: number | string, options: DexWaitForOptions = {}): Promise<DexSwapStatus> {
    const { fromHash, until = DEX_TERMINAL_STATUSES, intervalMs = 10_000, timeoutMs, signal, onUpdate } = options;
    const done = typeof until === "function" ? until : (s: DexSwapStatus) => until.includes(s.status);
    const deadline = timeoutMs === undefined ? Infinity : Date.now() + timeoutMs;

    let previous: DexSwapStatus | undefined;
    for (;;) {
      // The hash only needs registering once.
      const current = await this.status({ swapId, fromHash: previous === undefined ? fromHash : undefined }, { signal });
      if (previous === undefined || previous.status !== current.status) onUpdate?.(current, previous);
      if (done(current)) return current;
      previous = current;

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new SwapzoneTimeoutError(`DEX swap ${swapId} was still ${current.status} after ${timeoutMs} ms of waiting`);
      }
      await sleep(Math.min(intervalMs, remaining), signal);
    }
  }

  /** Every DEX response is `{ error, result }`; errors are thrown by the transport. */
  private async get<T>(
    path: string,
    query: Parameters<Transport["request"]>[0]["query"],
    options: RequestOptions | undefined,
    idempotent = true,
  ): Promise<T> {
    const { result } = await this.transport.request<Wrapped<T>>({ method: "GET", path, query, idempotent, options });
    return result;
  }
}
