export interface PaperFill {
  fillId: string;
  venue: string;
  route: string;
  inputAmountLamports: bigint;
  outputAmountLamports: bigint;
  effectivePrice: number;
  estimatedFeesBps: number;
  filledAt: number;
  /** outputAmountLamports / 10^USDC_DECIMALS — USDC received */
  outputUsdc: number;
}

export interface LedgerSummary {
  totalFills: number;
  totalInputLamports: bigint;
  totalOutputUsdc: number;
}
