import type { Logger } from 'pino';
import type { AIAnalysisRequest, AIAnalysisResult } from '@trading/types';
import type { AIProvider, AIRequestManagerConfig, RateLimiterState } from './types';
import { parseAIOutput, toAnalysisResult } from './parser';

// =============================================================================
// AI REQUEST MANAGER
// Manages all AI API calls with:
//   - Per-minute rate limiting
//   - Per-day request cap
//   - Simple in-memory response cache
//   - Exponential backoff on failure
//   - Usage statistics tracking
//   - Graceful degradation when unavailable
//
// The system NEVER crashes on AI unavailability.
// AI_UNAVAILABLE_MODE=NO_TRADE → return null (worker skips the trade)
// AI_UNAVAILABLE_MODE=RULE_BASED → return null (worker uses strategy only)
// =============================================================================

export class AIRequestManager {
  private state: RateLimiterState = {
    requestsThisMinute: 0,
    requestsToday:      0,
    errorsToday:        0,
    rateLimitHitsToday: 0,
    lastRequestAt:      null,
    minuteWindowStart:  new Date(),
    dayWindowStart:     new Date(),
  };

  // Simple in-memory LRU-style cache: key → {result, expiresAt}
  private cache = new Map<string, { result: AIAnalysisResult; expiresAt: number }>();

  constructor(
    private readonly provider: AIProvider,
    private readonly config:   AIRequestManagerConfig,
    private readonly logger:   Logger,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Analyse a trading opportunity.
   * Returns null if AI is unavailable, rate limited, or the response is invalid.
   * Never throws.
   */
  async analyse(request: AIAnalysisRequest): Promise<AIAnalysisResult | null> {
    this.resetWindowsIfNeeded();

    // 1. Cache check
    const cacheKey = this.buildCacheKey(request);
    const cached   = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      this.logger.debug({ symbol: request.symbol }, 'AI: serving from cache');
      return cached.result;
    }

    // 2. Rate limit checks
    if (this.state.requestsThisMinute >= this.config.maxPerMinute) {
      this.state.rateLimitHitsToday++;
      this.logger.warn({
        requestsThisMinute: this.state.requestsThisMinute,
        limit: this.config.maxPerMinute,
      }, 'AI: per-minute rate limit reached');
      return null;
    }

    if (this.state.requestsToday >= this.config.maxPerDay) {
      this.state.rateLimitHitsToday++;
      this.logger.warn({
        requestsToday: this.state.requestsToday,
        limit: this.config.maxPerDay,
      }, 'AI: daily request limit reached');
      return null;
    }

    // 3. Make request with retry
    return this.makeRequestWithRetry(request, cacheKey);
  }

  /**
   * Get current usage statistics.
   */
  getUsageStats(): {
    requestsToday:      number;
    requestsThisMinute: number;
    errorsToday:        number;
    rateLimitHitsToday: number;
    remainingToday:     number;
    remainingThisMinute: number;
    lastRequestAt:      Date | null;
  } {
    this.resetWindowsIfNeeded();
    return {
      requestsToday:       this.state.requestsToday,
      requestsThisMinute:  this.state.requestsThisMinute,
      errorsToday:         this.state.errorsToday,
      rateLimitHitsToday:  this.state.rateLimitHitsToday,
      remainingToday:      Math.max(0, this.config.maxPerDay - this.state.requestsToday),
      remainingThisMinute: Math.max(0, this.config.maxPerMinute - this.state.requestsThisMinute),
      lastRequestAt:       this.state.lastRequestAt,
    };
  }

  /**
   * Check whether the AI can accept a request right now.
   */
  canRequest(): boolean {
    this.resetWindowsIfNeeded();
    return (
      this.state.requestsThisMinute < this.config.maxPerMinute &&
      this.state.requestsToday      < this.config.maxPerDay
    );
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async makeRequestWithRetry(
    request:  AIAnalysisRequest,
    cacheKey: string,
  ): Promise<AIAnalysisResult | null> {
    let lastError: string | null = null;

    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 1s, 2s, 4s
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 8_000);
        await sleep(delayMs);
        this.logger.debug({ attempt, delayMs }, 'AI: retrying request');
      }

      // Update counters
      this.state.requestsThisMinute++;
      this.state.requestsToday++;
      this.state.lastRequestAt = new Date();

      const raw = await this.provider.analyse(request);

      // Rate limited by provider
      if (raw.error?.includes('429') || raw.error?.includes('Rate limit') || raw.error?.includes('rate_limit')) {
        this.state.rateLimitHitsToday++;
        this.state.errorsToday++;
        this.logger.warn({ error: raw.error }, 'AI: provider rate limit hit');
        lastError = raw.error;

        // Don't retry on rate limit — wait for next window
        break;
      }

      // Timeout or network error — may be retryable
      if (raw.error) {
        this.state.errorsToday++;
        lastError = raw.error;
        this.logger.warn({ error: raw.error, attempt }, 'AI: request error');
        continue;
      }

      // Parse the response
      const parsed = parseAIOutput(raw.content);
      if (!parsed.success || !parsed.data) {
        this.state.errorsToday++;
        lastError = parsed.error ?? 'Parse failed';
        this.logger.warn({ error: lastError, content: raw.content.slice(0, 200) }, 'AI: parse error');
        continue;
      }

      // Success!
      const result = toAnalysisResult(parsed.data, raw, this.provider.name, 'model');

      this.logger.info({
        symbol:     request.symbol,
        decision:   result.decision,
        confidence: result.confidence,
        latencyMs:  result.latencyMs,
        tokens:     raw.tokensUsed,
      }, 'AI: analysis complete');

      // Cache the result
      this.cache.set(cacheKey, {
        result,
        expiresAt: Date.now() + this.config.cacheSeconds * 1_000,
      });

      // Prune old cache entries (keep max 50)
      if (this.cache.size > 50) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) this.cache.delete(firstKey);
      }

      return result;
    }

    this.logger.error({ lastError, symbol: request.symbol }, 'AI: all attempts failed');
    return null;
  }

  private resetWindowsIfNeeded(): void {
    const now = Date.now();

    // Reset minute window
    if (now - this.state.minuteWindowStart.getTime() >= 60_000) {
      this.state.requestsThisMinute = 0;
      this.state.minuteWindowStart  = new Date();
    }

    // Reset day window (UTC midnight)
    const today = new Date().toISOString().slice(0, 10);
    const windowDay = this.state.dayWindowStart.toISOString().slice(0, 10);
    if (today !== windowDay) {
      this.state.requestsToday      = 0;
      this.state.errorsToday        = 0;
      this.state.rateLimitHitsToday = 0;
      this.state.dayWindowStart     = new Date();
    }
  }

  private buildCacheKey(request: AIAnalysisRequest): string {
    // Cache by symbol + regime + top signal direction (not exact price — too volatile)
    const topSignal = request.strategySignals[0];
    return [
      request.symbol,
      request.marketRegime,
      topSignal?.direction ?? 'NEUTRAL',
      topSignal?.strategyName ?? 'none',
    ].join(':');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
