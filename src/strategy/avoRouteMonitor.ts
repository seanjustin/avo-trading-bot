import { Config } from '../config';
import { QuoteEvent } from '../quotes/types';
import { RiskEngine } from '../risk/engine';
import { RiskApproval } from '../risk/types';
import { getLogger } from '../telemetry/logger';

export interface StrategySignal {
  decision: RiskApproval;
  event: QuoteEvent;
  isPaper: boolean;
}

export class AvoRouteMonitor {
  private config: Config;
  private risk: RiskEngine;
  private onSignal: (signal: StrategySignal) => void;
  private onReject: (code: string, reason: string) => void;
  private onRouteChange: (prev: string, next: string) => void;

  private lastVenue: string | null = null;
  private consecutiveLosses: number = 0;
  private cooldownUntil: number = 0;
  private priceHistory: Array<[number, number]> = []; // [timestamp, price]

  constructor(
    config: Config,
    risk: RiskEngine,
    onSignal: (signal: StrategySignal) => void,
    onReject: (code: string, reason: string) => void = () => undefined,
    onRouteChange: (prev: string, next: string) => void = () => undefined
  ) {
    this.config = config;
    this.risk = risk;
    this.onSignal = onSignal;
    this.onReject = onReject;
    this.onRouteChange = onRouteChange;
  }

  process(event: QuoteEvent): void {
    const now = Date.now();

    if (now < this.cooldownUntil) {
      getLogger().debug(
        { remainMs: this.cooldownUntil - now, service: 'strategy' },
        'In cooldown — skipping scan'
      );
      return;
    }

    if (event.quotes.length > 0) {
      const bestPrice = event.quotes.reduce((a, b) =>
        b.expectedOutputAmount > a.expectedOutputAmount ? b : a
      ).effectivePrice;

      this.updatePriceHistory(bestPrice, now);

      if (this.isVolatilitySpike()) {
        const cooldownMs = this.config.COOLDOWN_AFTER_SPIKE_SEC * 1000;
        this.cooldownUntil = now + cooldownMs;
        getLogger().warn(
          { cooldownMs, service: 'strategy' },
          'Volatility spike — entering cooldown'
        );
        return;
      }
    }

    const decision = this.risk.evaluate(event);

    if (!decision.ok) {
      getLogger().warn(
        { code: decision.code, reason: decision.reason, service: 'strategy' },
        'Quote rejected by risk engine'
      );
      this.onReject(decision.code, decision.reason);
      return;
    }

    const currentVenue = decision.selectedQuote.venue;
    if (this.lastVenue !== null && this.lastVenue !== currentVenue) {
      getLogger().info(
        { prev: this.lastVenue, next: currentVenue, service: 'strategy' },
        'Best venue changed'
      );
      this.onRouteChange(this.lastVenue, currentVenue);
    }
    this.lastVenue = currentVenue;

    const isPaper = this.config.PAPER_TRADING || !this.config.LIVE_TRADING;
    const signal: StrategySignal = { decision, event, isPaper };

    getLogger().info(
      {
        venue:               currentVenue,
        effectivePrice:      decision.selectedQuote.effectivePrice,
        tradeAmountLamports: decision.tradeAmountLamports.toString(),
        isPaper,
        service:             'strategy',
      },
      'Strategy signal emitted'
    );

    this.onSignal(signal);
  }

  recordFill(pnlUsdc: number): void {
    if (pnlUsdc < 0) {
      this.consecutiveLosses++;
      this.risk.recordLoss(-pnlUsdc);
      const cooldownMs = this.config.COOLDOWN_AFTER_LOSS_SEC * 1000;
      this.cooldownUntil = Date.now() + cooldownMs;
      getLogger().warn(
        {
          consecutiveLosses: this.consecutiveLosses,
          pnlUsdc,
          cooldownMs,
          service: 'strategy',
        },
        'Loss recorded — entering cooldown'
      );
      if (this.consecutiveLosses >= this.config.MAX_CONSECUTIVE_LOSSES) {
        this.risk.triggerKillSwitch(
          `${this.consecutiveLosses} consecutive losses exceeds MAX_CONSECUTIVE_LOSSES=${this.config.MAX_CONSECUTIVE_LOSSES}`
        );
      }
    } else {
      this.consecutiveLosses = 0;
    }
  }

  getConsecutiveLosses(): number {
    return this.consecutiveLosses;
  }

  private updatePriceHistory(price: number, now: number): void {
    this.priceHistory.push([now, price]);
    const cutoff = now - this.config.VOLATILITY_LOOKBACK_SEC * 1000;
    this.priceHistory = this.priceHistory.filter(([ts]) => ts >= cutoff);
  }

  private isVolatilitySpike(): boolean {
    if (this.priceHistory.length < 2) return false;
    const prices = this.priceHistory.map(([, p]) => p);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min === 0) return false;
    return (max - min) / min > this.config.MAX_VOLATILITY_THRESHOLD;
  }
}
