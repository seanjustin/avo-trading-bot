import { config as loadDotenv } from 'dotenv';
import { configSchema, Config, CONFIG_NOTE } from './schema';

let _config: Config | null = null;

/**
 * Validate and load configuration.
 *
 * @param env - Source object. Defaults to process.env; tests pass an explicit
 *   object so they don't pollute the global environment.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  loadDotenv({ override: false }); // load .env without overriding already-set vars

  const result = configSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  [${i.path.join('.')}] ${i.message}`)
      .join('\n');
    throw new Error(`Config validation failed:\n${issues}\n\nNote: ${CONFIG_NOTE}`);
  }

  if (result.data.LIVE_TRADING && !result.data.PAPER_TRADING) {
    if (!result.data.LIVE_TRADING_CONFIRMED) {
      throw new Error(
        'LIVE_TRADING=true requires LIVE_TRADING_CONFIRMED=true as a second confirmation.'
      );
    }
  }

  _config = result.data;
  return _config;
}

export function getConfig(): Config {
  if (!_config) {
    throw new Error('Config not loaded — call loadConfig() before accessing config.');
  }
  return _config;
}

/** Reset singleton — for use in tests only. */
export function resetConfig(): void {
  _config = null;
}

export type { Config };
