// =============================================================================
// @trading/market-data — Public API
// =============================================================================

export { MarketDataService } from './market-data.service';
export type { MarketDataConfig } from './market-data.service';

export { createMarketDataProvider } from './provider.factory';

export { BinanceProvider }  from './providers/binance.provider';
export { MockProvider }     from './providers/mock.provider';

export type { MarketDataProvider, SymbolInfo } from './types/provider.interface';
export { MarketDataError }  from './types/provider.interface';
export type { MarketDataErrorCode } from './types/provider.interface';
