import { loadConfig, resetConfig } from '../src/config';
import { AVO_MINT, USDC_MINT } from '../src/config/constants';
import { TelegramNotifier } from '../src/telemetry/telegram';

// Minimal valid env — all required fields, all others use schema defaults.
const VALID_ENV: Record<string, string> = {
  AVO_MINT,
  USDC_MINT,
  SOLANA_RPC_URL:    'https://api.mainnet-beta.solana.com',
  SOLANA_KEYPAIR_PATH: './wallet/keypair.json',
};

beforeEach(() => resetConfig());

// ── Required fields ───────────────────────────────────────────────────────────

describe('required fields', () => {
  it('loads successfully with minimum valid env', () => {
    const cfg = loadConfig(VALID_ENV);
    expect(cfg.AVO_MINT).toBe(AVO_MINT);
    expect(cfg.USDC_MINT).toBe(USDC_MINT);
  });

  it('throws when AVO_MINT is missing', () => {
    const { AVO_MINT: _, ...env } = VALID_ENV;
    expect(() => loadConfig(env)).toThrow(/Config validation failed/);
  });

  it('throws when USDC_MINT is missing', () => {
    const { USDC_MINT: _, ...env } = VALID_ENV;
    expect(() => loadConfig(env)).toThrow(/Config validation failed/);
  });

  it('throws when AVO_MINT is a wrong address', () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, AVO_MINT: 'wrongAddressNotAvoMint111111111111111111111' })
    ).toThrow(/Config validation failed/);
  });

  it('throws when USDC_MINT is wrong', () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, USDC_MINT: 'wrongUsdcAddress111111111111111111111111111' })
    ).toThrow(/Config validation failed/);
  });

  it('throws when SOLANA_RPC_URL is not a valid URL', () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, SOLANA_RPC_URL: 'not-a-url' })
    ).toThrow(/Config validation failed/);
  });
});

// ── Conservative defaults ─────────────────────────────────────────────────────

describe('conservative defaults', () => {
  it('MAX_SLIPPAGE_BPS defaults to 75', () => {
    const cfg = loadConfig(VALID_ENV);
    expect(cfg.MAX_SLIPPAGE_BPS).toBe(75);
  });

  it('PAPER_TRADING defaults to true', () => {
    const cfg = loadConfig(VALID_ENV);
    expect(cfg.PAPER_TRADING).toBe(true);
  });

  it('LIVE_TRADING defaults to false', () => {
    const cfg = loadConfig(VALID_ENV);
    expect(cfg.LIVE_TRADING).toBe(false);
  });

  it('MAX_QUOTE_AGE_MS defaults to 2500', () => {
    const cfg = loadConfig(VALID_ENV);
    expect(cfg.MAX_QUOTE_AGE_MS).toBe(2500);
  });

  it('MAX_PRICE_IMPACT_BPS defaults to 100', () => {
    const cfg = loadConfig(VALID_ENV);
    expect(cfg.MAX_PRICE_IMPACT_BPS).toBe(100);
  });

  it('MIN_EXPECTED_EDGE_BPS defaults to 120', () => {
    const cfg = loadConfig(VALID_ENV);
    expect(cfg.MIN_EXPECTED_EDGE_BPS).toBe(120);
  });

  it('KILL_SWITCH_ON_STALE_DATA defaults to true', () => {
    const cfg = loadConfig(VALID_ENV);
    expect(cfg.KILL_SWITCH_ON_STALE_DATA).toBe(true);
  });

  it('KILL_SWITCH_ON_RPC_INSTABILITY defaults to true', () => {
    const cfg = loadConfig(VALID_ENV);
    expect(cfg.KILL_SWITCH_ON_RPC_INSTABILITY).toBe(true);
  });
});

// ── Numeric coercion ──────────────────────────────────────────────────────────

describe('numeric coercion', () => {
  it('parses MAX_SLIPPAGE_BPS from string to number', () => {
    const cfg = loadConfig({ ...VALID_ENV, MAX_SLIPPAGE_BPS: '50' });
    expect(typeof cfg.MAX_SLIPPAGE_BPS).toBe('number');
    expect(cfg.MAX_SLIPPAGE_BPS).toBe(50);
  });

  it('parses SCAN_INTERVAL_MS from string to number', () => {
    const cfg = loadConfig({ ...VALID_ENV, SCAN_INTERVAL_MS: '5000' });
    expect(typeof cfg.SCAN_INTERVAL_MS).toBe('number');
    expect(cfg.SCAN_INTERVAL_MS).toBe(5000);
  });
});

// ── Bool coercion ─────────────────────────────────────────────────────────────

describe('bool coercion', () => {
  it("PAPER_TRADING='false' parses to false", () => {
    const cfg = loadConfig({ ...VALID_ENV, PAPER_TRADING: 'false' });
    expect(cfg.PAPER_TRADING).toBe(false);
  });

  it("LIVE_TRADING='true' parses to true", () => {
    const cfg = loadConfig({
      ...VALID_ENV,
      PAPER_TRADING:          'false',
      LIVE_TRADING:           'true',
      LIVE_TRADING_CONFIRMED: 'true',
    });
    expect(cfg.LIVE_TRADING).toBe(true);
  });
});

// ── Log level validation ──────────────────────────────────────────────────────

describe('log level validation', () => {
  it('accepts valid log levels', () => {
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      resetConfig();
      const cfg = loadConfig({ ...VALID_ENV, LOG_LEVEL: level });
      expect(cfg.LOG_LEVEL).toBe(level);
    }
  });

  it('throws on invalid log level', () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, LOG_LEVEL: 'verbose' })
    ).toThrow(/Config validation failed/);
  });
});

// ── Live trading gate ─────────────────────────────────────────────────────────

describe('live trading gate', () => {
  it('throws when LIVE_TRADING=true without LIVE_TRADING_CONFIRMED=true', () => {
    expect(() =>
      loadConfig({
        ...VALID_ENV,
        PAPER_TRADING: 'false',
        LIVE_TRADING:  'true',
        // LIVE_TRADING_CONFIRMED not set → defaults to false
      })
    ).toThrow(/LIVE_TRADING_CONFIRMED/);
  });

  it('succeeds when both LIVE_TRADING and LIVE_TRADING_CONFIRMED are true', () => {
    const cfg = loadConfig({
      ...VALID_ENV,
      PAPER_TRADING:          'false',
      LIVE_TRADING:           'true',
      LIVE_TRADING_CONFIRMED: 'true',
    });
    expect(cfg.LIVE_TRADING).toBe(true);
    expect(cfg.LIVE_TRADING_CONFIRMED).toBe(true);
  });
});

// ── Telegram ──────────────────────────────────────────────────────────────────

describe('TelegramNotifier', () => {
  it('dry-run: does not throw when TELEGRAM_ENABLED=false with no credentials', () => {
    expect(() => new TelegramNotifier(false, '', '')).not.toThrow();
  });

  it('throws when TELEGRAM_ENABLED=true but token is missing', () => {
    expect(() => new TelegramNotifier(true, '', 'chat123')).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it('throws when TELEGRAM_ENABLED=true but chatId is missing', () => {
    expect(() => new TelegramNotifier(true, 'bot:token', '')).toThrow(/TELEGRAM_CHAT_ID/);
  });

  it('send() in dry-run mode logs instead of calling Telegram API', async () => {
    const notifier = new TelegramNotifier(false, '', '');
    await expect(notifier.fill('test fill')).resolves.toBeUndefined();
  });
});
