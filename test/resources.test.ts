import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwapzoneTimeoutError, isDexTerminalStatus, isTerminalStatus } from "../src/index.js";
import { client, collect, json, mockFetch, rate, transaction } from "./helpers.js";

beforeEach(() => {
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exchange", () => {
  it("getRate sends the pair and amount", async () => {
    const { fetch, calls } = mockFetch(json(rate()));
    const result = await client(fetch).exchange.getRate({
      from: "sol",
      to: "ltc",
      amount: 0.5,
      rateType: "floating",
      chooseRate: "recommended",
    });

    expect(result.quotaId).toBe("quota_a");
    const query = calls[0]!.url.searchParams;
    expect(calls[0]!.url.pathname).toBe("/v1/exchange/get-rate");
    expect(Object.fromEntries(query)).toEqual({
      from: "sol",
      to: "ltc",
      amount: "0.5",
      rateType: "floating",
      chooseRate: "recommended",
    });
  });

  it("getRates asks for every offer and always returns an array", async () => {
    const { fetch, calls } = mockFetch(json([rate(), rate({ adapter: "partner_b" })]), json(rate()));
    const swapzone = client(fetch);

    expect(await swapzone.exchange.getRates({ from: "ltc", to: "usdtsol", amount: 1 })).toHaveLength(2);
    expect(calls[0]!.url.searchParams.get("chooseRate")).toBe("all");
    expect(await swapzone.exchange.getRates({ from: "ltc", to: "usdtsol", amount: 1 })).toHaveLength(1);
  });

  it("create and get unwrap the transaction", async () => {
    const { fetch, calls } = mockFetch(json({ transaction: transaction() }), json({ transaction: transaction() }));
    const swapzone = client(fetch);

    const created = await swapzone.exchange.create({
      from: "ltc",
      to: "usdtsol",
      amountDeposit: "1.25",
      addressReceive: "receive-address",
      refundAddress: "refund-address",
      quotaId: "quota_a",
    });
    expect(created.addressDeposit).toBe("deposit-address");
    expect(calls[0]!.body).toMatchObject({ amountDeposit: "1.25", refundAddress: "refund-address" });

    await swapzone.exchange.get("tx_1");
    expect(calls[1]!.url.pathname).toBe("/v1/exchange/tx");
    expect(calls[1]!.url.searchParams.get("id")).toBe("tx_1");
  });

  it("listAll walks the pages and stops at a short one", async () => {
    const summary = (id: string) => ({ _id: id });
    const { fetch, calls } = mockFetch(
      json({ responseTxs: [summary("a"), summary("b")] }),
      json({ responseTxs: [summary("c")] }),
    );
    const all = await collect(client(fetch).exchange.listAll({ pageSize: 2, dateFrom: new Date("2026-01-01T00:00:00Z") }));

    expect(all.map((t) => t._id)).toEqual(["a", "b", "c"]);
    expect(calls.map((c) => c.url.searchParams.get("offset"))).toEqual(["0", "2"]);
    expect(calls[0]!.url.searchParams.get("dateFrom")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("pairs sends adapterList as a JSON array", async () => {
    const { fetch, calls } = mockFetch(json({ total: 0, limit: "10", offset: 0, data: [] }));
    await client(fetch).exchange.pairs({ adapterList: ["changenow"], limit: 10 });
    expect(calls[0]!.url.searchParams.get("adapterList")).toBe('["changenow"]');
  });

  it("markets defaults to fixed rates", async () => {
    const { fetch, calls } = mockFetch(json([]));
    await client(fetch).exchange.markets();
    expect(calls[0]!.url.searchParams.get("rateType")).toBe("fixed");
  });

  it("knows its terminal statuses", () => {
    for (const status of ["finished", "failed", "refunded", "overdue"]) expect(isTerminalStatus(status)).toBe(true);
    for (const status of ["waiting", "confirming", "exchanging", "sending"]) expect(isTerminalStatus(status)).toBe(false);
  });

  describe("waitFor", () => {
    it("polls until a terminal status and reports each change", async () => {
      const { fetch, calls } = mockFetch(
        json({ transaction: transaction({ status: "waiting" }) }),
        json({ transaction: transaction({ status: "waiting" }) }),
        json({ transaction: transaction({ status: "exchanging" }) }),
        json({ transaction: transaction({ status: "finished", payoutHash: "0xpaid" }) }),
      );
      const seen: string[] = [];
      const done = await client(fetch).exchange.waitFor("tx_1", {
        intervalMs: 1,
        onUpdate: (tx) => seen.push(tx.status),
      });

      expect(done.payoutHash).toBe("0xpaid");
      expect(seen).toEqual(["waiting", "exchanging", "finished"]);
      expect(calls).toHaveLength(4);
    });

    it("times out", async () => {
      const { fetch } = mockFetch(
        json({ transaction: transaction() }),
        json({ transaction: transaction() }),
        json({ transaction: transaction() }),
      );
      await expect(client(fetch).exchange.waitFor("tx_1", { intervalMs: 5, timeoutMs: 1 })).rejects.toBeInstanceOf(
        SwapzoneTimeoutError,
      );
    });
  });
});

describe("dex", () => {
  const ROUTE = {
    fromChain: "ethereum",
    toChain: "bsc",
    fromTokenAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    toTokenAddress: "0xb",
    fromAmount: "0.05",
    toAmount: "94.1",
    toAmountUsd: "94.1",
    networkFee: [],
    bridgeFee: [],
    routing: ["squid"],
    id: { bridge: "squid", bridgeTokenAddress: "0x0", path: [] },
    adapter: "swing",
  };

  it("unwraps { error, result } and returns the quote's prices", async () => {
    const { fetch, calls } = mockFetch(json({ error: false, result: { prices: [ROUTE] } }));
    const routes = await client(fetch).dex.quote({
      fromChainId: 1,
      toChainId: 56,
      fromTokenAddress: ROUTE.fromTokenAddress,
      toTokenAddress: "0xb",
      fromAmount: 0.05,
      slippage: 1,
    });
    expect(routes).toEqual([ROUTE]);
    expect(calls[0]!.url.pathname).toBe("/v1/dex/quote");
    expect(calls[0]!.url.searchParams.get("fromAmount")).toBe("0.05");
  });

  it("allowance returns the integer string", async () => {
    const { fetch } = mockFetch(json({ error: false, result: { allowance: "42" } }));
    const allowance = await client(fetch).dex.allowance({
      adapter: "swing",
      fromChainId: 1,
      toChainId: 56,
      fromAddress: "0xc",
      fromTokenAddress: "0xa",
      toTokenAddress: "0xb",
      bridge: "squid",
    });
    expect(allowance).toBe("42");
  });

  it("swap sends the route id as JSON", async () => {
    const { fetch, calls } = mockFetch(json({ error: false, result: { swapId: 7, to: "0xrouter", data: "0x" } }));
    const swap = await client(fetch).dex.swap({
      adapter: ROUTE.adapter,
      routeId: ROUTE.id,
      fromChainId: 1,
      toChainId: 56,
      fromTokenAddress: ROUTE.fromTokenAddress,
      toTokenAddress: ROUTE.toTokenAddress,
      fromAmount: ROUTE.fromAmount,
      toAmount: ROUTE.toAmount,
      fromAddress: "0xc",
    });
    expect(swap.swapId).toBe(7);
    expect(JSON.parse(calls[0]!.url.searchParams.get("routeId")!)).toEqual(ROUTE.id);
  });

  it("waitFor registers the hash on the first poll only", async () => {
    const { fetch, calls } = mockFetch(
      json({ error: false, result: { status: "Submitted" } }),
      json({ error: false, result: { status: "Completed", toHash: "0xdone" } }),
    );
    const done = await client(fetch).dex.waitFor(7, { fromHash: "0xsent", intervalMs: 1 });

    expect(done.toHash).toBe("0xdone");
    expect(calls[0]!.url.searchParams.get("fromHash")).toBe("0xsent");
    expect(calls[1]!.url.searchParams.has("fromHash")).toBe(false);
  });

  it("knows its terminal statuses", () => {
    for (const status of ["Completed", "Failed", "Fallback"]) expect(isDexTerminalStatus(status)).toBe(true);
    expect(isDexTerminalStatus("Pending Destination Chain")).toBe(false);
  });
});
