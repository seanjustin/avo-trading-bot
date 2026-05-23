import {
  JupiterQuoteResponse,
  NormalizedQuote,
  NormalizerResult,
  OrcaRawQuote,
  Venue,
} from './types';

export interface NormalizerOptions {
  expectedInputMint: string;
  expectedOutputMint: string;
  /** Reject quotes older than this many milliseconds */
  maxQuoteAgeMs: number;
  maxRouteHops: number;
  slippageBps: number;
  /** Decimal places of the input token (e.g. 6 for AVO/USDC) */
  inputDecimals: number;
  outputDecimals: number;
}

// ── Internal validation ───────────────────────────────────────────────────────

function validate(
  quote: NormalizedQuote,
  opts: NormalizerOptions,
  timestamp: number
): NormalizerResult {
  if (quote.inputMint !== opts.expectedInputMint) {
    return {
      ok: false,
      reason: `inputMint mismatch: expected ${opts.expectedInputMint}, got ${quote.inputMint}`,
    };
  }

  if (quote.outputMint !== opts.expectedOutputMint) {
    return {
      ok: false,
      reason: `outputMint mismatch: expected ${opts.expectedOutputMint}, got ${quote.outputMint}`,
    };
  }

  const ageMs = Date.now() - timestamp;
  if (ageMs >= opts.maxQuoteAgeMs) {
    return {
      ok: false,
      reason: `Quote too stale: age=${ageMs}ms exceeds maxQuoteAgeMs=${opts.maxQuoteAgeMs}ms`,
    };
  }

  if (quote.routeHops > opts.maxRouteHops) {
    return {
      ok: false,
      reason: `Too many route hops: ${quote.routeHops} exceeds maxRouteHops=${opts.maxRouteHops}`,
    };
  }

  if (quote.inputAmount <= 0n) {
    return { ok: false, reason: 'inputAmount must be > 0' };
  }

  if (quote.expectedOutputAmount <= 0n) {
    return { ok: false, reason: 'expectedOutputAmount must be > 0' };
  }

  return { ok: true, quote };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mintLabel(mint: string): string {
  const labels: Record<string, string> = {
    GdZ9rwHyKcriLdbSzhtEFLe5MLs7Vk6AY1aE5ei7nsmP: 'AVO',
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
    So11111111111111111111111111111111111111112: 'SOL',
  };
  return labels[mint] ?? `${mint.slice(0, 4)}…`;
}

function effectivePrice(
  outputAmount: bigint,
  inputAmount: bigint,
  inputDecimals: number,
  outputDecimals: number
): number {
  if (inputAmount === 0n) return 0;
  const decimalAdj = 10 ** (outputDecimals - inputDecimals);
  return (Number(outputAmount) / Number(inputAmount)) * decimalAdj;
}

// ── Jupiter normalizer ────────────────────────────────────────────────────────

export function fromJupiter(
  raw: JupiterQuoteResponse,
  opts: NormalizerOptions,
  timestamp: number
): NormalizerResult {
  const routeHops = raw.routePlan.length;
  const labels = raw.routePlan.map((r) => r.swapInfo.label).join(' → ');
  const route = `${mintLabel(raw.inputMint)} → ${mintLabel(raw.outputMint)} via ${labels}`;

  // priceImpactPct is a % string: "0.023" = 0.023% = 2.3 bps
  const priceImpactBps = Math.round(parseFloat(raw.priceImpactPct) * 100);

  const inAmt = BigInt(raw.inAmount);
  const outAmt = BigInt(raw.outAmount);

  // Sum fees across all hops
  const totalFees = raw.routePlan.reduce(
    (acc, r) => acc + BigInt(r.swapInfo.feeAmount),
    0n
  );
  const estimatedFeesBps =
    inAmt > 0n ? Number((totalFees * 10_000n) / inAmt) : 0;

  const quote: NormalizedQuote = {
    venue: 'jupiter' as Venue,
    route,
    inputMint: raw.inputMint,
    outputMint: raw.outputMint,
    inputAmount: inAmt,
    expectedOutputAmount: outAmt,
    minOutputAmount: BigInt(raw.otherAmountThreshold),
    estimatedFeesBps,
    priceImpactBps,
    effectivePrice: effectivePrice(outAmt, inAmt, opts.inputDecimals, opts.outputDecimals),
    quoteTimestamp: timestamp,
    routeHops,
    rawQuote: raw,
  };

  return validate(quote, opts, timestamp);
}

// ── Orca normalizer ───────────────────────────────────────────────────────────

export function fromOrca(
  raw: OrcaRawQuote,
  opts: NormalizerOptions,
  timestamp: number
): NormalizerResult {
  // priceImpactPct convention is same as Jupiter: "0.019" = 0.019% = 1.9 bps
  const priceImpactBps = Math.round(parseFloat(raw.priceImpactPct) * 100);

  const inAmt = BigInt(raw.estimatedAmountIn);
  const outAmt = BigInt(raw.estimatedAmountOut);
  const feeAmt = BigInt(raw.estimatedFeeAmount);

  const minOutputAmount =
    outAmt - (outAmt * BigInt(opts.slippageBps)) / 10_000n;

  const estimatedFeesBps =
    inAmt > 0n ? Number((feeAmt * 10_000n) / inAmt) : 0;

  const quote: NormalizedQuote = {
    venue: 'orca' as Venue,
    route: `${mintLabel(raw.inputMint)} → ${mintLabel(raw.outputMint)} via Orca Whirlpool`,
    inputMint: raw.inputMint,
    outputMint: raw.outputMint,
    inputAmount: inAmt,
    expectedOutputAmount: outAmt,
    minOutputAmount,
    estimatedFeesBps,
    priceImpactBps,
    effectivePrice: effectivePrice(outAmt, inAmt, opts.inputDecimals, opts.outputDecimals),
    quoteTimestamp: timestamp,
    routeHops: 1,
    poolAddress: raw.poolAddress,
    rawQuote: raw,
  };

  return validate(quote, opts, timestamp);
}
