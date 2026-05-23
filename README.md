# AVO Trading Bot

A conservative, paper-trading-first quote-comparison bot for the AVO token on Solana DEXes (Orca Whirlpools + Jupiter). Scans both venues simultaneously, selects the best price, applies a full risk-engine approval flow, and executes (or simulates) the swap. Structured JSON logs and optional Telegram alerts are included.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18 LTS or later |
| npm | 9+ |
| Solana wallet JSON | 64-byte keypair array (paper mode: any valid file) |

```bash
npm install
npm run build   # or: npx tsc --noEmit  (type-check only)
npm test        # all 104 tests must pass before live use
```

---

## Configuration

Copy `.env.example` to `.env` and fill in the values. All settings are validated at startup via Zod.

```dotenv
# ── Solana ────────────────────────────────────────────────────────────────────
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_KEYPAIR_PATH=./wallet/keypair.json

# ── Mints (do not change — validated as exact literals) ──────────────────────
AVO_MINT=GdZ9rwHyKcriLdbSzhtEFLe5MLs7Vk6AY1aE5ei7nsmP
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# ── Quote settings ────────────────────────────────────────────────────────────
QUOTE_INPUT_AMOUNT_USDC=10        # size of each scan (in USDC equiv)
MAX_QUOTE_AGE_MS=2500             # reject quotes older than this
MAX_ROUTE_HOPS=3                  # max Jupiter route hops accepted
SLIPPAGE_BPS=75                   # slippage tolerance applied to Orca quotes

# ── Risk limits ───────────────────────────────────────────────────────────────
MAX_PRICE_IMPACT_BPS=100          # max allowed price impact
MIN_EXPECTED_EDGE_BPS=50          # min edge between best and second-best venue
MAX_NOTIONAL_PER_TRADE_USD=50     # hard cap per trade
MIN_TRADE_SIZE_USDC=1             # floor per trade
MAX_DAILY_LOSS_USDC=100           # resets at UTC midnight

# ── Strategy / cooldowns ──────────────────────────────────────────────────────
MAX_CONSECUTIVE_LOSSES=3          # kill switch threshold
COOLDOWN_AFTER_LOSS_SEC=180       # pause after a losing fill
COOLDOWN_AFTER_SPIKE_SEC=300      # pause after a volatility spike
VOLATILITY_LOOKBACK_SEC=60        # window for spike detection
MAX_VOLATILITY_THRESHOLD=0.05     # 5% move triggers spike cooldown

# ── Scan interval ─────────────────────────────────────────────────────────────
SCAN_INTERVAL_MS=5000
RPC_HEALTH_INTERVAL_MS=15000

# ── RPC health ────────────────────────────────────────────────────────────────
MAX_RPC_FAILURES=3                # consecutive failures before kill switch
KILL_SWITCH_ON_RPC_INSTABILITY=true

# ── Trading mode (paper is default and safe) ──────────────────────────────────
PAPER_TRADING=true
LIVE_TRADING=false
LIVE_TRADING_CONFIRMED=false      # must also be true to enable live

# ── Telegram (optional) ───────────────────────────────────────────────────────
TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# ── Logging ───────────────────────────────────────────────────────────────────
LOG_LEVEL=info                    # trace | debug | info | warn | error | fatal
LOG_JSON=true                     # false = pretty-print for local dev
```

---

## Running

### Paper mode (default — no funds at risk)

```bash
npm start
# or directly:
npx ts-node src/main.ts
```

All fills are simulated; a 10-minute rolling summary is logged. No wallet interaction occurs.

### Live mode (two-confirmation gate)

Set **all three** flags in `.env`:

```dotenv
PAPER_TRADING=false
LIVE_TRADING=true
LIVE_TRADING_CONFIRMED=true
```

The bot validates these at startup and refuses to start if any combination would allow accidental live trades. Live execution submits real transactions via Jupiter V6 `/swap`. **Only Jupiter-quoted trades are supported live in this release** (Orca live swap = Phase 7).

---

## Architecture

```
QuoteScanner
  ├── OrcaScanner   ─┐
  └── JupiterScanner ┘
           │ QuoteEvent (normalized, validated)
           ▼
     AvoRouteMonitor (strategy)
       ├── volatility spike check
       ├── cooldown gate
       └── RiskEngine.evaluate()
                 │ RiskApproval
                 ▼
             Executor
               ├── paper → PaperLedger → summary log
               └── live  → LiveExecutor → Jupiter /swap
                               │ fill
                               ▼
                    TelegramNotifier (optional)
```

**RpcHealthMonitor** runs independently on a configurable interval, probing `getSlot()`. After `MAX_RPC_FAILURES` consecutive failures it triggers the global kill switch.

---

## Safety features

| Feature | Default | Notes |
|---|---|---|
| Paper-trading default | `PAPER_TRADING=true` | No funds moved unless explicitly unlocked |
| Exact mint validation | Zod `z.literal()` | Wrong mint = startup rejection |
| Stale-quote rejection | 2 500 ms | `>=` check so `MAX_QUOTE_AGE_MS=0` always rejects |
| Price-impact guard | 100 bps | Per-quote check before approval |
| Two-venue edge check | 50 bps | Skipped when only one venue responds |
| Trade size bounds | 1–50 USDC | Configurable min/max |
| Daily loss limit | 100 USDC | Resets at UTC midnight |
| Consecutive-loss kill switch | 3 losses | Permanently halts until manual reset |
| Volatility spike cooldown | 5 % / 60 s | 5-minute pause after spike |
| RPC health kill switch | 3 failures | Halts trading on node instability |
| Live double-confirmation | Two separate env flags | Prevents accidental live mode |

---

## Test suite

```
npm test
```

104 tests across 6 suites (config, quotes, risk, strategy, execution, rpcHealth). All Solana SDK imports are mocked in unit tests — no network calls, no wallet required to run tests.

---

## Project structure

```
src/
  config/          schema.ts · constants.ts · index.ts
  quotes/          types.ts · normalizer.ts
  scanner/         index.ts · jupiterScanner.ts · orcaScanner.ts
  risk/            engine.ts · types.ts
  strategy/        avoRouteMonitor.ts
  execution/       executor.ts · paperLedger.ts · liveExecutor.ts · types.ts
  infra/           rpcHealth.ts
  telemetry/       logger.ts · telegram.ts
  main.ts
tests/
  config.test.ts · quotes.test.ts · risk.test.ts
  strategy.test.ts · execution.test.ts · rpcHealth.test.ts
mocks/
  jupiterQuote.json · orcaQuote.json
```
