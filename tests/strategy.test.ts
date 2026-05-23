import { loadConfig, resetConfig } from '../src/config';
import { AVO_MINT, USDC_MINT } from '../src/config/constants';
import { NormalizedQuote, QuoteEvent } from '../src/quotes/types';
import { RiskEngine } from '../src/risk/engine';
import { AvoRouteMonitor, StrategySignal } from '../src/strategy/avoRouteMonitor';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_ENV: Record<string, string> = {
  AVO_MINT,
  USDC_MINT,
  SOLANA_RPC_URL:              'https://api.mainnet-beta.solana.com',
  SOLANA_KEYPAIR_PATH:         './wallet/keypair.json',
  MAX_PRICE_IMPACT_BPS:        '100',
  MIN_EXPECTED_EDGE_BPS:       '50',
  QUOTE_INPUT_AMOUNT_USDC:     '10',
  MAX_NOTIONAL_PER_TRADE_USD:  '50',
  MIN_TRADE_SIZE_USDC:         '1',
  MAX_DAILY_LOSS_USDC:         '100',
  MAX_CONSECUTIVE_LOSSES:      '3',
  COOLDOWN_AFTER_LOSS_SEC:     '180',
  COOLDOWN_AFTER_SPIKE_SEC:    '300',
  VOLATILITY_LOOKBACK_SEC:     '60',
  MAX_VOLATILITY_THRESHOLD:    '0.05',
  PAPER_TRADING:               'true',
  LIVE_TRADING:                'false',
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

function makeEvent(quotes: NormalizedQuote[]): QuoteEvent {
  return { quotes, scannedAt: Date.now() };
}

beforeEach(() => resetConfig());

// ── Signal emission ───────────────────────────────────────────────────────────

describe('signal emission', () => {
  it('emits a signal when risk approves a valid quote', () => {
    const config = loadConfig(BASE_ENV);
    const risk = new RiskEngine(config);
    const signals: StrategySignal[] = [];
    const monitor = new AvoRouteMonitor(config, risk, (s) => signals.push(s));

    monitor.process(makeEvent([makeQuote()]));

    expect(signals).toHaveLength(1);
    expect(signals[0].decision.ok).toBe(true);
    expect(signals[0].event.quotes).toHaveLength(1);
  });

  it('does NOT emit a signal when risk rejects (kill switch)', () => {
    const config = loadConfig(BASE_ENV);
    const risk = new RiskEngine(config);
    risk.triggerKillSwitch('test');
    const signals: StrategySignal[] = [];
    const monitor = new AvoRouteMonitor(config, risk, (s) => signals.push(s));

    monitor.process(makeEvent([makeQuote()]));

    expect(signals).toHaveLength(0);
  });

  it('does NOT emit a signal for an empty event', () => {
    const config = loadConfig(BASE_ENV);
    const risk = new RiskEngine(config);
    const signals: StrategySignal[] = [];
    const monitor = new AvoRouteMonitor(config, risk, (s) => signals.push(s));

    monitor.process(makeEvent([]));

    expect(signals).toHaveLength(0);
  });

  it('calls onReject with the rejection code and reason', () => {
    const config = loadConfig(BASE_ENV);
    const risk = new RiskEngine(config);
    risk.triggerKillSwitch('test');
    const rejections: Array<{ code: string; reason: string }> = [];
    const monitor = new AvoRouteMonitor(
      config, risk, () => undefined,
      (code, reason) => rejections.push({ code, reason })
    );

    monitor.process(makeEvent([makeQuote()]));

    expect(rejections).toHaveLength(1);
    expect(rejections[0].code).toBe('KILL_SWITCH_ACTIVE');
  });
});

// ── Paper trading mode ────────────────────────────────────────────────────────

describe('paper trading mode', () => {
  it('marks signal as paper when PAPER_TRADING=true', () => {
    const config = loadConfig({ ...BASE_ENV, PAPER_TRADING: 'true' });
    const risk = new RiskEngine(config);
    const signals: StrategySignal[] = [];
    const monitor = new AvoRouteMonitor(config, risk, (s) => signals.push(s));

    monitor.process(makeEvent([makeQuote()]));

    expect(signals[0].isPaper).toBe(true);
  });

  it('marks signal as paper when LIVE_TRADING=false even if PAPER_TRADING=false', () => {
    const config = loadConfig({ ...BASE_ENV, PAPER_TRADING: 'false', LIVE_TRADING: 'false' });
    const risk = new RiskEngine(config);
    const signals: StrategySignal[] = [];
    const monitor = new AvoRouteMonitor(config, risk, (s) => signals.push(s));

    monitor.process(makeEvent([makeQuote()]));

    expect(signals[0].isPaper).toBe(true);
  });

  it('marks signal as live when PAPER_TRADING=false and LIVE_TRADING=true', () => {
    const config = loadConfig({
      ...BASE_ENV,
      PAPER_TRADING:          'false',
      LIVE_TRADING:           'true',
      LIVE_TRADING_CONFIRMED: 'true',
    });
    const risk = new RiskEngine(config);
    const signals: StrategySignal[] = [];
    const monitor = new AvoRouteMonitor(config, risk, (s) => signals.push(s));

    monitor.process(makeEvent([makeQuote()]));

    expect(signals[0].isPaper).toBe(false);
  });
});

// ── Route change detection ────────────────────────────────────────────────────

describe('route change detection', () => {
  it('does NOT fire onRouteChange on the first scan', () => {
    const config = loadConfig(BASE_ENV);
    const risk = new RiskEngine(config);
    const changes: Array<[string, string]> = [];
    const monitor = new AvoRouteMonitor(
      config, risk, () => undefined, () => undefined,
      (prev, next) => changes.push([prev, next])
    );

    monitor.process(makeEvent([makeQuote({ venue: 'jupiter' })]));

    expect(changes).toHaveLength(0);
  });

  it('fires onRouteChange when the best venue changes between scans', () => {
    const config = loadConfig(BASE_ENV);
    const risk = new RiskEngine(config);
    const changes: Array<[string, string]> = [];
    const monitor = new AvoRouteMonitor(
      config, risk, () => undefined, () => undefined,
      (prev, next) => changes.push([prev, next])
    );

    monitor.process(makeEvent([makeQuote({ venue: 'jupiter' })]));
    monitor.process(makeEvent([makeQuote({ venue: 'orca' })]));

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual(['jupiter', 'orca']);
  });

  it('does NOT fire onRouteChange when the venue stays the same', () => {
    const config = loadConfig(BASE_ENV);
    const risk = new RiskEngine(config);
    const changes: Array<[string, string]> = [];
    const monitor = new AvoRouteMonitor(
      config, risk, () => undefined, () => undefined,
      (prev, next) => changes.push([prev, next])
    );

    monitor.process(makeEvent([makeQuote({ venue: 'jupiter' })]));
    monitor.process(makeEvent([makeQuote({ venue: 'jupiter' })]));

    expect(changes).toHaveLength(0);
  });
});

// ── Cooldown after loss ───────────────────────────────────────────────────────

describe('cooldown after loss', () => {
  it('suppresses signals during cooldown period after a loss', () => {
    const config = loadConfig({ ...BASE_ENV, COOLDOWN_AFTER_LOSS_SEC: '300' });
    const risk = new RiskEngine(config);
    const signals: StrategySignal[] = [];
    const monitor = new AvoRouteMonitor(config, risk, (s) => signals.push(s));

    monitor.process(makeEvent([makeQuote()]));
    monitor.recordFill(-5);
    monitor.process(makeEvent([makeQuote()]));

    expect(signals).toHaveLength(1);
  });

  it('resumes signals after cooldown expires', () => {
    const config = loadConfig({ ...BASE_ENV, COOLDOWN_AFTER_LOSS_SEC: '300' });
    const risk = new RiskEngine(config);
    const signals: StrategySignal[] = [];
    const monitor = new AvoRouteMonitor(config, risk, (s) => signals.push(s));

    monitor.process(makeEvent([makeQuote()]));
    monitor.recordFill(-5);
    (monitor as any).cooldownUntil = 0;
    monitor.process(makeEvent([makeQuote()]));

    expect(signals).toHaveLength(2);
  });

  it('a profitable fill resets the consecutive loss counter', () => {
    const config = loadConfig(BASE_ENV);
    const risk = new RiskEngine(config);
    const monitor = new AvoRouteMonitor(config, risk, () => undefined);

    monitor.recordFill(-5);
    monitor.recordFill(-5);
    expect(monitor.getConsecutiveLosses()).toBe(2);

    monitor.recordFill(3);
    expect(monitor.getConsecutiveLosses()).toBe(0);
  });
});

// ── Consecutive loss kill switch ──────────────────────────────────────────────

describe('consecutive loss kill switch', () => {
  it('triggers the kill switch after MAX_CONSECUTIVE_LOSSES losses', () => {
    const config = loadConfig({ ...BASE_ENV, MAX_CONSECUTIVE_LOSSES: '3', MAX_DAILY_LOSS_USDC: '1000' });
    const risk = new RiskEngine(config);
    const monitor = new AvoRouteMonitor(config, risk, () => undefined);

    monitor.recordFill(-5);
    monitor.recordFill(-5);
    expect(risk.isKillSwitchActive()).toBe(false);

    monitor.recordFill(-5);
    expect(risk.isKillSwitchActive()).toBe(true);
  });

  it('does NOT trigger kill switch before reaching MAX_CONSECUTIVE_LOSSES', () => {
    const config = loadConfig({ ...BASE_ENV, MAX_CONSECUTIVE_LOSSES: '3' });
    const risk = new RiskEngine(config);
    const monitor = new AvoRouteMonitor(config, risk, () => undefined);

    monitor.recordFill(-5);
    monitor.recordFill(-5);
    expect(risk.isKillSwitchActive()).toBe(false);
  });
});

// ── Volatility spike ──────────────────────────────────────────────────────────

describe('volatility spike cooldown', () => {
  it('suppresses signal when price history shows a spike above threshold', () => {
    const config = loadConfig({
      ...BASE_ENV,
      MAX_VOLATILITY_THRESHOLD: '0.05',
      VOLATILITY_LOOKBACK_SEC:  '60',
      COOLDOWN_AFTER_SPIKE_SEC: '300',
    });
    const risk = new RiskEngine(config);
    const signals: StrategySignal[] = [];
    const monitor = new AvoRouteMonitor(config, risk, (s) => signals.push(s));

    const now = Date.now();
    (monitor as any).priceHistory = [
      [now - 30_000, 0.80],
      [now - 10_000, 0.87],
    ];

    monitor.process(makeEvent([makeQuote({ effectivePrice: 0.87 })]));

    expect(signals).toHaveLength(0);
  });

  it('allows signal when price moves are within the threshold', () => {
    const config = loadConfig({
      ...BASE_ENV,
      MAX_VOLATILITY_THRESHOLD: '0.05',
      VOLATILITY_LOOKBACK_SEC:  '60',
    });
    const risk = new RiskEngine(config);
    const signals: StrategySignal[] = [];
    const monitor = new AvoRouteMonitor(config, risk, (s) => signals.push(s));

    const now = Date.now();
    (monitor as any).priceHistory = [
      [now - 30_000, 0.84],
      [now - 10_000, 0.857],
    ];

    monitor.process(makeEvent([makeQuote({ effectivePrice: 0.857 })]));

    expect(signals).toHaveLength(1);
  });
});
