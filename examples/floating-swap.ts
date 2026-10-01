/**
 * A floating-rate swap, end to end: pick an offer the amount fits, create the
 * order, show the deposit instructions, then follow it until it is done.
 *
 * Creating an order moves no funds; nothing happens until someone deposits.
 *
 *   RECIPIENT_ADDRESS=<your LTC address> REFUND_ADDRESS=<your SOL address> \
 *     npx tsx --env-file=.env examples/floating-swap.ts sol ltc 0.5
 */
import { Swapzone } from "../src/index.js";

const recipient = process.env.RECIPIENT_ADDRESS;
const refund = process.env.REFUND_ADDRESS;
if (!recipient || !refund) throw new Error("Set RECIPIENT_ADDRESS and REFUND_ADDRESS.");

const [from = "sol", to = "ltc", amountText = "0.5"] = process.argv.slice(2);
const amount = Number(amountText);

const swapzone = new Swapzone();

// 1. Every partner's offer; keep those whose limits the amount fits.
const offers = await swapzone.exchange.getRates({ from, to, amount, rateType: "floating" });
const fitting = offers.filter(
  (o) => (o.minAmount === null || amount >= o.minAmount) && (o.maxAmount === null || amount <= o.maxAmount),
);
const best = fitting.sort((a, b) => b.amountTo - a.amountTo)[0];
if (!best) throw new Error(`No partner takes ${amount} ${from}.`);
console.log(`Best: ${best.adapter}, ${amount} ${from} -> ~${best.amountTo} ${to}`);

// 2. Create the order with that partner. Never retried after a 5xx, so it
//    cannot create two orders by accident.
const tx = await swapzone.exchange.create({
  from,
  to,
  amountDeposit: amount,
  addressReceive: recipient,
  refundAddress: refund,
  quotaId: best.quotaId,
});

console.log(`\nOrder ${tx.id}`);
console.log(`Send ${tx.amountDeposit} ${from.toUpperCase()} to ${tx.addressDeposit}`);
if (tx.extraIdDeposit) console.log(`with memo / tag ${tx.extraIdDeposit}`);

// 3. Follow it. Ctrl+C stops watching; the order carries on regardless.
const done = await swapzone.exchange.waitFor(tx.id, {
  intervalMs: 30_000,
  onUpdate: (t) => console.log(`${new Date().toISOString()}  ${t.status}`),
});

if (done.status === "finished") {
  console.log(`Paid out ${done.amountRealReceive ?? done.amountEstimated} ${to}: ${done.payoutHash ?? done.hashReceive}`);
} else {
  console.log(`Ended as ${done.status}.`);
}
