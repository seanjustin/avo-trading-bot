import pino from 'pino';

let _logger: pino.Logger = pino({ level: 'info' });

export function initLogger(level: string, json: boolean): void {
  _logger = pino({
    level,
    transport: json
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true } },
  });
}

export function getLogger(): pino.Logger {
  return _logger;
}
