import WebSocket from 'ws';
import type { Logger } from 'pino';
import type { Candle, Ticker, Timeframe } from '@trading/types';
import {
  type MarketDataProvider,
  type SymbolInfo,
  MarketDataError,
} from '../types/provider.interface';

// =============================================================================
// BINANCE MARKET DATA PROVIDER
// Supports both mainnet and testnet (EXCHANGE_TESTNET=true).
// Uses REST for historical candles and WebSocket for live updates.
// Rate limit: 1200 weight/min on free tier.
// =============================================================================

const MAINNET_REST  = 'https://api.binance.com';
const TESTNET_REST  = 'https://testnet.binance.vision';
const MAINNET_WS    = 'wss://stream.binance.com:9443/ws';
const TESTNET_WS    = 'wss://testnet.binance.vision/ws';

// Max age before a ticker is considered stale
const TICKER_STALE_MS = 120_000; // 2 minutes

interface BinanceKline {
  t: number; openTime: number;
  T: number; closeTime: number;
  o: string; open: string;
  h: string; high: string;
  l: string; low: string;
  c: string; close: string;
  v: string; volume: string;
  x: boolean; isClosed: boolean;
  s: string; symbol: string;
  i: string; interval: string;
}

interface BinanceKlineEvent {
  e: 'kline';
  E: number;
  s: string;
  k: BinanceKline;
}

interface CachedTicker {
  ticker: Ticker;
  updatedAt: number;
}

export class BinanceProvider implements MarketDataProvider {
  readonly name = 'binance';

  private readonly restBase: string;
  private readonly wsBase: string;
  private readonly testnet: boolean;

  private wsConnections = new Map<string, WebSocket>();
  private tickerCache   = new Map<string, CachedTicker>();
  private connected     = false;
  private lastDataAt    = 0;

  constructor(
    private readonly logger: Logger,
    testnet = true,
  ) {
    this.testnet = testnet;
    this.restBase = testnet ? TESTNET_REST : MAINNET_REST;
    this.wsBase   = testnet ? TESTNET_WS   : MAINNET_WS;

    if (testnet) {
      this.logger.info('BinanceProvider: using TESTNET — no real funds');
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.connected) return;
    // Verify connectivity with a lightweight ping
    await this.fetchRest<{ serverTime: number }>('/api/v3/time');
    this.connected = true;
    this.lastDataAt = Date.now();
    this.logger.info({ testnet: this.testnet }, 'BinanceProvider connected');
  }

  async disconnect(): Promise<void> {
    for (const [key, ws] of this.wsConnections) {
      ws.terminate();
      this.wsConnections.delete(key);
    }
    this.connected = false;
    this.logger.info('BinanceProvider disconnected');
  }

  isHealthy(): boolean {
    if (!this.connected) return false;
    // Stale if no data received in the last 5 minutes
    return Date.now() - this.lastDataAt < 300_000;
  }

  // ── Ticker ─────────────────────────────────────────────────────────────────

  async getTicker(symbol: string): Promise<Ticker> {
    const cached = this.tickerCache.get(symbol);
    if (cached && Date.now() - cached.updatedAt < TICKER_STALE_MS) {
      return cached.ticker;
    }

    const data = await this.fetchRest<{
      symbol: string;
      bidPrice: string;
      askPrice: string;
      lastPrice: string;
      volume: string;
      priceChange: string;
      priceChangePercent: string;
    }>(`/api/v3/ticker/24hr?symbol=${symbol}`);

    const ticker: Ticker = {
      symbol: data.symbol,
      price:           parseFloat(data.lastPrice),
      bid:             parseFloat(data.bidPrice),
      ask:             parseFloat(data.askPrice),
      spread:          parseFloat(data.askPrice) - parseFloat(data.bidPrice),
      volume24h:       parseFloat(data.volume),
      change24h:       parseFloat(data.priceChange),
      changePercent24h: parseFloat(data.priceChangePercent),
      timestamp: new Date(),
    };

    this.tickerCache.set(symbol, { ticker, updatedAt: Date.now() });
    this.lastDataAt = Date.now();
    return ticker;
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    const data = await this.fetchRest<{ price: string }>(`/api/v3/ticker/price?symbol=${symbol}`);
    this.lastDataAt = Date.now();
    return parseFloat(data.price);
  }

  // ── Candles ────────────────────────────────────────────────────────────────

  async getCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const interval = toExchangeInterval(timeframe);
    const safeLimit = Math.min(limit, 1000); // Binance max

    const raw = await this.fetchRest<Array<[
      number, string, string, string, string, string,
      number, string, number, string, string, string
    ]>>(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${safeLimit}`);

    this.lastDataAt = Date.now();

    return raw.map((k) => ({
      symbol,
      timeframe,
      openTime:  new Date(k[0]),
      closeTime: new Date(k[6]),
      open:      parseFloat(k[1]),
      high:      parseFloat(k[2]),
      low:       parseFloat(k[3]),
      close:     parseFloat(k[4]),
      volume:    parseFloat(k[5]),
      isClosed:  true, // REST always returns closed candles
    }));
  }

  // ── WebSocket candle subscription ──────────────────────────────────────────

  subscribeToCandles(
    symbol: string,
    timeframe: Timeframe,
    onCandle: (candle: Candle) => void,
    onError: (err: Error) => void,
  ): () => void {
    const interval = toExchangeInterval(timeframe);
    const stream   = `${symbol.toLowerCase()}@kline_${interval}`;
    const key      = `${symbol}:${timeframe}`;

    // Close any existing subscription for this key
    this.wsConnections.get(key)?.terminate();

    const url = `${this.wsBase}/${stream}`;
    const ws  = new WebSocket(url);
    this.wsConnections.set(key, ws);

    let reconnectTimer: NodeJS.Timeout | null = null;
    let alive = true;

    const scheduleReconnect = (): void => {
      if (!alive) return;
      reconnectTimer = setTimeout(() => {
        this.logger.warn({ symbol, timeframe }, 'WebSocket reconnecting…');
        this.subscribeToCandles(symbol, timeframe, onCandle, onError);
      }, 5_000);
    };

    ws.on('open', () => {
      this.logger.debug({ symbol, timeframe }, 'WebSocket stream opened');
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const event = JSON.parse(data.toString()) as BinanceKlineEvent;
        if (event.e !== 'kline') return;

        const k = event.k;
        const candle: Candle = {
          symbol: k.s,
          timeframe,
          openTime:  new Date(k.t),
          closeTime: new Date(k.T),
          open:      parseFloat(k.o),
          high:      parseFloat(k.h),
          low:       parseFloat(k.l),
          close:     parseFloat(k.c),
          volume:    parseFloat(k.v),
          isClosed:  k.x,
        };

        this.lastDataAt = Date.now();
        onCandle(candle);
      } catch (err) {
        this.logger.warn({ err, symbol, timeframe }, 'Failed to parse WebSocket message');
      }
    });

    ws.on('error', (err) => {
      this.logger.error({ err, symbol, timeframe }, 'WebSocket error');
      onError(new MarketDataError(err.message, 'CONNECTION_FAILED', this.name));
      scheduleReconnect();
    });

    ws.on('close', () => {
      this.logger.warn({ symbol, timeframe }, 'WebSocket closed');
      scheduleReconnect();
    });

    // Heartbeat: send ping every 30s to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 30_000);

    // Return unsubscribe function
    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(pingInterval);
      ws.terminate();
      this.wsConnections.delete(key);
      this.logger.debug({ symbol, timeframe }, 'WebSocket unsubscribed');
    };
  }

  // ── Symbol info ────────────────────────────────────────────────────────────

  async getSymbolInfo(symbol: string): Promise<SymbolInfo> {
    const data = await this.fetchRest<{
      symbols: Array<{
        symbol: string;
        baseAsset: string;
        quoteAsset: string;
        filters: Array<{ filterType: string; minQty?: string; tickSize?: string; minNotional?: string; stepSize?: string }>;
      }>;
    }>(`/api/v3/exchangeInfo?symbol=${symbol}`);

    const info = data.symbols[0];
    if (!info) {
      throw new MarketDataError(`Symbol ${symbol} not found`, 'INVALID_SYMBOL', this.name, false);
    }

    const lotFilter   = info.filters.find((f) => f.filterType === 'LOT_SIZE');
    const priceFilter = info.filters.find((f) => f.filterType === 'PRICE_FILTER');
    const notional    = info.filters.find((f) => f.filterType === 'MIN_NOTIONAL');

    return {
      symbol:       info.symbol,
      baseAsset:    info.baseAsset,
      quoteAsset:   info.quoteAsset,
      minOrderSize: parseFloat(lotFilter?.minQty ?? '0'),
      tickSize:     parseFloat(priceFilter?.tickSize ?? '0.01'),
      stepSize:     parseFloat(lotFilter?.stepSize ?? '0.00001'),
      minNotional:  parseFloat(notional?.minNotional ?? '10'),
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async fetchRest<T>(path: string): Promise<T> {
    const url = `${this.restBase}${path}`;
    let res: Response;

    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new MarketDataError(
        `Request failed: ${String(err)}`,
        'CONNECTION_FAILED',
        this.name,
      );
    }

    if (res.status === 429 || res.status === 418) {
      throw new MarketDataError('Rate limit exceeded', 'RATE_LIMIT', this.name);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new MarketDataError(
        `HTTP ${res.status}: ${body}`,
        'UNAVAILABLE',
        this.name,
      );
    }

    try {
      return (await res.json()) as T;
    } catch {
      throw new MarketDataError('Failed to parse response', 'PARSE_ERROR', this.name, false);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toExchangeInterval(tf: Timeframe): string {
  const map: Record<Timeframe, string> = {
    '1m':  '1m',
    '5m':  '5m',
    '15m': '15m',
    '1h':  '1h',
    '4h':  '4h',
    '1d':  '1d',
  };
  return map[tf];
}
