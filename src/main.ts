import { loadConfig } from './config';
import { initLogger, getLogger } from './telemetry/logger';
import { TelegramNotifier } from './telemetry/telegram';
import { RiskEngine } from './risk/engine';
import { AvoRouteMonitor } from './strategy/avoRouteMonitor';
import { PaperLedger } from './execution/paperLedger';
import { Executor } from './execution/executor';
import { QuoteScanner } from './scanner';
import { RpcHealthMonitor } from './infra/rpcHealth';
import { Connection } from '@solana/web3.js';

async function main(): Promise<void> {
  const config = loadConfig();
  initLogger(config.LOG_LEVEL, config.JSON_LOGGING);
  const log = getLogger();

  log.info({ service: 'main', paperTrading: config.PAPER_TRADING }, 'AVO bot starting');

  const telegram = new TelegramNotifier(
    config.TELEGRAM_ENABLED,
    config.TELEGRAM_BOT_TOKEN,
    config.TELEGRAM_CHAT_ID
  );

  const risk    = new RiskEngine(config);
  const ledger  = new PaperLedger();
  const conn    = new Connection(config.SOLANA_RPC_URL, 'confirmed');
  const rpcMon  = new RpcHealthMonitor(config, risk, () => conn.getSlot());

  // strategy declared before executor so the onFill closure can reference it
  let strategy: AvoRouteMonitor;

  const executor = new Executor(
    config,
    ledger,
    telegram,
    (outputUsdc) => strategy.recordFill(outputUsdc)
  );

  strategy = new AvoRouteMonitor(
    config,
    risk,
    (signal) => void executor.execute(signal).catch((err: Error) => {
      log.error({ err, service: 'executor' }, 'Execution error');
      void telegram.failure(`Execution error: ${err.message}`);
    }),
    (code, reason) => log.warn({ code, reason, service: 'strategy' }, 'Risk rejection'),
    (prev, next) => void telegram.routeChange(`Best venue: ${prev} → ${next}`, { prev, next })
  );

  const scanner = new QuoteScanner(
    config,
    (event) => strategy.process(event),
    (err, venue) => {
      log.error({ err, venue, service: 'scanner' }, 'Scanner error');
      if (config.KILL_SWITCH_ON_RPC_INSTABILITY) {
        risk.triggerKillSwitch(`Scanner error on ${venue}: ${err.message}`);
        void telegram.killSwitch(`Kill switch: RPC failure on ${venue}`);
      }
    }
  );

  const summaryTimer = setInterval(() => executor.logSummary(), 10 * 60 * 1000);

  function shutdown(signal: string): void {
    log.info({ signal, service: 'main' }, 'Shutting down');
    scanner.stop();
    rpcMon.stop();
    clearInterval(summaryTimer);
    executor.logSummary();
    process.exit(0);
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  rpcMon.start();
  scanner.start();
}

main().catch((err: Error) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err.message);
  process.exit(1);
});
