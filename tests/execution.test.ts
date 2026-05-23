jest.mock('../src/execution/liveExecutor', () => ({
  LiveExecutor: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockRejectedValue(new Error('Live execution not supported for this venue')),
  })),
}));

import { loadConfig, resetConfig } from '../src/config';
import { AVO_MINT, AVO_DECIMALS, USDC_MINT, USDC_DECIMALS } from '../src/config/constants';
import { NormalizedQuote, QuoteEvent } from '../src/quotes/types';
import { RiskEngine } from '../src/risk/engine';
import { RiskApproval } from '../src/risk/types';
import { AvoRouteMonitor, StrategySignal } from '../src/strategy/avoRouteMonitor';
import { PaperLedger } from '../src/execution/paperLedger';
import { Executor } from '../src/execution/executor';
import { TelegramNotifier } from '../src/telemetry/telegram';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_ENV: Record<string, string> = {
  AVO_MINT,
  USDC_MINT,
  SOLANA_RPC_URL:             'https://api.mainnet-beta.solana.com',
  SOLANA_KEYPAIR_PATH:        './wallet/keypair.json',
  MAX_PRICE_IMPACT_BPS:       '100',
  MIN_EXPECTED_EDGE_BPS:      '50',
  QUOTE_INPUT_AMOUNT_USDC:    '10',
  MAX_NOTIONAL_PER_TRADE_USD: '50',
  MIN_TRADE_SIZE_USDC:        '1',
  MAX_DAILY_LOSS_USDC:        '100',
  MAX_CONSECUTIVE_LOSSES:     '3',
  COOLDOWN_AFTER_LOSS_SEC:    '180',
  COOLDOWN_AFTER_SPIKE_SEC:   '300',
  VOLATILITY_LOOKBACK_SEC:    '60',
  MAX_VOLATILITY_THRESHOLD:   '0.05',
  PAPER_TRADING:              'true',
  LIVE_TRADING:               'false',
  TELEGRAM_ENABLED:           'false',
  TELEGRAM_BOT_TOKEN:         '',
  TELEGRAM_CHAT_ID:           '',
};

function makeQuote(overrides: Partial<NormalizedQuote> = {}): NormalizedQuote {
  return {
    venue:                'jupiter',
    route:                'AVO → USDC via Jupiter',
    inputMint:            AVO_MINT,
    outputMint:           USDC_MINT,
    inputAmount:          10_000_000n,
    expectedOutputAmount: 8_400_000n,
    minOutputAmount:      8_337_000n,
    estimatedFeesBps:     25,
    priceImpactBps:       2,
    effectivePrice:       0.84,
    quoteTimestamp:       Date.now(),
    routeHops:            1,
    rawQuote:             {},
    ...overrides,
  };
}

function makeApproval(quote: NormalizedQuote, config: ReturnType<typeof loadConfig>): RiskApproval {
  return {
    ok:                  true,
    selectedQuote:       quote,
    tradeAmountLamports: BigInt(Math.round(config.QUOTE_INPUT_AMOUNT_USDC * 10 ** AVO_DECIMALS)),
  };
}

function makeSignal(approval: RiskApproval, isPaper = true): StrategySignal {
  return {
    decision: approval,
    event:    { quotes: [approval.selectedQuote], scannedAt: Date.now() },
    isPaper,
  };
}

function makeTelegram(config: ReturnType<typeof loadConfig>): TelegramNotifier {
  return new TelegramNotifier(
    config.TELEGRAM_ENABLED,
    config.TELEGRAM_BOT_TOKEN,
    config.TELEGRAM_CHAT_ID
  );
}

beforeEach(() => resetConfig());

// ── PaperLedger ───────────────────────────────────────────────────────────────

describe('PaperLedger', () => {
  it('record() returns a fill with correct fields', () => {
    const config = loadConfig(BASE_ENV);
    const ledger = new PaperLedger();
    const quote  = makeQuote();
    const signal = makeSignal(makeApproval(quote, config));

    const fill = ledger.record(signal);

    expect(fill.fillId).toBe('paper-1');
    expect(fill.venue).toBe('jupiter');
    expect(fill.route).toBe('AVO → USDC via Jupiter');
    expect(fill.inputAmountLamports).toBe(BigInt(10 * 10 ** AVO_DECIMALS));
    expect(fill.outputAmountLamports).toBe(8_400_000n);
    expect(fill.effectivePrice).toBe(0.84);
    expect(fill.estimatedFeesBps).toBe(25);
    expect(fill.outputUsdc).toBeCloseTo(8_400_000 / 10 ** USDC_DECIMALS, 6);
  });

  it('fill IDs increment with each record() call', () => {
    const config = loadConfig(BASE_ENV);
    const ledger = new PaperLedger();
    const signal = makeSignal(makeApproval(makeQuote(), config));

    expect(ledger.record(signal).fillId).toBe('paper-1');
    expect(ledger.record(signal).fillId).toBe('paper-2');
    expect(ledger.record(signal).fillId).toBe('paper-3');
  });

  it('getSummary() aggregates correctly across multiple fills', () => {
    const config = loadConfig(BASE_ENV);
    const ledger = new PaperLedger();

    const q1 = makeQuote({ expectedOutputAmount: 8_400_000n });
    const q2 = makeQuote({ expectedOutputAmount: 8_200_000n, venue: 'orca' });

    ledger.record(makeSignal(makeApproval(q1, config)));
    ledger.record(makeSignal(makeApproval(q2, config)));

    const summary = ledger.getSummary();
    expect(summary.totalFills).toBe(2);
    expect(summary.totalInputLamports).toBe(BigInt(2 * 10 * 10 ** AVO_DECIMALS));
    expect(summary.totalOutputUsdc).toBeCloseTo(
      (8_400_000 + 8_200_000) / 10 ** USDC_DECIMALS,
      4
    );
  });

  it('getSummary() returns zeros for an empty ledger', () => {
    const ledger = new PaperLedger();
    const summary = ledger.getSummary();
    expect(summary.totalFills).toBe(0);
    expect(summary.totalInputLamports).toBe(0n);
    expect(summary.totalOutputUsdc).toBe(0);
  });

  it('getFills() returns all recorded fills in order', () => {
    const config = loadConfig(BASE_ENV);
    const ledger = new PaperLedger();
    ledger.record(makeSignal(makeApproval(makeQuote(), config)));
    ledger.record(makeSignal(makeApproval(makeQuote({ venue: 'orca' }), config)));

    const fills = ledger.getFills();
    expect(fills).toHaveLength(2);
    expect(fills[0].venue).toBe('jupiter');
    expect(fills[1].venue).toBe('orca');
  });
});

// ── Executor (paper mode) ─────────────────────────────────────────────────────

describe('Executor (paper mode)', () => {
  it('execute() records a fill in the ledger', async () => {
    const config   = loadConfig(BASE_ENV);
    const ledger   = new PaperLedger();
    const telegram = makeTelegram(config);
    const executor = new Executor(config, ledger, telegram);

    await executor.execute(makeSignal(makeApproval(makeQuote(), config), true));

    expect(ledger.getSummary().totalFills).toBe(1);
  });

  it('execute() calls onFill with the USDC output amount', async () => {
    const config   = loadConfig(BASE_ENV);
    const ledger   = new PaperLedger();
    const telegram = makeTelegram(config);
    const received: number[] = [];
    const executor = new Executor(config, ledger, telegram, (usdc) => received.push(usdc));

    await executor.execute(makeSignal(makeApproval(makeQuote({ expectedOutputAmount: 8_400_000n }), config), true));

    expect(received).toHaveLength(1);
    expect(received[0]).toBeCloseTo(8.4, 4);
  });

  it('execute() records fills from different venues correctly', async () => {
    const config   = loadConfig(BASE_ENV);
    const ledger   = new PaperLedger();
    const telegram = makeTelegram(config);
    const executor = new Executor(config, ledger, telegram);

    await executor.execute(makeSignal(makeApproval(makeQuote({ venue: 'jupiter' }), config), true));
    await executor.execute(makeSignal(makeApproval(makeQuote({ venue: 'orca'    }), config), true));

    const fills = ledger.getFills();
    expect(fills[0].venue).toBe('jupiter');
    expect(fills[1].venue).toBe('orca');
  });

  it('execute() throws when signal is live (Phase 6 not yet implemented for Orca)', async () => {
    const config   = loadConfig(BASE_ENV);
    const ledger   = new PaperLedger();
    const telegram = makeTelegram(config);
    const executor = new Executor(config, ledger, telegram);

    // Live orca quote — liveExecutor will throw "only supports Jupiter"
    const orcaQuote = makeQuote({ venue: 'orca' });
    const liveSignal = makeSignal(makeApproval(orcaQuote, config), false);
    await expect(executor.execute(liveSignal)).rejects.toThrow();
  });
});

// ── Full pipeline integration ─────────────────────────────────────────────────

describe('end-to-end pipeline (scanner → strategy → executor → ledger)', () => {
  it('a valid QuoteEvent flows through to a paper fill', async () => {
    const config   = loadConfig(BASE_ENV);
    const risk     = new RiskEngine(config);
    const ledger   = new PaperLedger();
    const telegram = makeTelegram(config);

    let strategy: AvoRouteMonitor;
    const executor = new Executor(config, ledger, telegram, (usdc) => strategy.recordFill(usdc));

    const signals: StrategySignal[] = [];
    strategy = new AvoRouteMonitor(
      config, risk,
      (sig) => { signals.push(sig); void executor.execute(sig); }
    );

    strategy.process({ quotes: [makeQuote()], scannedAt: Date.now() });

    await new Promise((r) => setTimeout(r, 50));

    expect(signals).toHaveLength(1);
    expect(ledger.getSummary().totalFills).toBe(1);
    expect(ledger.getSummary().totalOutputUsdc).toBeCloseTo(8.4, 3);
  });

  it('onFill keeps consecutiveLosses at 0 after a successful paper fill', async () => {
    const config   = loadConfig(BASE_ENV);
    const risk     = new RiskEngine(config);
    const ledger   = new PaperLedger();
    const telegram = makeTelegram(config);

    let strategy: AvoRouteMonitor;
    const executor = new Executor(config, ledger, telegram, (usdc) => strategy.recordFill(usdc));

    strategy = new AvoRouteMonitor(config, risk, (sig) => void executor.execute(sig));

    strategy.process({ quotes: [makeQuote()], scannedAt: Date.now() });
    await new Promise((r) => setTimeout(r, 50));

    expect(strategy.getConsecutiveLosses()).toBe(0);
  });
});
