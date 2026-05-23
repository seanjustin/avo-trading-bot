import { USDC_DECIMALS } from '../config/constants';
import { StrategySignal } from '../strategy/avoRouteMonitor';
import { LedgerSummary, PaperFill } from './types';
import { getLogger } from '../telemetry/logger';

export class PaperLedger {
  private fills: PaperFill[] = [];
  private fillCount = 0;

  record(signal: StrategySignal): PaperFill {
    const { selectedQuote: q, tradeAmountLamports } = signal.decision;

    const fill: PaperFill = {
      fillId:               `paper-${++this.fillCount}`,
      venue:                q.venue,
      route:                q.route,
      inputAmountLamports:  tradeAmountLamports,
      outputAmountLamports: q.expectedOutputAmount,
      effectivePrice:       q.effectivePrice,
      estimatedFeesBps:     q.estimatedFeesBps,
      filledAt:             Date.now(),
      outputUsdc:           Number(q.expectedOutputAmount) / 10 ** USDC_DECIMALS,
    };

    this.fills.push(fill);

    getLogger().info(
      {
        fillId:        fill.fillId,
        venue:         fill.venue,
        outputUsdc:    fill.outputUsdc.toFixed(4),
        effectivePrice: fill.effectivePrice.toFixed(6),
        service:       'ledger',
      },
      'Paper fill recorded'
    );

    return fill;
  }

  getSummary(): LedgerSummary {
    return {
      totalFills:         this.fills.length,
      totalInputLamports: this.fills.reduce((s, f) => s + f.inputAmountLamports, 0n),
      totalOutputUsdc:    this.fills.reduce((s, f) => s + f.outputUsdc, 0),
    };
  }

  getFills(): readonly PaperFill[] {
    return this.fills;
  }
}
