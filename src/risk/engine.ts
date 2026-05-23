import { Config } from '../config';
import { AVO_DECIMALS, AVO_MINT, USDC_MINT } from '../config/constants';
import { QuoteEvent } from '../quotes/types';
import { RiskDecision, RiskRejection } from './types';
import { getLogger } from '../telemetry/logger';

export class RiskEngine {
  private config: Config;
  private dailyLossUsdc: number = 0;
  private dailyResetDate: string;
  private killSwitchActive: boolean = false;
  private killSwitchReason: string = '';

  constructor(config: Config) {
    this.config = config;
    this.dailyResetDate = utcDateString();
  }

  evaluate(event: QuoteEvent): RiskDecision {
    this.checkDailyReset();

    if (this.killSwitchActive) {
      return reject('KILL_SWITCH_ACTIVE', `Kill switch active: ${this.killSwitchReason}`);
    }

    if (event.quotes.length === 0) {
      return reject('NO_QUOTES', 'No valid quotes in event');
    }

    for (const q of event.quotes) {
      if (q.inputMint !== AVO_MINT || q.outputMint !== USDC_MINT) {
        return reject(
          'MINT_NOT_ALLOWED',
          `Unexpected mints: ${q.inputMint} → ${q.outputMint}`
        );
      }
    }

    const best = event.quotes.reduce((a, b) =>
      b.expectedOutputAmount > a.expectedOutputAmount ? b : a
    );

    if (best.priceImpactBps > this.config.MAX_PRICE_IMPACT_BPS) {
      return reject(
        'PRICE_IMPACT_TOO_HIGH',
        `priceImpactBps=${best.priceImpactBps} exceeds MAX_PRICE_IMPACT_BPS=${this.config.MAX_PRICE_IMPACT_BPS}`
      );
    }

    if (event.quotes.length >= 2) {
      const worst = event.quotes.reduce((a, b) =>
        b.expectedOutputAmount < a.expectedOutputAmount ? b : a
      );
      const edgeBps = Number(
        ((best.expectedOutputAmount - worst.expectedOutputAmount) * 10_000n) /
          worst.expectedOutputAmount
      );
      if (edgeBps < this.config.MIN_EXPECTED_EDGE_BPS) {
        return reject(
          'EDGE_TOO_LOW',
          `edgeBps=${edgeBps} below MIN_EXPECTED_EDGE_BPS=${this.config.MIN_EXPECTED_EDGE_BPS}`
        );
      }
    }

    const tradeUsdc = this.config.QUOTE_INPUT_AMOUNT_USDC;
    if (tradeUsdc > this.config.MAX_NOTIONAL_PER_TRADE_USD) {
      return reject(
        'TRADE_TOO_LARGE',
        `tradeSize=${tradeUsdc} USDC exceeds MAX_NOTIONAL_PER_TRADE_USD=${this.config.MAX_NOTIONAL_PER_TRADE_USD}`
      );
    }
    if (tradeUsdc < this.config.MIN_TRADE_SIZE_USDC) {
      return reject(
        'TRADE_TOO_SMALL',
        `tradeSize=${tradeUsdc} USDC below MIN_TRADE_SIZE_USDC=${this.config.MIN_TRADE_SIZE_USDC}`
      );
    }

    if (this.dailyLossUsdc >= this.config.MAX_DAILY_LOSS_USDC) {
      return reject(
        'DAILY_LOSS_EXCEEDED',
        `dailyLoss=${this.dailyLossUsdc.toFixed(2)} USDC reached MAX_DAILY_LOSS_USDC=${this.config.MAX_DAILY_LOSS_USDC}`
      );
    }

    const tradeAmountLamports = BigInt(
      Math.round(tradeUsdc * 10 ** AVO_DECIMALS)
    );

    return { ok: true, selectedQuote: best, tradeAmountLamports };
  }

  triggerKillSwitch(reason: string): void {
    this.killSwitchActive = true;
    this.killSwitchReason = reason;
    getLogger().error({ reason, service: 'risk' }, 'Kill switch triggered');
  }

  resetKillSwitch(): void {
    this.killSwitchActive = false;
    this.killSwitchReason = '';
    getLogger().info({ service: 'risk' }, 'Kill switch reset');
  }

  isKillSwitchActive(): boolean {
    return this.killSwitchActive;
  }

  recordLoss(usdcLoss: number): void {
    this.checkDailyReset();
    this.dailyLossUsdc += usdcLoss;
    getLogger().warn(
      { dailyLossUsdc: this.dailyLossUsdc, newLoss: usdcLoss, service: 'risk' },
      'Daily loss updated'
    );
  }

  getDailyLoss(): number {
    return this.dailyLossUsdc;
  }

  private checkDailyReset(): void {
    const today = utcDateString();
    if (today !== this.dailyResetDate) {
      this.dailyLossUsdc = 0;
      this.dailyResetDate = today;
      getLogger().info({ date: today, service: 'risk' }, 'Daily loss counter reset');
    }
  }
}

function reject(code: RiskRejection['code'], reason: string): RiskRejection {
  return { ok: false, code, reason };
}

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}
