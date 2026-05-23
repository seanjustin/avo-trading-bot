import TelegramBot from 'node-telegram-bot-api';
import { getLogger } from './logger';

export enum AlertType {
  FILL            = 'FILL',
  FAILURE         = 'FAILURE',
  KILL_SWITCH     = 'KILL_SWITCH',
  SLIPPAGE_BREACH = 'SLIPPAGE_BREACH',
  ROUTE_CHANGE    = 'ROUTE_CHANGE',
}

const ALERT_EMOJI: Record<AlertType, string> = {
  [AlertType.FILL]:            '✅',
  [AlertType.FAILURE]:         '❌',
  [AlertType.KILL_SWITCH]:     '🛑',
  [AlertType.SLIPPAGE_BREACH]: '⚠️',
  [AlertType.ROUTE_CHANGE]:    '🔀',
};

export interface AlertPayload {
  type:    AlertType;
  message: string;
  details?: Record<string, unknown>;
}

export class TelegramNotifier {
  private bot: TelegramBot | null = null;
  private chatId: string;
  private enabled: boolean;

  constructor(enabled: boolean, token: string, chatId: string) {
    this.enabled = enabled;
    this.chatId  = chatId;

    if (enabled) {
      if (!token || !chatId) {
        throw new Error(
          'TELEGRAM_ENABLED=true requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to be set.'
        );
      }
      // polling: false — we only send, never receive commands
      this.bot = new TelegramBot(token, { polling: false });
    }
  }

  async send(payload: AlertPayload): Promise<void> {
    const { type, message, details } = payload;
    const emoji   = ALERT_EMOJI[type];
    const detailStr = details
      ? '\n```\n' + JSON.stringify(details, null, 2) + '\n```'
      : '';
    const text = `${emoji} *${type}*\n${message}${detailStr}`;

    const structuredLog = { alert: type, message, details };

    if (!this.enabled || !this.bot) {
      getLogger().info(structuredLog, 'Telegram alert (dry-run — TELEGRAM_ENABLED=false)');
      return;
    }

    try {
      await this.bot.sendMessage(this.chatId, text, { parse_mode: 'Markdown' });
      getLogger().debug(structuredLog, 'Telegram alert sent');
    } catch (err) {
      getLogger().warn({ err, ...structuredLog }, 'Telegram send failed');
      // Non-fatal: a Telegram failure must never take down the main loop.
    }
  }

  /** Convenience wrappers */
  fill(message: string, details?: Record<string, unknown>) {
    return this.send({ type: AlertType.FILL, message, details });
  }
  failure(message: string, details?: Record<string, unknown>) {
    return this.send({ type: AlertType.FAILURE, message, details });
  }
  killSwitch(message: string, details?: Record<string, unknown>) {
    return this.send({ type: AlertType.KILL_SWITCH, message, details });
  }
  slippageBreach(message: string, details?: Record<string, unknown>) {
    return this.send({ type: AlertType.SLIPPAGE_BREACH, message, details });
  }
  routeChange(message: string, details?: Record<string, unknown>) {
    return this.send({ type: AlertType.ROUTE_CHANGE, message, details });
  }
}
