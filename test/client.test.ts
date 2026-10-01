import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Swapzone,
  SwapzoneAPIError,
  SwapzoneAuthenticationError,
  SwapzoneConnectionError,
  SwapzoneError,
  SwapzoneRateLimitError,
  SwapzoneTimeoutError,
  VERSION,
} from "../src/index.js";
import { buildUrl, decimalString, parseRateLimitReset, parseRetryAfter } from "../src/core.js";
import { client, json, mockFetch, refusal, transaction } from "./helpers.js";

beforeEach(() => {
  // Full-jitter backoff times out at zero, so retries do not slow the suite.
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const CREATE = {
  from: "ltc",
  to: "usdtsol",
  amountDeposit: 1,
  addressReceive: "receive-address",
  quotaId: "quota_a",
};

describe("construction", () => {
  it("requires an API key", () => {
    vi.stubEnv("SWAPZONE_API_KEY", "");
    expect(() => new Swapzone()).toThrow(SwapzoneError);
  });

  it("falls back to SWAPZONE_API_KEY", async () => {
    vi.stubEnv("SWAPZONE_API_KEY", "from_env");
    const { fetch, calls } = mockFetch(json([]));
    await new Swapzone({ fetch }).exchange.currencies();
    expect(calls[0]!.headers.get("x-api-key")).toBe("from_env");
  });

  it("keeps VERSION in step with package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});

describe("requests", () => {
  it("sends the key in x-api-key, never in the URL, and callers cannot replace it", async () => {
    const { fetch, calls } = mockFetch(json([]));
    await client(fetch, { headers: { "X-Api-Key": "hijack", "X-Extra": "1" } }).exchange.currencies();

    const call = calls[0]!;
    expect(call.url.toString()).toBe("https://api.swapzone.io/v1/exchange/currencies");
    expect(call.headers.get("x-api-key")).toBe("test_key");
    expect(call.headers.get("x-extra")).toBe("1");
    expect(call.headers.get("user-agent")).toBe(`swapzone-sdk-js/${VERSION}`);
    expect(call.url.search).not.toContain("test_key");
  });

  it("sends a JSON body on POST", async () => {
    const { fetch, calls } = mockFetch(json({ transaction: transaction() }));
    await client(fetch).exchange.create(CREATE);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.get("content-type")).toBe("application/json");
    expect(calls[0]!.body).toEqual({ ...CREATE, amountDeposit: "1" });
  });

  it("builds queries: plain decimals, JSON for arrays and objects, nothing for undefined", () => {
    const url = new URL(
      buildUrl("https://api.swapzone.io/", "/v1/x", {
        amount: 1e-7,
        adapterList: ["a", "b"],
        routeId: { bridge: "squid", path: [] },
        on: true,
        skip: undefined,
        at: new Date("2026-01-01T00:00:00Z"),
      }),
    );
    expect(url.origin + url.pathname).toBe("https://api.swapzone.io/v1/x");
    expect(url.searchParams.get("amount")).toBe("0.0000001");
    expect(url.searchParams.get("adapterList")).toBe('["a","b"]');
    expect(url.searchParams.get("routeId")).toBe('{"bridge":"squid","path":[]}');
    expect(url.searchParams.get("on")).toBe("true");
    expect(url.searchParams.has("skip")).toBe(false);
    expect(url.searchParams.get("at")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("writes numbers without an exponent", () => {
    expect(decimalString(0.5)).toBe("0.5");
    expect(decimalString(1e-7)).toBe("0.0000001");
    expect(decimalString(1.5e21)).toBe("1500000000000000000000");
    expect(() => decimalString(Number.NaN)).toThrow(RangeError);
  });
});

describe("errors", () => {
  it("throws on a 200 that says error: true, and does not retry it", async () => {
    const { fetch, calls } = mockFetch(refusal("nonexistentcoin currency is not found"));
    const error = await client(fetch)
      .exchange.getRate({ from: "ltc", to: "nonexistentcoin", amount: 1 })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SwapzoneAPIError);
    expect(error).toMatchObject({ status: 200, apiMessage: "nonexistentcoin currency is not found" });
    expect(calls).toHaveLength(1);
  });

  it("maps a plain-text 401 to SwapzoneAuthenticationError", async () => {
    const { fetch } = mockFetch(new Response("Access denied", { status: 401, headers: { "content-type": "text/plain" } }));
    const error = await client(fetch).exchange.currencies().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SwapzoneAuthenticationError);
    expect(error).toMatchObject({ status: 401, apiMessage: "Access denied" });
  });

  it("throws SwapzoneError on a 2xx that is not JSON", async () => {
    const { fetch } = mockFetch(new Response("<html>", { status: 200 }));
    await expect(client(fetch).exchange.currencies()).rejects.toThrow(/not JSON/);
  });
});

describe("retries", () => {
  it("retries a 429 for the time RateLimit-Reset gives, even on create", async () => {
    vi.useFakeTimers();
    try {
      const reset = String(Math.floor(Date.now() / 1000) + 2);
      const { fetch, calls } = mockFetch(
        json({ message: "Too many requests" }, 429, { "ratelimit-reset": reset }),
        json({ transaction: transaction() }),
      );
      const pending = client(fetch).exchange.create(CREATE);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(pending).resolves.toMatchObject({ id: "tx_1" });
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a 429 that asks for more than a minute", async () => {
    const { fetch, calls } = mockFetch(json({}, 429, { "retry-after": "120" }));
    const error = await client(fetch).exchange.currencies().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SwapzoneRateLimitError);
    expect((error as SwapzoneRateLimitError).retryAfterMs).toBe(120_000);
    expect(calls).toHaveLength(1);
  });

  it("retries a 5xx and a dropped connection on reads", async () => {
    const { fetch, calls } = mockFetch(json({}, 502), new TypeError("fetch failed"), json([]));
    await expect(client(fetch).exchange.currencies()).resolves.toEqual([]);
    expect(calls).toHaveLength(3);
  });

  it("never retries create after a 5xx or a dropped connection", async () => {
    for (const reply of [json({}, 502), new TypeError("fetch failed")]) {
      const { fetch, calls } = mockFetch(reply);
      await expect(client(fetch).exchange.create(CREATE)).rejects.toBeInstanceOf(SwapzoneError);
      expect(calls).toHaveLength(1);
    }
  });

  it("never retries dex.swap after a 5xx", async () => {
    const { fetch, calls } = mockFetch(json({}, 503));
    const params = {
      adapter: "a",
      routeId: { bridge: "b", bridgeTokenAddress: "0x0", path: [] },
      fromChainId: 1,
      toChainId: 56,
      fromTokenAddress: "0xa",
      toTokenAddress: "0xb",
      fromAmount: 1,
      toAmount: 1,
      fromAddress: "0xc",
    };
    await expect(client(fetch).dex.swap(params)).rejects.toBeInstanceOf(SwapzoneAPIError);
    expect(calls).toHaveLength(1);
  });

  it("stops after maxRetries", async () => {
    const { fetch, calls } = mockFetch(json({}, 500), json({}, 500));
    await expect(client(fetch, { maxRetries: 1 }).exchange.currencies()).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(2);
  });
});

describe("timeouts and cancellation", () => {
  const hang = (_call: unknown, signal: AbortSignal | undefined) =>
    new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });

  it("times out an attempt", async () => {
    const { fetch } = mockFetch(hang);
    const error = await client(fetch, { timeoutMs: 10, maxRetries: 0 }).exchange.currencies().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SwapzoneTimeoutError);
  });

  it("rejects with the caller's own abort reason", async () => {
    const { fetch } = mockFetch(hang);
    const controller = new AbortController();
    const pending = client(fetch).exchange.currencies({ signal: controller.signal });
    const reason = new Error("stop");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("reports a connection failure", async () => {
    const { fetch } = mockFetch(new TypeError("fetch failed"));
    await expect(client(fetch, { maxRetries: 0 }).exchange.currencies()).rejects.toBeInstanceOf(
      SwapzoneConnectionError,
    );
  });
});

describe("rate-limit headers", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");

  it("reads Retry-After as seconds or a date", () => {
    expect(parseRetryAfter("3", now)).toBe(3_000);
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:05 GMT", now)).toBe(5_000);
    expect(parseRetryAfter("soon", now)).toBeUndefined();
  });

  it("reads RateLimit-Reset as a Unix time or as seconds from now", () => {
    expect(parseRateLimitReset(String(now / 1000 + 7), now)).toBe(7_000);
    expect(parseRateLimitReset("4", now)).toBe(4_000);
    expect(parseRateLimitReset(null, now)).toBeUndefined();
  });
});
