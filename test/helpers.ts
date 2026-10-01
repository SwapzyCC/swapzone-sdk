import { Swapzone, type SwapzoneOptions } from "../src/index.js";

export interface RecordedCall {
  url: URL;
  method: string;
  headers: Headers;
  body: unknown;
}

type Reply = Response | Error | ((call: RecordedCall, signal: AbortSignal | undefined) => Response | Promise<Response>);

/** A `fetch` that answers from a queue and records every call. */
export function mockFetch(...replies: Reply[]) {
  const calls: RecordedCall[] = [];
  const queue = [...replies];

  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const call: RecordedCall = {
      url: new URL(String(input)),
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);

    const reply = queue.shift();
    if (reply === undefined) throw new Error(`Unexpected request: ${call.method} ${call.url}`);
    if (reply instanceof Error) throw reply;
    if (typeof reply === "function") return reply(call, init.signal ?? undefined);
    return reply;
  };

  return { fetch: fetch as typeof globalThis.fetch, calls };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A refusal the way Swapzone sends most of them: HTTP 200. */
export function refusal(message: string): Response {
  return json({ error: true, message });
}

export function client(fetch: typeof globalThis.fetch, options: SwapzoneOptions = {}): Swapzone {
  return new Swapzone({ apiKey: "test_key", fetch, ...options });
}

export function rate(overrides: Record<string, unknown> = {}) {
  return {
    adapter: "partner_a",
    from: "ltc",
    fromNetwork: "LTC",
    to: "usdtsol",
    toNetwork: "SOL",
    amountFrom: 1,
    amountTo: 66,
    minAmount: 0.02,
    maxAmount: 1000,
    quotaId: "quota_a",
    time: 20,
    ...overrides,
  };
}

export function transaction(overrides: Record<string, unknown> = {}) {
  return {
    id: "tx_1",
    quotaId: "quota_a",
    from: "ltc",
    fromNetwork: "LTC",
    to: "usdtsol",
    toNetwork: "SOL",
    status: "waiting",
    addressDeposit: "deposit-address",
    addressReceive: "receive-address",
    extraIdReceive: "",
    amountDeposit: "1",
    amountEstimated: "66",
    refundAddress: "refund-address",
    refundExtraId: "",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Drains an async iterable. `Array.fromAsync`, without needing the ES2024+ lib. */
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}
