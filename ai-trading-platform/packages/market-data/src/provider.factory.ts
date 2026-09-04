import type { Logger } from 'pino';
import type { Config } from '@trading/config';
import type { MarketDataProvider } from './types/provider.interface';
import { BinanceProvider } from './providers/binance.provider';
import { MockProvider } from './providers/mock.provider';

// =============================================================================
// PROVIDER FACTORY
// Reads EXCHANGE_PROVIDER from config and returns the correct implementation.
// Adding a new exchange = implement MarketDataProvider + add a case here.
// =============================================================================

export function createMarketDataProvider(
  config: Config,
  logger: Logger,
): MarketDataProvider {
  const provider = config.EXCHANGE_PROVIDER.toLowerCase();

  switch (provider) {
    case 'binance':
      return new BinanceProvider(logger, config.EXCHANGE_TESTNET);

    case 'mock':
      if (config.NODE_ENV === 'production') {
        throw new Error(
          'MockProvider cannot be used in production. Set EXCHANGE_PROVIDER to a real exchange.',
        );
      }
      return new MockProvider(logger);

    default:
      throw new Error(
        `Unknown EXCHANGE_PROVIDER: "${config.EXCHANGE_PROVIDER}". ` +
        `Supported: binance, mock`,
      );
  }
}
