import type { Candle, Ticker, Timeframe } from '@trading/types';

// =============================================================================
// MARKET DATA PROVIDER INTERFACE
// All exchange integrations must implement this interface.
// The rest of the system never depends on a concrete provider.
//
// Implementations:
//   BinanceProvider   — Binance REST + WebSocket (Phase 4)
//   PaperProvider     — wraps a real provider, adds paper-trading context
//   MockProvider      — deterministic data for tests
// =============================================================================

export interface MarketDataProvider {
  readonly name: string;

  /**
   * Connect to the exchange and start streaming.
   * Must be idempotent — safe to call multiple times.
   */
  connect(): Promise<void>;

  /**
   * Disconnect cleanly (close WebSocket, cancel timers).
   */
  disconnect(): Promise<void>;

  /**
   * Returns true if the connection is active and data is fresh.
   */
  isHealthy(): boolean;

  /**
   * Fetch the latest ticker (price, bid, ask, 24h volume).
   * Must throw if data is stale or unavailable.
   */
  getTicker(symbol: string): Promise<Ticker>;

  /**
   * Fetch historical candles in ascending order (oldest first).
   * @param limit - max candles to return (provider may cap this)
   */
  getCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]>;

  /**
   * Subscribe to live candle updates for a symbol/timeframe.
   * The callback is called whenever a candle is updated or closed.
   * Returns an unsubscribe function.
   */
  subscribeToCandles(
    symbol: string,
    timeframe: Timeframe,
    onCandle: (candle: Candle) => void,
    onError: (err: Error) => void,
  ): () => void;

  /**
   * Get the most recent price for a symbol.
   * Lightweight alternative to getTicker when only price is needed.
   */
  getCurrentPrice(symbol: string): Promise<number>;

  /**
   * Exchange info for a symbol (min order size, tick size, etc.)
   */
  getSymbolInfo(symbol: string): Promise<SymbolInfo>;
}

export interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  minOrderSize: number;
  tickSize: number;      // price precision
  stepSize: number;      // quantity precision
  minNotional: number;   // minimum order value in quote currency
}

// =============================================================================
// PROVIDER ERRORS
// =============================================================================

export class MarketDataError extends Error {
  constructor(
    message: string,
    public readonly code: MarketDataErrorCode,
    public readonly provider: string,
    public readonly retryable: boolean = true,
  ) {
    super(message);
    this.name = 'MarketDataError';
  }
}

export type MarketDataErrorCode =
  | 'RATE_LIMIT'
  | 'INVALID_SYMBOL'
  | 'STALE_DATA'
  | 'CONNECTION_FAILED'
  | 'PARSE_ERROR'
  | 'TIMEOUT'
  | 'UNAVAILABLE';
