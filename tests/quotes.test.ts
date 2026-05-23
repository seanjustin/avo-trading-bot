// Mock Solana/Orca modules before any imports so the SDK is never loaded
// during unit tests. The scanner tests inject their own mock instances via
// the QuoteScanner constructor anyway.
jest.mock('../src/scanner/orcaScanner', () => ({
  OrcaScanner: jest.fn().mockImplementation(() => ({ getQuote: jest.fn() })),
}));
jest.mock('../src/scanner/jupiterScanner', () => ({
  JupiterScanner: jest.fn().mockImplementation(() => ({ getQuote: jest.fn() })),
}));

import { fromJupiter, fromOrca, NormalizerOptions } from '../src/quotes/normalizer';
import { JupiterQuoteResponse, OrcaRawQuote } from '../src/quotes/types';
import { AVO_MINT, USDC_MINT } from '../src/config/constants';
import { loadConfig, resetConfig } from '../src/config';
import { QuoteScanner } from '../src/scanner';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const jupiterFixture: JupiterQuoteResponse = require('../mocks/jupiterQuote.json');
const orcaFixture: OrcaRawQuote = require('../mocks/orcaQuote.json');

const OPTS: NormalizerOptions = {
  expectedInputMint:  AVO_MINT,
  expectedOutputMint: USDC_MINT,
  maxQuoteAgeMs:      2_500,
  maxRouteHops:       3,
  slippageBps:        75,
  inputDecimals:      6,
  outputDecimals:     6,
};

// ── Jupiter normalizer ────────────────────────────────────────────────────────

describe('Jupiter normalizer', () => {
  it('normalizes a valid quote into NormalizedQuote shape', () => {
    const ts = Date.now();
    const result = fromJupiter(jupiterFixture, OPTS, ts);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { quote } = result;
    expect(quote.venue).toBe('jupiter');
    expect(quote.inputMint).toBe(AVO_MINT);
    expect(quote.outputMint).toBe(USDC_MINT);
    expect(typeof quote.route).toBe('string');
    expect(quote.route.length).toBeGreaterThan(0);
    expect(typeof quote.inputAmount).toBe('bigint');
    expect(typeof quote.expectedOutputAmount).toBe('bigint');
    expect(typeof quote.minOutputAmount).toBe('bigint');
    expect(typeof quote.estimatedFeesBps).toBe('number');
    expect(typeof quote.priceImpactBps).toBe('number');
    expect(typeof quote.effectivePrice).toBe('number');
    expect(quote.effectivePrice).toBeGreaterThan(0);
    expect(typeof quote.routeHops).toBe('number');
    expect(quote.routeHops).toBe(jupiterFixture.routePlan.length);
    expect(quote.quoteTimestamp).toBe(ts);
    expect(quote.rawQuote).toBeDefined();
  });

  it('computes priceImpactBps from priceImpactPct string', () => {
    const ts = Date.now();
    // fixture priceImpactPct = "0.023" → 0.023% → 2.3 bps → rounds to 2
    const result = fromJupiter(jupiterFixture, OPTS, ts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.quote.priceImpactBps).toBe(2);
  });

  it('minOutputAmount matches otherAmountThreshold from API', () => {
    const ts = Date.now();
    const result = fromJupiter(jupiterFixture, OPTS, ts);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quote.minOutputAmount).toBe(
        BigInt(jupiterFixture.otherAmountThreshold)
      );
    }
  });

  it('rejects a quote with wrong inputMint', () => {
    const ts = Date.now();
    const bad = { ...jupiterFixture, inputMint: 'wrongMint111111111111111111111111111111111' };
    const result = fromJupiter(bad, OPTS, ts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/inputMint mismatch/);
  });

  it('rejects a quote with wrong outputMint', () => {
    const ts = Date.now();
    const bad = { ...jupiterFixture, outputMint: 'wrongMint111111111111111111111111111111111' };
    const result = fromJupiter(bad, OPTS, ts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/outputMint mismatch/);
  });

  it('rejects a stale quote (age > maxQuoteAgeMs)', () => {
    const staleTs = Date.now() - 5_000; // 5 s ago; max is 2.5 s
    const result = fromJupiter(jupiterFixture, OPTS, staleTs);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/stale/i);
  });

  it('accepts a quote just within the staleness window', () => {
    const freshTs = Date.now() - 2_000; // 2 s ago < 2.5 s max
    const result = fromJupiter(jupiterFixture, OPTS, freshTs);
    expect(result.ok).toBe(true);
  });

  it('rejects a quote with too many route hops', () => {
    const ts = Date.now();
    const hop = jupiterFixture.routePlan[0];
    const tooMany = { ...jupiterFixture, routePlan: [hop, hop, hop, hop] }; // 4 > 3
    const result = fromJupiter(tooMany, OPTS, ts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/hops/i);
  });

  it('accepts a quote with exactly maxRouteHops hops', () => {
    const ts = Date.now();
    const hop = jupiterFixture.routePlan[0];
    const exact = { ...jupiterFixture, routePlan: [hop, hop, hop] }; // 3 === max
    const result = fromJupiter(exact, OPTS, ts);
    expect(result.ok).toBe(true);
  });
});

// ── Orca normalizer ───────────────────────────────────────────────────────────

describe('Orca normalizer', () => {
  it('normalizes a valid Orca quote', () => {
    const ts = Date.now();
    const result = fromOrca(orcaFixture, OPTS, ts);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { quote } = result;
    expect(quote.venue).toBe('orca');
    expect(quote.inputMint).toBe(AVO_MINT);
    expect(quote.outputMint).toBe(USDC_MINT);
    expect(quote.routeHops).toBe(1);
    expect(quote.poolAddress).toBe(orcaFixture.poolAddress);
    expect(quote.effectivePrice).toBeGreaterThan(0);
    expect(typeof quote.inputAmount).toBe('bigint');
    expect(typeof quote.expectedOutputAmount).toBe('bigint');
    expect(typeof quote.minOutputAmount).toBe('bigint');
  });

  it('computes minOutputAmount by applying slippage to expectedOutput', () => {
    const ts = Date.now();
    const result = fromOrca(orcaFixture, OPTS, ts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { quote } = result;
    const expectedMin =
      quote.expectedOutputAmount -
      (quote.expectedOutputAmount * BigInt(OPTS.slippageBps)) / 10_000n;
    expect(quote.minOutputAmount).toBe(expectedMin);
  });

  it('rejects a quote with wrong inputMint', () => {
    const ts = Date.now();
    const bad = { ...orcaFixture, inputMint: 'wrongMint111111111111111111111111111111111' };
    const result = fromOrca(bad, OPTS, ts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/inputMint mismatch/);
  });

  it('rejects a stale Orca quote', () => {
    const staleTs = Date.now() - 5_000;
    const result = fromOrca(orcaFixture, OPTS, staleTs);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/stale/i);
  });
});

// ── Schema consistency ────────────────────────────────────────────────────────

describe('schema consistency between venues', () => {
  const REQUIRED_FIELDS: (keyof import('../src/quotes/types').NormalizedQuote)[] = [
    'venue', 'route', 'inputMint', 'outputMint',
    'inputAmount', 'expectedOutputAmount', 'minOutputAmount',
    'estimatedFeesBps', 'priceImpactBps', 'effectivePrice',
    'quoteTimestamp', 'routeHops', 'rawQuote',
  ];

  it('both venues expose all required fields', () => {
    const ts = Date.now();
    const jup = fromJupiter(jupiterFixture, OPTS, ts);
    const orc = fromOrca(orcaFixture, OPTS, ts);
    expect(jup.ok).toBe(true);
    expect(orc.ok).toBe(true);
    if (!jup.ok || !orc.ok) return;

    for (const field of REQUIRED_FIELDS) {
      expect(jup.quote).toHaveProperty(field);
      expect(orc.quote).toHaveProperty(field);
    }
  });

  it('bigint fields are bigint in both venues', () => {
    const ts = Date.now();
    const jup = fromJupiter(jupiterFixture, OPTS, ts);
    const orc = fromOrca(orcaFixture, OPTS, ts);
    if (!jup.ok || !orc.ok) return;

    for (const f of ['inputAmount', 'expectedOutputAmount', 'minOutputAmount'] as const) {
      expect(typeof jup.quote[f]).toBe('bigint');
      expect(typeof orc.quote[f]).toBe('bigint');
    }
  });

  it('number fields are number in both venues', () => {
    const ts = Date.now();
    const jup = fromJupiter(jupiterFixture, OPTS, ts);
    const orc = fromOrca(orcaFixture, OPTS, ts);
    if (!jup.ok || !orc.ok) return;

    for (const f of ['estimatedFeesBps', 'priceImpactBps', 'effectivePrice', 'routeHops'] as const) {
      expect(typeof jup.quote[f]).toBe('number');
      expect(typeof orc.quote[f]).toBe('number');
    }
  });
});

// ── QuoteScanner ─────────────────────────────────────────────────────────────

describe('QuoteScanner', () => {
  const VALID_ENV: Record<string, string> = {
    AVO_MINT,
    USDC_MINT,
    SOLANA_RPC_URL:      'https://api.mainnet-beta.solana.com',
    SOLANA_KEYPAIR_PATH: './wallet/keypair.json',
  };

  beforeEach(() => resetConfig());

  it('emits a QuoteEvent when both venues return valid quotes', async () => {
    const config = loadConfig(VALID_ENV);
    const mockOrca    = { getQuote: jest.fn().mockResolvedValue(orcaFixture) };
    const mockJupiter = { getQuote: jest.fn().mockResolvedValue(jupiterFixture) };

    const received: import('../src/quotes/types').QuoteEvent[] = [];
    const scanner = new QuoteScanner(
      config, (ev) => received.push(ev), () => undefined,
      mockOrca as any, mockJupiter as any
    );

    await scanner.scan();

    expect(received).toHaveLength(1);
    expect(received[0].quotes).toHaveLength(2);
    expect(received[0].quotes.map((q) => q.venue).sort()).toEqual(['jupiter', 'orca']);
  });

  it('emits a QuoteEvent with only the valid venue when one returns null', async () => {
    const config = loadConfig(VALID_ENV);
    const mockOrca    = { getQuote: jest.fn().mockResolvedValue(null) };
    const mockJupiter = { getQuote: jest.fn().mockResolvedValue(jupiterFixture) };

    const received: import('../src/quotes/types').QuoteEvent[] = [];
    const scanner = new QuoteScanner(
      config, (ev) => received.push(ev), () => undefined,
      mockOrca as any, mockJupiter as any
    );

    await scanner.scan();

    expect(received).toHaveLength(1);
    expect(received[0].quotes).toHaveLength(1);
    expect(received[0].quotes[0].venue).toBe('jupiter');
  });

  it('does NOT emit when all venues return null', async () => {
    const config = loadConfig(VALID_ENV);
    const mockOrca    = { getQuote: jest.fn().mockResolvedValue(null) };
    const mockJupiter = { getQuote: jest.fn().mockResolvedValue(null) };

    const received: import('../src/quotes/types').QuoteEvent[] = [];
    const scanner = new QuoteScanner(
      config, (ev) => received.push(ev), () => undefined,
      mockOrca as any, mockJupiter as any
    );

    await scanner.scan();

    expect(received).toHaveLength(0);
  });

  it('calls onError when a venue throws', async () => {
    const config = loadConfig(VALID_ENV);
    const mockOrca    = { getQuote: jest.fn().mockRejectedValue(new Error('rpc error')) };
    const mockJupiter = { getQuote: jest.fn().mockResolvedValue(jupiterFixture) };

    const errors: string[] = [];
    const scanner = new QuoteScanner(
      config, () => undefined, (_err, venue) => errors.push(venue),
      mockOrca as any, mockJupiter as any
    );

    await scanner.scan();

    expect(errors).toContain('orca');
  });

  it('rejects stale quotes before emitting (MAX_QUOTE_AGE_MS=0)', async () => {
    const config = loadConfig({ ...VALID_ENV, MAX_QUOTE_AGE_MS: '0' });
    const mockOrca    = { getQuote: jest.fn().mockResolvedValue(orcaFixture) };
    const mockJupiter = { getQuote: jest.fn().mockResolvedValue(jupiterFixture) };

    const received: import('../src/quotes/types').QuoteEvent[] = [];
    const scanner = new QuoteScanner(
      config, (ev) => received.push(ev), () => undefined,
      mockOrca as any, mockJupiter as any
    );

    await scanner.scan();

    // All quotes must be rejected as stale
    expect(received).toHaveLength(0);
  });
});
