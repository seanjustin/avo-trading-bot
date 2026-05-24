import { z } from 'zod';
import { AVO_MINT, USDC_MINT } from './constants';

// Helpers for coercing string env vars to the right types.
const numStr = (def: number) =>
  z.string().optional().default(String(def)).transform(Number);

const boolStr = (def: boolean) =>
  z.string().optional().default(String(def)).transform((v) => v === 'true');

export const configSchema = z.object({
  // ── Token identity ────────────────────────────────────────────────────────
  // z.literal enforces the exact mint address — no ticker-only matching.
  AVO_MINT:  z.literal(AVO_MINT),
  USDC_MINT: z.literal(USDC_MINT),

  // ── Trading mode ──────────────────────────────────────────────────────────
  PAPER_TRADING:        boolStr(true),   // default: paper only
  LIVE_TRADING:         boolStr(false),  // must be set explicitly
  LIVE_TRADING_CONFIRMED: boolStr(false), // second confirmation gate

  // ── Execution protection ──────────────────────────────────────────────────
  MAX_SLIPPAGE_BPS:     numStr(75),    // 0.75% max slippage
  MAX_PRICE_IMPACT_BPS: numStr(100),   // 1% max price impact
  MAX_QUOTE_AGE_MS:     numStr(2500),  // reject quotes older than 2.5 s
  MIN_EXPECTED_EDGE_BPS: numStr(120),  // minimum edge to trade
  MAX_ROUTE_HOPS:       numStr(3),     // refuse quotes with more hops

  // ── Position sizing ───────────────────────────────────────────────────────
  MAX_NOTIONAL_PER_TRADE_USD:         numStr(50),
  MIN_TRADE_SIZE_USDC:                numStr(1),
  MAX_DAILY_LOSS_USDC:                numStr(50),
  MAX_POSITION_NOTIONAL_USD:          numStr(200),
  MAX_DAILY_VOLUME_USD:               numStr(500),
  MAX_OPEN_POSITION_UNITS:            numStr(2),
  MAX_CONSECUTIVE_LOSSES:             numStr(3),
  MAX_TRADE_AS_PERCENT_OF_2PCT_DEPTH: numStr(20), // % of pool 2% depth

  // ── Liquidity floor ───────────────────────────────────────────────────────
  MIN_POOL_LIQUIDITY_USD: numStr(5000),

  // ── Market state controls ─────────────────────────────────────────────────
  VOLATILITY_LOOKBACK_SEC:  numStr(60),
  MAX_VOLATILITY_THRESHOLD: numStr(0.05), // 5% price move in lookback window
  COOLDOWN_AFTER_SPIKE_SEC: numStr(300),
  COOLDOWN_AFTER_LOSS_SEC:  numStr(180),

  // ── Infrastructure kill switches ──────────────────────────────────────────
  MAX_RPC_FAILURES:              numStr(3),
  MAX_QUOTE_FAILURES:            numStr(5),
  HEARTBEAT_TIMEOUT_MS:          numStr(10_000),
  KILL_SWITCH_ON_STALE_DATA:     boolStr(true),
  KILL_SWITCH_ON_RPC_INSTABILITY: boolStr(true),

  // ── Scanner ───────────────────────────────────────────────────────────────
  SCAN_INTERVAL_MS:         numStr(3000),
  QUOTE_INPUT_AMOUNT_USDC:  numStr(10), // USDC notional per quote request

  // ── Solana connection ─────────────────────────────────────────────────────
  SOLANA_RPC_URL:     z.string().url().default('https://api.mainnet-beta.solana.com'),
  SOLANA_KEYPAIR_PATH: z.string().default('./wallet/keypair.json'),

  // ── Telegram ──────────────────────────────────────────────────────────────
  TELEGRAM_ENABLED:   boolStr(false),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_CHAT_ID:   z.string().optional().default(''),

  // ── Dashboard ─────────────────────────────────────────────────────────────
  DASHBOARD_PORT: numStr(3000),

  // ── Logging ───────────────────────────────────────────────────────────────
  LOG_LEVEL:    z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  JSON_LOGGING: boolStr(true),
});

export type Config = z.infer<typeof configSchema>;

// Human-readable note — these values are deliberately conservative for
// thin-liquidity DEX trading and should only be tightened after paper-trade
// logs demonstrate consistent, clean fills.
export const CONFIG_NOTE =
  'Conservative defaults for thin-liquidity Solana DEX trading. ' +
  'Do not loosen guardrails without evidence from paper-trade logs.';
