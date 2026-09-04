import type { Logger } from 'pino';
import type { Candle, Ticker, Timeframe } from '@trading/types';
import {
  type MarketDataProvider,
  type SymbolInfo,
} from '../types/provider.interface';

// =============================================================================
// MOCK MARKET DATA PROVIDER
// Generates deterministic synthetic data.
// Used for: unit tests, offline development, CI/CD pipelines.
// Never used in production — the factory rejects it if NODE_ENV=production.
// =============================================================================

const MOCK_SYMBOLS: Record<string, { base: string; quote: string; price: number }> = {
  BTCUSDT: { base: 'BTC', quote: 'USDT', price: 65000 },
  ETHUSDT: { base: 'ETH', quote: 'USDT', price: 3500  },
};

export class MockProvider implements MarketDataProvider {
  readonly name = 'mock';
  private _healthy = true;
  private subscriptions = new Set<NodeJS.Timeout>();

  constructor(private readonly logger: Logger) {
    logger.warn('MockProvider active — synthetic data only, not suitable for production');
  }

  async connect(): Promise<void> {
    this._healthy = true;
    this.logger.info('MockProvider connected');
  }

  async disconnect(): Promise<void> {
    for (const t of this.subscriptions) clearInterval(t);
    this.subscriptions.clear();
    this._healthy = false;
    this.logger.info('MockProvider disconnected');
  }

  isHealthy(): boolean {
    return this._healthy;
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const info = MOCK_SYMBOLS[symbol];
    if (!info) throw new Error(`Mock: unknown symbol ${symbol}`);
    const price = this.jitter(info.price, 0.001);
    return {
      symbol,
      price,
      bid: price - 1,
      ask: price + 1,
      spread: 2,
      volume24h: 50000 + Math.random() * 5000,
      change24h: this.jitter(0, 0.02) * info.price,
      changePercent24h: this.jitter(0, 2),
      timestamp: new Date(),
    };
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    const info = MOCK_SYMBOLS[symbol];
    if (!info) throw new Error(`Mock: unknown symbol ${symbol}`);
    return this.jitter(info.price, 0.001);
  }

  async getCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const info = MOCK_SYMBOLS[symbol];
    if (!info) throw new Error(`Mock: unknown symbol ${symbol}`);

    const ms = timeframeToMs(timeframe);
    const now = Date.now();
    const candles: Candle[] = [];
    let price = info.price;

    for (let i = limit - 1; i >= 0; i--) {
      const openTime  = new Date(now - i * ms);
      const closeTime = new Date(now - i * ms + ms - 1);
      const open  = price;
      const close = this.jitter(price, 0.005);
      const high  = Math.max(open, close) * (1 + Math.random() * 0.003);
      const low   = Math.min(open, close) * (1 - Math.random() * 0.003);
      candles.push({
        symbol, timeframe, openTime, closeTime,
        open, high, low, close,
        volume: 100 + Math.random() * 50,
        isClosed: true,
      });
      price = close;
    }
    return candles;
  }

  subscribeToCandles(
    symbol: string,
    timeframe: Timeframe,
    onCandle: (candle: Candle) => void,
    _onError: (err: Error) => void,
  ): () => void {
    const info = MOCK_SYMBOLS[symbol];
    const basePrice = info?.price ?? 1000;
    let price = basePrice;

    const timer = setInterval(() => {
      const open  = price;
      const close = this.jitter(price, 0.003);
      const high  = Math.max(open, close) * (1 + Math.random() * 0.002);
      const low   = Math.min(open, close) * (1 - Math.random() * 0.002);
      price = close;

      onCandle({
        symbol, timeframe,
        openTime:  new Date(Date.now() - timeframeToMs(timeframe)),
        closeTime: new Date(),
        open, high, low, close,
        volume: 50 + Math.random() * 20,
        isClosed: false,
      });
    }, 5_000); // emit every 5 seconds in mock mode

    this.subscriptions.add(timer);
    return () => {
      clearInterval(timer);
      this.subscriptions.delete(timer);
    };
  }

  async getSymbolInfo(symbol: string): Promise<SymbolInfo> {
    const info = MOCK_SYMBOLS[symbol];
    if (!info) throw new Error(`Mock: unknown symbol ${symbol}`);
    return {
      symbol,
      baseAsset:    info.base,
      quoteAsset:   info.quote,
      minOrderSize: 0.00001,
      tickSize:     0.01,
      stepSize:     0.00001,
      minNotional:  10,
    };
  }

  private jitter(base: number, pct: number): number {
    return base * (1 + (Math.random() - 0.5) * 2 * pct);
  }
}

function timeframeToMs(tf: Timeframe): number {
  const map: Record<Timeframe, number> = {
    '1m':  60_000,
    '5m':  300_000,
    '15m': 900_000,
    '1h':  3_600_000,
    '4h':  14_400_000,
    '1d':  86_400_000,
  };
  return map[tf];
}
