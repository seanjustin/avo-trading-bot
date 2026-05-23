import { Config } from '../config';
import { AVO_DECIMALS, AVO_MINT, USDC_DECIMALS, USDC_MINT } from '../config/constants';
import { fromJupiter, fromOrca, NormalizerOptions } from '../quotes/normalizer';
import { NormalizedQuote, QuoteEvent } from '../quotes/types';
import { getLogger } from '../telemetry/logger';
import { JupiterScanner } from './jupiterScanner';
import { OrcaScanner } from './orcaScanner';

export { JupiterScanner, OrcaScanner };

export class QuoteScanner {
  private orca: OrcaScanner;
  private jupiter: JupiterScanner;
  private config: Config;
  private normOpts: NormalizerOptions;
  private onQuote: (event: QuoteEvent) => void;
  private onError: (err: Error, venue: string) => void;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: Config,
    onQuote: (event: QuoteEvent) => void,
    onError: (err: Error, venue: string) => void = () => undefined,
    // Allow injection for testing
    orca?: OrcaScanner,
    jupiter?: JupiterScanner
  ) {
    this.config  = config;
    this.onQuote = onQuote;
    this.onError = onError;
    this.orca    = orca    ?? new OrcaScanner(config);
    this.jupiter = jupiter ?? new JupiterScanner(config);
    this.normOpts = {
      expectedInputMint:  AVO_MINT,
      expectedOutputMint: USDC_MINT,
      maxQuoteAgeMs:      config.MAX_QUOTE_AGE_MS,
      maxRouteHops:       config.MAX_ROUTE_HOPS,
      slippageBps:        config.MAX_SLIPPAGE_BPS,
      inputDecimals:      AVO_DECIMALS,
      outputDecimals:     USDC_DECIMALS,
    };
  }

  start(): void {
    getLogger().info({ intervalMs: this.config.SCAN_INTERVAL_MS, service: 'scanner' }, 'Scanner started');
    void this.scan(); // immediate first tick
    this.timer = setInterval(() => void this.scan(), this.config.SCAN_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    getLogger().info({ service: 'scanner' }, 'Scanner stopped');
  }

  /** Run a single scan cycle. Returns the QuoteEvent (useful in tests). */
  async scan(): Promise<QuoteEvent> {
    const inputAmount = Math.round(this.config.QUOTE_INPUT_AMOUNT_USDC * 10 ** AVO_DECIMALS);
    const now = Date.now();

    const [orcaResult, jupiterResult] = await Promise.allSettled([
      this.orca.getQuote(inputAmount),
      this.jupiter.getQuote(inputAmount),
    ]);

    const quotes: NormalizedQuote[] = [];

    // Orca
    if (orcaResult.status === 'fulfilled' && orcaResult.value !== null) {
      const r = fromOrca(orcaResult.value, this.normOpts, now);
      if (r.ok) {
        quotes.push(r.quote);
      } else {
        getLogger().warn({ reason: r.reason, venue: 'orca' }, 'Orca quote rejected');
      }
    } else if (orcaResult.status === 'rejected') {
      getLogger().warn({ err: orcaResult.reason, venue: 'orca' }, 'Orca fetch threw');
      this.onError(orcaResult.reason as Error, 'orca');
    }

    // Jupiter
    if (jupiterResult.status === 'fulfilled' && jupiterResult.value !== null) {
      const r = fromJupiter(jupiterResult.value, this.normOpts, now);
      if (r.ok) {
        quotes.push(r.quote);
      } else {
        getLogger().warn({ reason: r.reason, venue: 'jupiter' }, 'Jupiter quote rejected');
      }
    } else if (jupiterResult.status === 'rejected') {
      getLogger().warn({ err: jupiterResult.reason, venue: 'jupiter' }, 'Jupiter fetch threw');
      this.onError(jupiterResult.reason as Error, 'jupiter');
    }

    const event: QuoteEvent = { quotes, scannedAt: now };

    getLogger().debug(
      {
        quotesAccepted: quotes.length,
        venues: quotes.map((q) => q.venue),
        prices: quotes.map((q) => q.effectivePrice.toFixed(6)),
        service: 'scanner',
      },
      'Scan complete'
    );

    if (quotes.length > 0) {
      this.onQuote(event);
    }

    return event;
  }
}
