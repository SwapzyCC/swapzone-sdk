/**
 * Read-only DEX tour: list the chains and quote a cross-chain swap. Nothing is
 * signed or sent.
 *
 *   npx tsx --env-file=.env examples/dex-quote.ts
 */
import { Swapzone } from "../src/index.js";

const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

const swapzone = new Swapzone();

const chains = await swapzone.dex.blockchains();
console.log(
  chains
    .filter((c) => c.chainId !== null)
    .map((c) => `${c.chainId} ${c.shortName ?? c.name}`)
    .join(", "),
);

const { tokens } = await swapzone.dex.tokens();
const usdcOnBsc = tokens.find((t) => t.symbol === "USDC")?.chains.find((c) => c.chainId === 56);
if (!usdcOnBsc) throw new Error("USDC on BSC is not listed");

const routes = await swapzone.dex.quote({
  fromChainId: 1,
  toChainId: 56,
  fromTokenAddress: NATIVE,
  toTokenAddress: usdcOnBsc.address,
  fromAmount: 0.05,
  slippage: 1,
});
if (routes.length === 0) console.log("No routes. DEX access may need enabling on your API key.");
for (const route of routes) {
  const fees = [...route.networkFee, ...route.bridgeFee].reduce((sum, f) => sum + Number(f.amountUSD), 0);
  console.log(`${route.adapter}/${route.id.bridge}: ${route.toAmount} USDC, fees ~$${fees.toFixed(2)}`);
}
