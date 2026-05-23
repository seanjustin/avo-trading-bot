import { Config } from '../config';
import { TelegramNotifier } from '../telemetry/telegram';
import { StrategySignal } from '../strategy/avoRouteMonitor';
import { PaperLedger } from './paperLedger';
import { LiveExecutor } from './liveExecutor';
import { getLogger } from '../telemetry/logger';

export class Executor {
  private live: LiveExecutor | null = null;

  constructor(
    private config: Config,
    private ledger: PaperLedger,
    private telegram: TelegramNotifier,
    /** Called after every fill with the USDC amount received (positive = success). */
    private onFill: (outputUsdc: number) => void = () => undefined
  ) {}

  async execute(signal: StrategySignal): Promise<void> {
    if (signal.isPaper) {
      await this.executePaper(signal);
    } else {
      await this.executeLive(signal);
    }
  }

  private async executePaper(signal: StrategySignal): Promise<void> {
    const fill = this.ledger.record(signal);
    this.onFill(fill.outputUsdc);
    void this.telegram.fill(
      `Paper fill: ${fill.venue} @ ${fill.effectivePrice.toFixed(6)} — received ${fill.outputUsdc.toFixed(4)} USDC`,
      {
        fillId:         fill.fillId,
        route:          fill.route,
        effectivePrice: fill.effectivePrice,
        outputUsdc:     fill.outputUsdc,
        feeBps:         fill.estimatedFeesBps,
      }
    );
  }

  private async executeLive(signal: StrategySignal): Promise<void> {
    if (!this.live) {
      this.live = new LiveExecutor(this.config);
    }
    const q = signal.decision.selectedQuote;
    try {
      const sig = await this.live.execute(signal);
      const outputUsdc = Number(q.expectedOutputAmount) / 1e6;
      this.onFill(outputUsdc);
      void this.telegram.fill(
        `Live fill: ${q.venue} @ ${q.effectivePrice.toFixed(6)} — received ${outputUsdc.toFixed(4)} USDC`,
        { sig, venue: q.venue, outputUsdc, effectivePrice: q.effectivePrice }
      );
    } catch (err) {
      getLogger().error({ err, venue: q.venue, service: 'executor' }, 'Live execution failed');
      this.onFill(-1); // signal a loss to the strategy
      void this.telegram.failure(
        `Live execution failed on ${q.venue}: ${(err as Error).message}`
      );
      throw err;
    }
  }

  /** Convenience: log the current paper ledger summary. */
  logSummary(): void {
    const s = this.ledger.getSummary();
    getLogger().info(
      {
        totalFills:      s.totalFills,
        totalOutputUsdc: s.totalOutputUsdc.toFixed(4),
        service:         'ledger',
      },
      'Paper ledger summary'
    );
  }
}
