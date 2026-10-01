/**
 * Request and response types. Field names are the API's own camelCase, exactly
 * as it sends them, so these types, the Swapzone docs and your logs all match.
 *
 * Amounts: the API sends some as numbers and some as decimal strings, and the
 * same field can differ between endpoints (`amountDeposit` is a string on a
 * transaction). Each type below says which; parse strings with a decimal
 * library, not `Number()`, when the exact value matters.
 */

/** An amount you send: a number, or a decimal string for exact values. */
export type Amount = number | string;

// ---------------------------------------------------------------------------
// Instant exchange
// ---------------------------------------------------------------------------

/** A currency the instant exchange supports. */
export interface Currency {
  name: string;
  /** Lowercase and unique, such as `"ltc"` or `"usdtsol"`. This is what every other method takes. */
  ticker: string;
  /** The chain, such as `"LTC"`, `"ETH"`, `"BSC"`, `"POLYGON"` or `"SOL"`. May be `""` for old entries. */
  network: string;
  /** The token contract (mint, on Solana). `null` for a chain's base coin. */
  smartContract?: string | null;
  /** A sensible amount to quote with, in whole units. */
  defaultAmount?: number | null;
  /** Other tickers that mean the same currency. */
  alias?: string[];
}

/** `fixed` locks the amount received; `floating` follows the market until the deposit lands. */
export type RateType = "fixed" | "floating";

export interface GetRateParams {
  /** Ticker you send. */
  from: string;
  /** Ticker you receive. */
  to: string;
  /** Amount of `from` to send, in whole units. */
  amount: Amount;
  /** Defaults to `"all"`: the API considers both rate types. */
  rateType?: RateType | "all";
  /** Only partners that serve customers in the USA. */
  availableInUSA?: boolean;
  /** Only partners that do not require a refund address. */
  noRefundAddress?: boolean;
  fromNetwork?: string;
  toNetwork?: string;
  /** Quote in reverse: the amount of `to` you want to receive. */
  amountTo?: Amount;
  /** Upper bound on how long the API spends collecting offers, in milliseconds. */
  timeout?: number;
  /** Also ask partners with open financial claims. */
  ofcAdapter?: string;
}

/** One partner's offer. */
export interface Rate {
  /** The partner, such as `"changenow"`. A `_fix` suffix marks its fixed-rate offer. */
  adapter: string;
  from: string;
  fromNetwork: string;
  to: string;
  toNetwork: string;
  /** Number. */
  amountFrom: number;
  /** Number: the estimated amount of `to` received. */
  amountTo: number;
  amountFromUSD?: number;
  amountToUSD?: number;
  defaultAmountFrom?: number | null;
  defaultAmountTo?: number | null;
  /** Smallest `amountFrom` the partner accepts. `null` when it did not say. */
  minAmount: number | null;
  /** Largest `amountFrom` the partner accepts. `null` means no stated limit. */
  maxAmount: number | null;
  /** Pass to `exchange.create()` as `quotaId`. Identifies the partner, not this quote. */
  quotaId: string;
  /** How long the partner took to answer. */
  time?: number;
  /** How closely the partner's past payouts matched their quotes, in percent. */
  accuracyRate?: number;
  /** Fixed rates: when the offer lapses (ISO 8601). */
  validUntil?: string;
  /** Fixed rates from some partners: pass to `exchange.create()` as `offerReferenceId`. */
  offerReferenceId?: string;
  /** Fixed rates from some partners: when `offerReferenceId` lapses. */
  offerExpirationTime?: string;
  /** Present when the partner has open financial claims. */
  open_fincases?: string;
}

export interface CreateTransactionParams {
  from: string;
  to: string;
  /** Amount of `from` the user will send. */
  amountDeposit: Amount;
  /** Where the partner pays out. */
  addressReceive: string;
  /** Memo or destination tag for `addressReceive`, when the chain uses one. */
  extraIdReceive?: string;
  /** Where the partner returns the deposit if the swap fails. Set it whenever you can. */
  refundAddress?: string;
  refundExtraId?: string;
  /** From the chosen `Rate`. Required unless `noQuotaId` is true. */
  quotaId?: string;
  /** Let the API pick the partner instead of `quotaId`. */
  noQuotaId?: boolean;
  fromNetwork?: string;
  toNetwork?: string;
  noRefundAddress?: boolean;
  /** Fixed rate: the chosen `Rate`'s `offerReferenceId`, when it had one. */
  offerReferenceId?: string;
  ofcAdapter?: string;
}

/**
 * `waiting` (no deposit yet), `confirming`, `exchanging`, `sending`, then one
 * of the endings: `finished`, `failed`, `refunded` or `overdue` (no deposit
 * arrived in time).
 */
export type TransactionStatus =
  | "waiting"
  | "confirming"
  | "exchanging"
  | "sending"
  | "finished"
  | "failed"
  | "refunded"
  | "overdue"
  | (string & {});

/** An instant-exchange order. */
export interface Transaction {
  id: string;
  quotaId: string;
  from: string;
  fromNetwork: string;
  to: string;
  toNetwork: string;
  status: TransactionStatus;
  /** Where the user sends the deposit. */
  addressDeposit: string;
  /** Memo the deposit needs, when the chain uses one. Present on `get()`. */
  extraIdDeposit?: string;
  addressReceive: string;
  extraIdReceive: string;
  /** Decimal string (a number on some partners): what the user should send. */
  amountDeposit: string | number;
  /** Decimal string (a number on some partners): the estimated payout. */
  amountEstimated: string | number;
  /** Decimal string: what was actually paid out, once known. */
  amountRealReceive?: string | number | null;
  refundAddress: string;
  refundExtraId: string;
  addressRefund?: string;
  extraIdRefund?: string;
  /** Deposit transaction hash, once seen. */
  payinHash?: string | null;
  /** Payout transaction hash, once sent. */
  payoutHash?: string | null;
  /** Payout transaction hash as some partners report it. Check both. */
  hashReceive?: string | null;
  createdAt: string;
  updatedAt?: string;
  depositReceivedAt?: string | null;
  finishedAt?: string | null;
  /** Deadline for the deposit. */
  payTill?: string | null;
  email?: string;
  amountFromBtc?: string | number;
}

export interface ListTransactionsParams {
  limit?: number;
  offset?: number;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  dateUpdateFrom?: Date | string;
  dateUpdateTo?: Date | string;
}

/** A transaction as `exchange.list()` returns it: a summary with your fees. */
export interface TransactionSummary {
  _id: string;
  createdAt: string;
  from: string;
  to: string;
  status: TransactionStatus;
  amountDeposit: string | number;
  amountEstimated: string | number;
  addressReceive: string;
  extraIdReceive: string;
  addressDeposit: string;
  refundExtraId: string;
  feeAmount?: number;
  profitCoin?: string;
  fee?: number;
  txFee?: number;
  extraFee?: number;
}

/** One pair from `exchange.markets()`. */
export interface MarketRate {
  from: string;
  fromNetwork: string | null;
  to: string;
  toNetwork: string | null;
  amountFrom: number;
  amountTo: number;
  quotaId: string;
}

export interface GetPairsParams {
  /** Only pairs these partners offer. */
  adapterList?: readonly string[];
  limit?: number;
  offset?: number;
}

export interface PairSide {
  title: string;
  ticker: string;
  network: string;
}

export interface Pair {
  from: PairSide;
  to: PairSide;
  rateType: RateType[];
  adapters?: string[];
}

export interface PairsPage {
  total: number;
  /** As the API echoes it: sometimes a string. */
  limit: number | string;
  offset: number | string;
  data: Pair[];
}

export interface ValidateAddressParams {
  /** Ticker. */
  currency: string;
  address: string;
}

export interface AddressValidation {
  result: boolean;
  message: string | null;
}

// ---------------------------------------------------------------------------
// DEX
// ---------------------------------------------------------------------------

export interface DexBlockchain {
  _id: string;
  /** EVM chain id; `0` is Solana. Every DEX method takes this. `null` on placeholder entries: skip those. */
  chainId: number | null;
  name: string;
  shortName?: string;
}

/** Where a `DexToken` lives on one chain. */
export interface DexTokenChain {
  chainId: number;
  /** Contract address (mint, on Solana). A chain's base coin is `0xeeee...eeee`. */
  address: string;
  decimals: number;
  chainName?: string;
  chainSlug?: string;
  /** A pattern an address on this chain must match. */
  regAddress?: string;
  /** Prefix a transaction hash with this for an explorer link. */
  explorerUrlHash?: string;
  /** Providers that can route this token here. */
  adapters?: string[];
  adaptersEnabled?: string[];
}

/** A token, with one entry per chain it is on. */
export interface DexToken {
  _id: string;
  symbol: string;
  name: string;
  isActive?: boolean;
  logo?: string;
  defaultAmount?: number;
  defaultChain?: number;
  priority?: number;
  chains: DexTokenChain[];
}

/** A TON jetton. */
export interface DexTonToken {
  _id: string;
  chainId: number;
  contractAddress: string;
  meta?: { symbol?: string; displayName?: string; imageUrl?: string; decimals?: number };
  dexPriceUsd?: string;
  kind?: string;
}

export interface DexTokenList {
  tokens: DexToken[];
  tonTokens?: DexTonToken[];
}

export interface DexQuoteParams {
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  /** In whole units, such as `0.05`. */
  fromAmount: Amount;
  /** Maximum slippage in percent, such as `1` for 1%. */
  slippage?: number;
}

export interface DexFee {
  amount: number;
  amountUSD: string;
  networkFeeTokenAddress?: string;
  networkFeeToken?: string;
  bridgeFeeTokenAddress?: string;
  bridgeFeeToken?: string;
}

/** Pass it whole to `dex.swap()` as `routeId`. */
export interface DexRouteId {
  bridge: string;
  bridgeTokenAddress: string;
  path: unknown[];
}

/** One route from `dex.quote()`. */
export interface DexQuote {
  fromChain: string;
  toChain: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  /** Decimal string, whole units. */
  fromAmount: string;
  /** Decimal string, whole units. */
  toAmount: string;
  toAmountUsd: string;
  networkFee: DexFee[];
  bridgeFee: DexFee[];
  routing: string[];
  id: DexRouteId;
  /** Pass to the later DEX calls. */
  adapter: string;
}

/** What `dex.allowance()` and `dex.approve()` need to identify the spender. */
export interface DexAllowanceParams {
  adapter: string;
  fromChainId: number;
  toChainId: number;
  /** The wallet that will sign the swap. */
  fromAddress: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  /** The quote's `id.bridge`. */
  bridge?: string;
}

export interface DexApproveParams extends DexAllowanceParams {
  fromAmount: Amount;
}

/** An unsigned transaction to send from `fromAddress`. */
export interface DexTransactionRequest {
  to: string;
  data: string;
}

export interface DexSwapParams {
  adapter: string;
  /** The quote's `id`. */
  routeId: DexRouteId;
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAmount: Amount;
  /** The quote's `toAmount`. */
  toAmount: Amount;
  fromAddress: string;
  slippage?: number;
}

/** The transaction to sign and send, and the id to track it by. */
export interface DexSwap extends DexTransactionRequest {
  swapId: number | string;
  /** Gas limit. */
  gas?: string;
  /** Native value to attach, hex. */
  amountTotalHex?: string;
}

export interface DexStatusParams {
  swapId: number | string;
  /** The source-chain transaction hash. Needed on the first status call, to register it. */
  fromHash?: string;
}

/**
 * `Created`, `Submitted`, `Pending Source Chain`, `Pending Destination Chain`,
 * then one of the endings: `Completed`, `Failed` or `Fallback` (paid out on the
 * destination chain, but in the bridge token).
 */
export type DexSwapStatusName =
  | "Created"
  | "Submitted"
  | "Pending Source Chain"
  | "Pending Destination Chain"
  | "Completed"
  | "Failed"
  | "Fallback"
  | (string & {});

export interface DexSwapStatus {
  status: DexSwapStatusName;
  fromHash?: string | null;
  toHash?: string | null;
  fromChain?: string;
  toChain?: string;
  bridge?: string;
  fromToken?: string;
  toToken?: string;
  fromTokenAddress?: string;
  toTokenAddress?: string;
  fromAmount?: number;
  toAmount?: number;
  /** What the user actually received, in whole units. */
  realToAmount?: number | null;
  fromAmountUsd?: string;
  toAmountUsd?: string;
  partnerTxId?: string;
  createdAt?: string;
  updatedAt?: string;
  userAddress?: string;
}
