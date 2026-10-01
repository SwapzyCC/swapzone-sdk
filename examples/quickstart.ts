/**
 * Read-only tour: find two currencies, compare every partner's offer, and take
 * the best one. Nothing is created.
 *
 *   npx tsx --env-file=.env examples/quickstart.ts
 */
import { Swapzone, SwapzoneAPIError } from "../src/index.js";

const swapzone = new Swapzone(); // reads SWAPZONE_API_KEY

const currencies = await swapzone.exchange.currencies();
console.log(`${currencies.length} currencies`);

// Tickers are unique, but the same token exists on many chains: find the one
// you mean by network and contract, not by name.
const usdtOnSolana = currencies.find(
  (c) => c.network === "SOL" && c.smartContract === "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
);
if (!usdtOnSolana) throw new Error("USDT on Solana is not listed");
console.log(`USDT on Solana is "${usdtOnSolana.ticker}"`);

try {
  const offers = await swapzone.exchange.getRates({ from: "ltc", to: usdtOnSolana.ticker, amount: 1, rateType: "floating" });
  for (const offer of offers.sort((a, b) => b.amountTo - a.amountTo)) {
    console.log(
      `${offer.adapter.padEnd(16)} ${offer.amountTo} USDT  (min ${offer.minAmount ?? "?"} / max ${offer.maxAmount ?? "none"} LTC)`,
    );
  }
} catch (error) {
  if (error instanceof SwapzoneAPIError) {
    console.error(`Swapzone said: ${error.apiMessage}`);
  } else {
    throw error;
  }
}
