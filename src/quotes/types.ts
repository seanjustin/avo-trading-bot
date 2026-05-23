export type Venue = 'orca' | 'jupiter';

export interface NormalizedQuote {
  venue:                Venue;
  route:                string;
  inputMint:            string;
  outputMint:           string;
  inputAmount:          bigint;
  expectedOutputAmount: bigint;
  minOutputAmount:      bigint;
  estimatedFeesBps:     number;
  priceImpactBps:       number;
  effectivePrice:       number;
  quoteTimestamp:       number;
  routeHops:            number;
  poolAddress?:         string;
  rawQuote:             unknown;
}

export interface QuoteEvent {
  quotes:     NormalizedQuote[];
  scannedAt:  number;
}

export type NormalizerResult =
  | { ok: true;  quote: NormalizedQuote }
  | { ok: false; reason: string };

export interface JupiterSwapInfo {
  ammKey:     string;
  label:      string;
  inputMint:  string;
  outputMint: string;
  inAmount:   string;
  outAmount:  string;
  feeAmount:  string;
  feeMint:    string;
}

export interface JupiterRoutePlan {
  swapInfo: JupiterSwapInfo;
  percent:  number;
}

export interface JupiterQuoteResponse {
  inputMint:            string;
  inAmount:             string;
  outputMint:           string;
  outAmount:            string;
  otherAmountThreshold: string;
  swapMode:             string;
  slippageBps:          number;
  platformFee:          { amount: string; feeBps: number } | null;
  priceImpactPct:       string;
  routePlan:            JupiterRoutePlan[];
  contextSlot:          number;
  timeTaken:            number;
}

export interface OrcaRawQuote {
  estimatedAmountIn:      string;
  estimatedAmountOut:     string;
  estimatedFeeAmount:     string;
  priceImpactPct:         string;
  aToB:                   boolean;
  amountSpecifiedIsInput: boolean;
  poolAddress:            string;
  inputMint:              string;
  outputMint:             string;
}
