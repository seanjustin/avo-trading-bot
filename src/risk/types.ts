import type { NormalizedQuote } from '../quotes/types';

export type RiskRejectCode =
  | 'KILL_SWITCH_ACTIVE'
  | 'NO_QUOTES'
  | 'MINT_NOT_ALLOWED'
  | 'PRICE_IMPACT_TOO_HIGH'
  | 'EDGE_TOO_LOW'
  | 'TRADE_TOO_LARGE'
  | 'TRADE_TOO_SMALL'
  | 'DAILY_LOSS_EXCEEDED';

export interface RiskApproval {
  ok: true;
  selectedQuote: NormalizedQuote;
  tradeAmountLamports: bigint;
}

export interface RiskRejection {
  ok: false;
  code: RiskRejectCode;
  reason: string;
}

export type RiskDecision = RiskApproval | RiskRejection;
