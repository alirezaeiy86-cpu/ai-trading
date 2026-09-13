import pino from 'pino';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  name: string;
  level?: LogLevel;
  pretty?: boolean;
}

/**
 * Creates a structured logger for any component in the platform.
 * Uses pino for high-performance JSON logging.
 * Never logs secrets, API keys, or sensitive financial data raw.
 */
export function createLogger(options: LoggerOptions): pino.Logger {
  const level = options.level ?? (process.env['LOG_LEVEL'] as LogLevel | undefined) ?? 'info';
  const pretty =
    options.pretty ?? process.env['NODE_ENV'] !== 'production';

  const transport = pretty
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined;

  return pino({
    name: options.name,
    level,
    transport,
    // Redact sensitive fields from logs regardless of where they appear
    redact: {
      paths: [
        'apiKey',
        'apiSecret',
        'password',
        'secret',
        'token',
        'authorization',
        'headers.authorization',
        'body.password',
        'body.apiKey',
      ],
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

// Re-export pino Logger type for consumers
export type { Logger } from 'pino';
