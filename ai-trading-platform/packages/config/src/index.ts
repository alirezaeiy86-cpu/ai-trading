import { z } from 'zod';

// =============================================================================
// ENVIRONMENT CONFIGURATION
// Validates all environment variables at startup using Zod.
// The application will refuse to start with missing/invalid config.
// =============================================================================

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection URL'),

  // Redis
  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis connection URL'),

  // Auth
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  DASHBOARD_PASSWORD: z.string().min(8, 'DASHBOARD_PASSWORD must be at least 8 characters'),

  // AI
  AI_PROVIDER: z.enum(['openai', 'anthropic', 'groq', 'ollama']).default('groq'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('llama-3.3-70b-versatile'),
  AI_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  AI_UNAVAILABLE_MODE: z.enum(['NO_TRADE', 'RULE_BASED']).default('NO_TRADE'),
  AI_MAX_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(3),
  AI_MAX_REQUESTS_PER_DAY: z.coerce.number().int().positive().default(50),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  // Exchange
  EXCHANGE_PROVIDER: z.string().default('binance'),
  EXCHANGE_API_KEY: z.string().optional(),
  EXCHANGE_API_SECRET: z.string().optional(),
  EXCHANGE_TESTNET: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),

  // Trading mode
  PAPER_TRADING: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  PAPER_INITIAL_BALANCE: z.coerce.number().positive().default(10000),
  LIVE_TRADING: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  // Risk defaults
  RISK_PER_TRADE: z.coerce.number().min(0.001).max(0.1).default(0.01),
  MIN_RISK_REWARD: z.coerce.number().min(1).default(2.0),
  MAX_DAILY_LOSS: z.coerce.number().min(0.001).max(0.5).default(0.03),
  MAX_WEEKLY_LOSS: z.coerce.number().min(0.001).max(0.5).default(0.06),
  MAX_DRAWDOWN: z.coerce.number().min(0.001).max(1).default(0.1),
  MAX_TRADES_PER_DAY: z.coerce.number().int().positive().default(5),
  MAX_OPEN_POSITIONS: z.coerce.number().int().positive().default(3),
  MAX_LEVERAGE: z.coerce.number().min(1).max(100).default(1),

  // Worker
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  WORKER_STALE_THRESHOLD_MS: z.coerce.number().int().positive().default(60000),
  MARKET_DATA_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  STRATEGY_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(300000),

  // API
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  API_CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Frontend
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:3001'),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

/**
 * Parse and validate all environment variables.
 * Throws a detailed error if any required variable is missing or invalid.
 * Call once at application startup.
 */
export function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  • ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  // Safety check: live trading requires explicit confirmation
  if (result.data.LIVE_TRADING && result.data.PAPER_TRADING) {
    throw new Error(
      'Configuration conflict: LIVE_TRADING and PAPER_TRADING cannot both be true. ' +
        'Set PAPER_TRADING=false to enable live trading.',
    );
  }

  if (result.data.LIVE_TRADING && result.data.EXCHANGE_TESTNET) {
    throw new Error(
      'Configuration conflict: LIVE_TRADING=true with EXCHANGE_TESTNET=true. ' +
        'Set EXCHANGE_TESTNET=false for real live trading.',
    );
  }

  _config = result.data;
  return _config;
}

/**
 * Get the validated configuration.
 * Must call loadConfig() first.
 */
export function getConfig(): Config {
  if (!_config) {
    throw new Error('Config not loaded. Call loadConfig() at application startup.');
  }
  return _config;
}

/**
 * Check if the application is running in paper trading mode.
 */
export function isPaperTrading(): boolean {
  return getConfig().PAPER_TRADING;
}

/**
 * Check if the application is running in production.
 */
export function isProduction(): boolean {
  return getConfig().NODE_ENV === 'production';
}
