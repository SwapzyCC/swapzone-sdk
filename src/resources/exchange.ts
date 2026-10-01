import { decimalString, sleep, type RequestOptions, type Transport } from "../core.js";
import { SwapzoneTimeoutError } from "../errors.js";
import type {
  AddressValidation,
  CreateTransactionParams,
  Currency,
  GetPairsParams,
  GetRateParams,
  ListTransactionsParams,
  MarketRate,
  PairsPage,
  Rate,
  RateType,
  Transaction,
  TransactionStatus,
  TransactionSummary,
  ValidateAddressParams,
} from "../types.js";
import { paginate } from "./pagination.js";

/** Statuses a transaction never leaves. */
export const TERMINAL_STATUSES: readonly TransactionStatus[] = ["finished", "failed", "refunded", "overdue"];

/** Whether a transaction in this status is done for good. */
export function isTerminalStatus(status: TransactionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface ListAllTransactionsParams extends Omit<ListTransactionsParams, "limit" | "offset"> {
  /** Items per request. Defaults to 100. */
  pageSize?: number;
}

export interface WaitForOptions {
  /**
   * When to stop: a list of statuses, or a test of the whole transaction.
   * Defaults to `TERMINAL_STATUSES`.
   */
  until?: readonly TransactionStatus[] | ((transaction: Transaction) => boolean);
  /** Between polls, in milliseconds. Defaults to 15 000. */
  intervalMs?: number;
  /** Give up after this long, in milliseconds, with a `SwapzoneTimeoutError`. Defaults to no limit. */
  timeoutMs?: number;
  /** Stops waiting; rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Called with the first poll, and again whenever the status changes. */
  onUpdate?: (transaction: Transaction, previous: Transaction | undefined) => void;
}

/** The instant exchange: a partner gives a deposit address and pays out once the deposit lands. */
export class Exchange {
  constructor(private readonly transport: Transport) {}

  /**
   * Every currency the instant exchange supports.
   *
   * `GET /v1/exchange/currencies`
   *
   * @example
   * const currencies = await swapzone.exchange.currencies();
   * const usdtOnSolana = currencies.find((c) => c.network === "SOL" && c.smartContract === mint);
   */
  currencies(options?: RequestOptions): Promise<Currency[]> {
    return this.transport.request<Currency[]>({
      method: "GET",
      path: "/v1/exchange/currencies",
      idempotent: true,
      options,
    });
  }

  /**
   * One offer for a pair and amount: the best (the default) or Swapzone's
   * recommended one.
   *
   * `GET /v1/exchange/get-rate`
   *
   * @throws {SwapzoneAPIError} with status 200 for an unknown ticker
   * (`"... currency is not found"`) or an amount no partner accepts.
   *
   * @example
   * const rate = await swapzone.exchange.getRate({ from: "sol", to: "ltc", amount: 0.5, rateType: "floating" });
   * console.log(rate.amountTo, rate.adapter);
   */
  getRate(
    params: GetRateParams & { chooseRate?: "best" | "recommended" },
    options?: RequestOptions,
  ): Promise<Rate> {
    return this.transport.request<Rate>({
      method: "GET",
      path: "/v1/exchange/get-rate",
      query: { ...params },
      idempotent: true,
      options,
    });
  }

  /**
   * Every partner's offer for a pair and amount, to compare or to filter
   * yourself (by `accuracyRate`, `maxAmount`, ...).
   *
   * `GET /v1/exchange/get-rate?chooseRate=all`
   *
   * @example
   * const offers = await swapzone.exchange.getRates({ from: "ltc", to: "usdtsol", amount: 1, rateType: "floating" });
   * const best = offers.reduce((a, b) => (b.amountTo > a.amountTo ? b : a));
   */
  async getRates(params: GetRateParams, options?: RequestOptions): Promise<Rate[]> {
    const result = await this.transport.request<Rate[] | Rate>({
      method: "GET",
      path: "/v1/exchange/get-rate",
      query: { ...params, chooseRate: "all" },
      idempotent: true,
      options,
    });
    // A pair with a single partner can come back as that one object.
    return Array.isArray(result) ? result : [result];
  }

  /**
   * Opens an order with a partner. The response's `addressDeposit` (and
   * `extraIdDeposit`, when set) is where the user sends `amountDeposit`.
   *
   * Pass the chosen `Rate`'s `quotaId`, and for a fixed rate its
   * `offerReferenceId` when it has one.
   *
   * `POST /v1/exchange/create`
   *
   * Only a 429 is retried here. A timeout or 5xx could come after the order
   * was created, and a blind retry would create a second one: look for it in
   * `list()` instead.
   *
   * @throws {SwapzoneAPIError} with status 200 when the partner declines
   * (an invalid address, an amount out of range, an unknown `quotaId`).
   *
   * @example
   * const tx = await swapzone.exchange.create({
   *   from: "sol",
   *   to: "ltc",
   *   amountDeposit: 0.5,
   *   addressReceive: "<recipient LTC address>",
   *   refundAddress: "<refund SOL address>",
   *   quotaId: rate.quotaId,
   * });
   */
  async create(params: CreateTransactionParams, options?: RequestOptions): Promise<Transaction> {
    const { amountDeposit } = params;
    const body = { ...params, amountDeposit: typeof amountDeposit === "number" ? decimalString(amountDeposit) : amountDeposit };
    const { transaction } = await this.transport.request<{ transaction: Transaction }>({
      method: "POST",
      path: "/v1/exchange/create",
      body,
      idempotent: false,
      options,
    });
    return transaction;
  }

  /**
   * One transaction, with its current status.
   *
   * `GET /v1/exchange/tx`
   *
   * @throws {SwapzoneAPIError} with status 200 for an unknown id.
   */
  async get(id: string, options?: RequestOptions): Promise<Transaction> {
    const { transaction } = await this.transport.request<{ transaction: Transaction }>({
      method: "GET",
      path: "/v1/exchange/tx",
      query: { id },
      idempotent: true,
      options,
    });
    return transaction;
  }

  /**
   * One page of the transactions made with your API key, newest first. See
   * `listAll()` to walk them all.
   *
   * `GET /v1/exchange/transactions-list`
   */
  async list(params: ListTransactionsParams = {}, options?: RequestOptions): Promise<TransactionSummary[]> {
    const { responseTxs } = await this.transport.request<{ responseTxs: TransactionSummary[] }>({
      method: "GET",
      path: "/v1/exchange/transactions-list",
      query: { ...params },
      idempotent: true,
      options,
    });
    return responseTxs;
  }

  /**
   * Every transaction matching the filters, fetched page by page as you iterate.
   *
   * @example
   * for await (const tx of swapzone.exchange.listAll({ dateFrom: new Date("2026-01-01") })) {
   *   if (tx.status === "failed") console.log(tx._id);
   * }
   */
  listAll(
    params: ListAllTransactionsParams = {},
    options?: RequestOptions,
  ): AsyncGenerator<TransactionSummary, void, undefined> {
    const { pageSize = 100, ...filters } = params;
    return paginate((limit, offset) => this.list({ ...filters, limit, offset }, options), pageSize);
  }

  /**
   * Rates for every pair at once, from the partners that support it. Swapzone
   * enables this per API key on request.
   *
   * `GET /v1/exchange/markets`
   */
  markets(params: { rateType?: RateType } = {}, options?: RequestOptions): Promise<MarketRate[]> {
    return this.transport.request<MarketRate[]>({
      method: "GET",
      path: "/v1/exchange/markets",
      query: { rateType: params.rateType ?? "fixed" },
      idempotent: true,
      options,
    });
  }

  /**
   * One page of the tradable pairs, optionally only those given partners offer.
   *
   * `GET /v1/exchange/get-pairs`
   */
  pairs(params: GetPairsParams = {}, options?: RequestOptions): Promise<PairsPage> {
    return this.transport.request<PairsPage>({
      method: "GET",
      path: "/v1/exchange/get-pairs",
      query: { ...params },
      idempotent: true,
      options,
    });
  }

  /**
   * Whether `address` is a valid receiving address for a currency.
   *
   * `GET /v1/exchange/validate/address`
   *
   * Some API keys get `"Check params"` back for every input; that throws
   * `SwapzoneAPIError`. Validate locally as well rather than relying on this.
   */
  validateAddress(params: ValidateAddressParams, options?: RequestOptions): Promise<AddressValidation> {
    return this.transport.request<AddressValidation>({
      method: "GET",
      path: "/v1/exchange/validate/address",
      query: { ...params },
      idempotent: true,
      options,
    });
  }

  /**
   * Polls a transaction until it reaches a terminal status (or whatever
   * `until` says), and returns it.
   *
   * Reaching `failed`, `refunded` or `overdue` is not an error: check `status`
   * on the result.
   *
   * @throws {SwapzoneTimeoutError} when `timeoutMs` passes first.
   *
   * @example
   * const done = await swapzone.exchange.waitFor(tx.id, { timeoutMs: 2 * 60 * 60 * 1000 });
   * if (done.status === "finished") console.log("paid out", done.payoutHash ?? done.hashReceive);
   */
  async waitFor(id: string, options: WaitForOptions = {}): Promise<Transaction> {
    const { until = TERMINAL_STATUSES, intervalMs = 15_000, timeoutMs, signal, onUpdate } = options;
    const done = typeof until === "function" ? until : (tx: Transaction) => until.includes(tx.status);
    const deadline = timeoutMs === undefined ? Infinity : Date.now() + timeoutMs;

    let previous: Transaction | undefined;
    for (;;) {
      const tx = await this.get(id, { signal });
      if (previous === undefined || previous.status !== tx.status) onUpdate?.(tx, previous);
      if (done(tx)) return tx;
      previous = tx;

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new SwapzoneTimeoutError(`Transaction ${id} was still ${tx.status} after ${timeoutMs} ms of waiting`);
      }
      await sleep(Math.min(intervalMs, remaining), signal);
    }
  }
}
