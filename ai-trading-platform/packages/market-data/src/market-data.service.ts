import type { Logger } from 'pino';
import type { Candle, Timeframe } from '@trading/types';
import { CandleRepo } from '@trading/database';
import type { MarketDataProvider } from '../types/provider.interface';
import { MarketDataError } from '../types/provider.interface';

// =============================================================================
// MARKET DATA SERVICE
// Sits between the provider and the rest of the system.
// Responsibilities:
//   - Fetch + persist candles to PostgreSQL
//   - Detect and reject stale data
//   - Manage live WebSocket subscriptions
//   - Expose clean typed API to the worker
// =============================================================================

export interface MarketDataConfig {
  symbols: string[];
  timeframes: Timeframe[];
  /** How many historical candles to seed on startup */
  historicalLimit: number;
  /** Max age (ms) before a candle set is considered stale */
  staleThresholdMs: number;
}

type SubscriptionKey = `${string}:${string}`;

export class MarketDataService {
  private unsubscribeFns = new Map<SubscriptionKey, () => void>();
  private lastCandleAt   = new Map<SubscriptionKey, number>();

  constructor(
    private readonly provider: MarketDataProvider,
    private readonly config: MarketDataConfig,
    private readonly logger: Logger,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await this.provider.connect();
    await this.seedHistoricalCandles();
    this.startLiveSubscriptions();
    this.logger.info(
      {
        provider: this.provider.name,
        symbols: this.config.symbols,
        timeframes: this.config.timeframes,
      },
      'MarketDataService started',
    );
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribeFns.values()) unsub();
    this.unsubscribeFns.clear();
    await this.provider.disconnect();
    this.logger.info('MarketDataService stopped');
  }

  isHealthy(): boolean {
    return this.provider.isHealthy();
  }

  // ── Historical seed ────────────────────────────────────────────────────────

  /**
   * On startup, fetch and persist recent historical candles for all configured
   * symbol/timeframe pairs. This ensures the indicator engine has enough data
   * to calculate EMA(200), ATR, etc. without waiting for live data.
   */
  private async seedHistoricalCandles(): Promise<void> {
    this.logger.info('Seeding historical candles…');
    let total = 0;

    for (const symbol of this.config.symbols) {
      // Ensure symbol record exists in DB
      try {
        const info = await this.provider.getSymbolInfo(symbol);
        await CandleRepo.ensureSymbol(
          info.symbol,
          info.baseAsset,
          info.quoteAsset,
          this.provider.name,
        );
      } catch (err) {
        this.logger.warn({ err, symbol }, 'Could not fetch symbol info — skipping');
        continue;
      }

      for (const timeframe of this.config.timeframes) {
        try {
          const candles = await this.provider.getCandles(
            symbol,
            timeframe,
            this.config.historicalLimit,
          );

          const saved = await CandleRepo.upsertCandles(candles);
          total += saved;

          const key: SubscriptionKey = `${symbol}:${timeframe}`;
          this.lastCandleAt.set(key, Date.now());

          this.logger.debug(
            { symbol, timeframe, fetched: candles.length, saved },
            'Historical candles seeded',
          );

          // Small delay to respect rate limits
          await sleep(250);
        } catch (err) {
          this.logger.warn({ err, symbol, timeframe }, 'Failed to seed historical candles');
        }
      }
    }

    this.logger.info({ totalSaved: total }, 'Historical candle seed complete');
  }

  // ── Live subscriptions ─────────────────────────────────────────────────────

  private startLiveSubscriptions(): void {
    for (const symbol of this.config.symbols) {
      for (const timeframe of this.config.timeframes) {
        this.subscribe(symbol, timeframe);
      }
    }
  }

  private subscribe(symbol: string, timeframe: Timeframe): void {
    const key: SubscriptionKey = `${symbol}:${timeframe}`;

    // Cancel existing subscription if any
    this.unsubscribeFns.get(key)?.();

    const unsub = this.provider.subscribeToCandles(
      symbol,
      timeframe,
      (candle) => void this.handleCandle(candle, key),
      (err) => this.handleSubscriptionError(err, symbol, timeframe),
    );

    this.unsubscribeFns.set(key, unsub);
    this.logger.debug({ symbol, timeframe }, 'Live subscription started');
  }

  private async handleCandle(candle: Candle, key: SubscriptionKey): Promise<void> {
    this.lastCandleAt.set(key, Date.now());

    // Only persist closed candles to avoid writing partial data
    if (candle.isClosed) {
      try {
        await CandleRepo.upsertCandles([candle]);
        this.logger.debug(
          { symbol: candle.symbol, timeframe: candle.timeframe, close: candle.close },
          'Candle closed and persisted',
        );
      } catch (err) {
        this.logger.warn({ err, symbol: candle.symbol }, 'Failed to persist candle');
      }
    }
  }

  private handleSubscriptionError(err: Error, symbol: string, timeframe: Timeframe): void {
    this.logger.error({ err, symbol, timeframe }, 'Subscription error — will auto-reconnect');
  }

  // ── Polling fallback (used by BullMQ job) ─────────────────────────────────

  /**
   * Manually poll for new candles. Called by the market-data-update job.
   * Acts as a safety net when WebSocket subscriptions miss data.
   */
  async pollCandles(): Promise<void> {
    for (const symbol of this.config.symbols) {
      for (const timeframe of this.config.timeframes) {
        try {
          // Only fetch the last 10 candles on poll (not full history)
          const candles = await this.provider.getCandles(symbol, timeframe, 10);
          const saved   = await CandleRepo.upsertCandles(candles);

          if (saved > 0) {
            this.logger.debug({ symbol, timeframe, saved }, 'Poll: new candles saved');
          }

          await sleep(150);
        } catch (err) {
          this.logger.warn({ err, symbol, timeframe }, 'Poll failed for candle');
        }
      }
    }
  }

  // ── Data access ────────────────────────────────────────────────────────────

  /**
   * Get recent candles from DB (in ascending order, ready for indicators).
   * Throws if data is stale.
   */
  async getCandles(symbol: string, timeframe: Timeframe, limit = 200): Promise<Candle[]> {
    const rows = await CandleRepo.getRecentCandles(symbol, timeframe, limit);
    if (rows.length === 0) {
      throw new MarketDataError(
        `No candles in DB for ${symbol}/${timeframe}`,
        'UNAVAILABLE',
        this.provider.name,
      );
    }

    // Stale check
    const latestTs = rows.at(-1)?.openTime?.getTime() ?? 0;
    const ageMs    = Date.now() - latestTs;
    if (ageMs > this.config.staleThresholdMs) {
      throw new MarketDataError(
        `Stale candle data for ${symbol}/${timeframe} — last candle ${Math.round(ageMs / 60000)}m ago`,
        'STALE_DATA',
        this.provider.name,
        false, // not retryable — wait for next poll
      );
    }

    return rows.map(CandleRepo.toCandle);
  }

  /**
   * Get the current price for a symbol (from live provider).
   */
  async getCurrentPrice(symbol: string): Promise<number> {
    return this.provider.getCurrentPrice(symbol);
  }

  /**
   * Check if candle data is fresh enough to trade.
   */
  isDataFresh(symbol: string, timeframe: Timeframe): boolean {
    const key: SubscriptionKey = `${symbol}:${timeframe}`;
    const lastAt = this.lastCandleAt.get(key);
    if (!lastAt) return false;
    return Date.now() - lastAt < this.config.staleThresholdMs;
  }

  /**
   * Return a health summary for all tracked pairs.
   */
  getDataHealth(): Array<{ symbol: string; timeframe: string; lastCandleMs: number; fresh: boolean }> {
    return this.config.symbols.flatMap((symbol) =>
      this.config.timeframes.map((timeframe) => {
        const key: SubscriptionKey = `${symbol}:${timeframe}`;
        const lastAt = this.lastCandleAt.get(key) ?? 0;
        const ageMs  = Date.now() - lastAt;
        return {
          symbol,
          timeframe,
          lastCandleMs: ageMs,
          fresh: ageMs < this.config.staleThresholdMs,
        };
      }),
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
