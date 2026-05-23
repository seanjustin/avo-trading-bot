import { loadConfig, resetConfig } from '../src/config';
import { AVO_MINT, USDC_MINT } from '../src/config/constants';
import { NormalizedQuote, QuoteEvent } from '../src/quotes/types';
import { RiskEngine } from '../src/risk/engine';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_ENV: Record<string, string> = {
  AVO_MINT,
  USDC_MINT,
  SOLANA_RPC_URL:           'https://api.mainnet-beta.solana.com',
  SOLANA_KEYPAIR_PATH:      './wallet/keypair.json',
  MAX_PRICE_IMPACT_BPS:     '100',
  MIN_EXPECTED_EDGE_BPS:    '50',
  QUOTE_INPUT_AMOUNT_USDC:  '10',
  MAX_NOTIONAL_PER_TRADE_USD: '50',
  MIN_TRADE_SIZE_USDC:      '1',
  MAX_DAILY_LOSS_USDC:      '100',
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

// ── Kill switch ───────────────────────────────────────────────────────────────

describe('kill switch', () => {
  it('blocks trades when kill switch is active', () => {
    const config = loadConfig(BASE_ENV);
    const engine = new RiskEngine(config);
    engine.triggerKillSwitch('RPC instability detected');

    const decision = engine.evaluate(makeEvent([makeQuote()]));
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe('KILL_SWITCH_ACTIVE');
      expect(decision.reason).toMatch(/RPC instability/);
    }
  });

  it('approves trades after kill switch is reset', () => {
    const config = loadConfig(BASE_ENV);
    const engine = new RiskEngine(config);
    engine.triggerKillSwitch('test');
    engine.resetKillSwitch();

    const decision = engine.evaluate(makeEvent([makeQuote()]));
    expect(decision.ok).toBe(true);
  });

  it('isKillSwitchActive reflects current state', () => {
    const config = loadConfig(BASE_ENV);
    const engine = new RiskEngine(config);
    expect(engine.isKillSwitchActive()).toBe(false);
    engine.triggerKillSwitch('test');
    expect(engine.isKillSwitchActive()).toBe(true);
    engine.resetKillSwitch();
    expect(engine.isKillSwitchActive()).toBe(false);
  });
});

// ── Quote presence ────────────────────────────────────────────────────────────

describe('quote presence', () => {
  it('rejects with NO_QUOTES when event has no quotes', () => {
    const config = loadConfig(BASE_ENV);
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(makeEvent([]));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('NO_QUOTES');
  });
});

// ── Mint allowlist ────────────────────────────────────────────────────────────

describe('mint allowlist', () => {
  it('rejects when inputMint is not AVO', () => {
    const config = loadConfig(BASE_ENV);
    const engine = new RiskEngine(config);
    const bad = makeQuote({ inputMint: 'wrongMint111111111111111111111111111111111' });
    const decision = engine.evaluate(makeEvent([bad]));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('MINT_NOT_ALLOWED');
  });

  it('rejects when outputMint is not USDC', () => {
    const config = loadConfig(BASE_ENV);
    const engine = new RiskEngine(config);
    const bad = makeQuote({ outputMint: 'wrongMint111111111111111111111111111111111' });
    const decision = engine.evaluate(makeEvent([bad]));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('MINT_NOT_ALLOWED');
  });
});

// ── Price impact ──────────────────────────────────────────────────────────────

describe('price impact guard', () => {
  it('rejects when priceImpactBps exceeds limit', () => {
    const config = loadConfig({ ...BASE_ENV, MAX_PRICE_IMPACT_BPS: '50' });
    const engine = new RiskEngine(config);
    const highImpact = makeQuote({ priceImpactBps: 51 });
    const decision = engine.evaluate(makeEvent([highImpact]));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('PRICE_IMPACT_TOO_HIGH');
  });

  it('approves when priceImpactBps equals limit', () => {
    const config = loadConfig({ ...BASE_ENV, MAX_PRICE_IMPACT_BPS: '50' });
    const engine = new RiskEngine(config);
    const exactImpact = makeQuote({ priceImpactBps: 50 });
    const decision = engine.evaluate(makeEvent([exactImpact]));
    expect(decision.ok).toBe(true);
  });
});

// ── Minimum edge ──────────────────────────────────────────────────────────────

describe('minimum edge (two-venue comparison)', () => {
  const bestQ  = makeQuote({ venue: 'jupiter', expectedOutputAmount: 8_400_000n });
  const worstQ = makeQuote({ venue: 'orca',    expectedOutputAmount: 8_000_000n });

  it('rejects when edge between venues is below MIN_EXPECTED_EDGE_BPS', () => {
    const config = loadConfig({ ...BASE_ENV, MIN_EXPECTED_EDGE_BPS: '50' });
    const engine = new RiskEngine(config);
    const close = makeQuote({ venue: 'orca', expectedOutputAmount: 8_370_000n });
    const decision = engine.evaluate(makeEvent([bestQ, close]));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('EDGE_TOO_LOW');
  });

  it('approves when edge meets MIN_EXPECTED_EDGE_BPS', () => {
    const config = loadConfig({ ...BASE_ENV, MIN_EXPECTED_EDGE_BPS: '50' });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(makeEvent([bestQ, worstQ]));
    expect(decision.ok).toBe(true);
  });

  it('skips edge check when only one venue is present', () => {
    const config = loadConfig({ ...BASE_ENV, MIN_EXPECTED_EDGE_BPS: '500' });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(makeEvent([bestQ]));
    expect(decision.ok).toBe(true);
  });
});

// ── Trade size ────────────────────────────────────────────────────────────────

describe('trade size guards', () => {
  it('rejects when QUOTE_INPUT_AMOUNT_USDC exceeds MAX_NOTIONAL_PER_TRADE_USD', () => {
    const config = loadConfig({
      ...BASE_ENV,
      QUOTE_INPUT_AMOUNT_USDC:    '100',
      MAX_NOTIONAL_PER_TRADE_USD: '50',
    });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(makeEvent([makeQuote()]));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('TRADE_TOO_LARGE');
  });

  it('rejects when QUOTE_INPUT_AMOUNT_USDC is below MIN_TRADE_SIZE_USDC', () => {
    const config = loadConfig({
      ...BASE_ENV,
      QUOTE_INPUT_AMOUNT_USDC: '0.5',
      MIN_TRADE_SIZE_USDC:     '1',
    });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(makeEvent([makeQuote()]));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('TRADE_TOO_SMALL');
  });

  it('approves when trade size is within bounds', () => {
    const config = loadConfig({
      ...BASE_ENV,
      QUOTE_INPUT_AMOUNT_USDC:    '10',
      MIN_TRADE_SIZE_USDC:        '1',
      MAX_NOTIONAL_PER_TRADE_USD: '50',
    });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(makeEvent([makeQuote()]));
    expect(decision.ok).toBe(true);
  });
});

// ── Daily loss limit ──────────────────────────────────────────────────────────

describe('daily loss limit', () => {
  it('rejects when daily loss equals or exceeds MAX_DAILY_LOSS_USDC', () => {
    const config = loadConfig({ ...BASE_ENV, MAX_DAILY_LOSS_USDC: '50' });
    const engine = new RiskEngine(config);
    engine.recordLoss(50);
    const decision = engine.evaluate(makeEvent([makeQuote()]));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('DAILY_LOSS_EXCEEDED');
  });

  it('approves when daily loss is below MAX_DAILY_LOSS_USDC', () => {
    const config = loadConfig({ ...BASE_ENV, MAX_DAILY_LOSS_USDC: '100' });
    const engine = new RiskEngine(config);
    engine.recordLoss(49.99);
    const decision = engine.evaluate(makeEvent([makeQuote()]));
    expect(decision.ok).toBe(true);
  });

  it('accumulates loss across multiple recordLoss calls', () => {
    const config = loadConfig({ ...BASE_ENV, MAX_DAILY_LOSS_USDC: '50' });
    const engine = new RiskEngine(config);
    engine.recordLoss(25);
    engine.recordLoss(25);
    expect(engine.getDailyLoss()).toBeCloseTo(50);
    const decision = engine.evaluate(makeEvent([makeQuote()]));
    expect(decision.ok).toBe(false);
  });

  it('resets daily loss when the UTC date changes', () => {
    const config = loadConfig({ ...BASE_ENV, MAX_DAILY_LOSS_USDC: '50' });
    const engine = new RiskEngine(config);
    engine.recordLoss(50);
    (engine as any).dailyResetDate = '2000-01-01';
    const decision = engine.evaluate(makeEvent([makeQuote()]));
    expect(engine.getDailyLoss()).toBe(0);
    expect(decision.ok).toBe(true);
  });
});

// ── Best quote selection ──────────────────────────────────────────────────────

describe('best quote selection', () => {
  it('selects the quote with the highest expectedOutputAmount', () => {
    const config = loadConfig(BASE_ENV);
    const engine = new RiskEngine(config);

    const low  = makeQuote({ venue: 'orca',    expectedOutputAmount: 8_000_000n });
    const high = makeQuote({ venue: 'jupiter', expectedOutputAmount: 8_400_000n });
    const decision = engine.evaluate(makeEvent([low, high]));

    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.selectedQuote.venue).toBe('jupiter');
      expect(decision.selectedQuote.expectedOutputAmount).toBe(8_400_000n);
    }
  });

  it('computes tradeAmountLamports from QUOTE_INPUT_AMOUNT_USDC', () => {
    const config = loadConfig({ ...BASE_ENV, QUOTE_INPUT_AMOUNT_USDC: '10' });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(makeEvent([makeQuote()]));
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.tradeAmountLamports).toBe(BigInt(10 * 10 ** 6));
    }
  });
});
