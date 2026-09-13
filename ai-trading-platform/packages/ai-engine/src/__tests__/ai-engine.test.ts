import { parseAIOutput, toAnalysisResult } from '../parser';
import { AIRequestManager }               from '../request-manager';
import { buildMessageArray }              from '../prompt';
import type { AIProvider, RawAIResponse } from '../types';
import type { AIAnalysisRequest }         from '@trading/types';

// =============================================================================
// FIXTURES
// =============================================================================

const validJson = JSON.stringify({
  decision:     'BUY',
  confidence:   0.82,
  marketRegime: 'TRENDING_UP',
  entry:        50_000,
  stopLoss:     49_000,
  takeProfit:   52_000,
  reasons:      ['Strong uptrend', 'RSI not overbought', 'Volume confirmed'],
});

const mockRequest: AIAnalysisRequest = {
  symbol:       'BTCUSDT',
  currentPrice: 50_000,
  marketRegime: 'TRENDING_UP',
  strategySignals: [{
    id:         'sig-1',
    symbol:     'BTCUSDT',
    timeframe:  '1h',
    direction:  'LONG',
    score:      82,
    confidence: 0.82,
    entryZone:  { min: 49_900, max: 50_100 },
    suggestedStopLoss:   49_000,
    suggestedTakeProfit: 52_000,
    riskReward:   2.0,
    marketRegime: 'TRENDING_UP',
    reasons:      ['EMA aligned'],
    strategyName: 'ema_trend_follow',
    timestamp:    new Date(),
  }],
  recentCandles: [],
  openPositions: [],
  riskSettings: {
    riskPerTradePercent:  0.01,
    minRiskReward:        2.0,
    maxDailyLossPercent:  0.03,
    maxWeeklyLossPercent: 0.06,
    maxDrawdownPercent:   0.10,
    maxTradesPerDay:      5,
    maxOpenPositions:     3,
    maxLeverage:          1,
    minStrategyScore:     70,
    minAIConfidence:      0.75,
    allowedSymbols:       [],
    longEnabled:          true,
    shortEnabled:         false,
    stopLossMode:         'structure',
    takeProfitMode:       'rr_ratio',
    trailingStopEnabled:  false,
    breakEvenEnabled:     false,
    tradingHoursStart:    '00:00',
    tradingHoursEnd:      '23:59',
    cooldownAfterTradeMs: 0,
    cooldownAfterLossMs:  0,
    aiEnabled:            true,
    aiUnavailableMode:    'NO_TRADE',
  },
};

const logger = {
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as never;

// ── Mock provider factory ─────────────────────────────────────────────────────
function makeProvider(response: RawAIResponse): AIProvider {
  return {
    name:    'groq',
    analyse: jest.fn().mockResolvedValue(response),
  };
}

function makeConfig(overrides = {}): Parameters<typeof AIRequestManager>[1] {
  return {
    maxPerMinute:    10,
    maxPerDay:       100,
    timeoutMs:       5_000,
    retryAttempts:   1,
    cacheSeconds:    60,
    unavailableMode: 'NO_TRADE',
    ...overrides,
  };
}

// =============================================================================
// PARSER TESTS
// =============================================================================

describe('parseAIOutput', () => {
  it('parses clean JSON', () => {
    const result = parseAIOutput(validJson);
    expect(result.success).toBe(true);
    expect(result.data?.decision).toBe('BUY');
    expect(result.data?.confidence).toBe(0.82);
    expect(result.data?.reasons).toHaveLength(3);
  });

  it('parses JSON inside markdown code block', () => {
    const wrapped = `Here is my analysis:\n\`\`\`json\n${validJson}\n\`\`\``;
    const result  = parseAIOutput(wrapped);
    expect(result.success).toBe(true);
    expect(result.data?.decision).toBe('BUY');
  });

  it('parses JSON with surrounding text', () => {
    const withText = `Based on my analysis: ${validJson} — hope this helps!`;
    const result   = parseAIOutput(withText);
    expect(result.success).toBe(true);
  });

  it('rejects empty string', () => {
    expect(parseAIOutput('').success).toBe(false);
  });

  it('rejects non-JSON text', () => {
    const result = parseAIOutput('I think you should buy Bitcoin today!');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects JSON with wrong schema (missing fields)', () => {
    const bad = JSON.stringify({ decision: 'BUY' }); // missing required fields
    expect(parseAIOutput(bad).success).toBe(false);
  });

  it('rejects invalid decision value', () => {
    const bad = JSON.stringify({ ...JSON.parse(validJson) as object, decision: 'MAYBE' });
    expect(parseAIOutput(bad).success).toBe(false);
  });

  it('rejects confidence out of 0–1 range', () => {
    const bad = JSON.stringify({ ...JSON.parse(validJson) as object, confidence: 1.5 });
    expect(parseAIOutput(bad).success).toBe(false);
  });

  it('accepts all valid decision values', () => {
    for (const decision of ['BUY', 'SELL', 'HOLD', 'NO_TRADE']) {
      const json   = JSON.stringify({ ...JSON.parse(validJson) as object, decision });
      const result = parseAIOutput(json);
      expect(result.success).toBe(true);
      expect(result.data?.decision).toBe(decision);
    }
  });

  it('parses SELL decision correctly', () => {
    const sellJson = JSON.stringify({
      decision:     'SELL',
      confidence:   0.75,
      marketRegime: 'TRENDING_DOWN',
      entry:        50_000,
      stopLoss:     51_000,
      takeProfit:   48_000,
      reasons:      ['Downtrend confirmed'],
    });
    const result = parseAIOutput(sellJson);
    expect(result.success).toBe(true);
    expect(result.data?.decision).toBe('SELL');
  });
});

// =============================================================================
// AI REQUEST MANAGER TESTS
// =============================================================================

describe('AIRequestManager', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('successful request', () => {
    it('returns AIAnalysisResult on valid provider response', async () => {
      const provider = makeProvider({ content: validJson, latencyMs: 200, tokensUsed: 150, error: null });
      const manager  = new AIRequestManager(provider, makeConfig(), logger);
      const result   = await manager.analyse(mockRequest);

      expect(result).not.toBeNull();
      expect(result?.decision).toBe('BUY');
      expect(result?.confidence).toBe(0.82);
      expect(result?.latencyMs).toBe(200);
    });

    it('increments usage counters', async () => {
      const provider = makeProvider({ content: validJson, latencyMs: 100, tokensUsed: 100, error: null });
      const manager  = new AIRequestManager(provider, makeConfig(), logger);
      await manager.analyse(mockRequest);
      const stats = manager.getUsageStats();
      expect(stats.requestsToday).toBe(1);
      expect(stats.requestsThisMinute).toBe(1);
    });
  });

  describe('caching', () => {
    it('returns cached result on second identical request', async () => {
      const analyse  = jest.fn().mockResolvedValue({ content: validJson, latencyMs: 100, tokensUsed: 50, error: null });
      const provider = { name: 'groq' as const, analyse };
      const manager  = new AIRequestManager(provider, makeConfig({ cacheSeconds: 60 }), logger);

      await manager.analyse(mockRequest);
      await manager.analyse(mockRequest);

      // Provider should be called only once (second hits cache)
      expect(analyse).toHaveBeenCalledTimes(1);
    });

    it('does not return expired cache', async () => {
      const analyse  = jest.fn().mockResolvedValue({ content: validJson, latencyMs: 100, tokensUsed: 50, error: null });
      const provider = { name: 'groq' as const, analyse };
      const manager  = new AIRequestManager(provider, makeConfig({ cacheSeconds: 0 }), logger);

      await manager.analyse(mockRequest);
      await manager.analyse(mockRequest);

      // cacheSeconds=0 → always expired → provider called twice
      expect(analyse).toHaveBeenCalledTimes(2);
    });
  });

  describe('rate limiting', () => {
    it('returns null when per-minute limit reached', async () => {
      const provider = makeProvider({ content: validJson, latencyMs: 10, tokensUsed: 10, error: null });
      const manager  = new AIRequestManager(provider, makeConfig({ maxPerMinute: 2 }), logger);

      // Exhaust the limit
      await manager.analyse(mockRequest);
      await manager.analyse(mockRequest);

      // Third call should be blocked
      const result = await manager.analyse(mockRequest);
      expect(result).toBeNull();
    });

    it('returns null when daily limit reached', async () => {
      const provider = makeProvider({ content: validJson, latencyMs: 10, tokensUsed: 10, error: null });
      const manager  = new AIRequestManager(provider, makeConfig({ maxPerDay: 1 }), logger);

      await manager.analyse(mockRequest);
      const result = await manager.analyse(mockRequest);
      expect(result).toBeNull();
    });

    it('tracks rate limit hits', async () => {
      const provider = makeProvider({ content: validJson, latencyMs: 10, tokensUsed: 10, error: null });
      const manager  = new AIRequestManager(provider, makeConfig({ maxPerMinute: 1 }), logger);

      await manager.analyse(mockRequest); // succeeds
      await manager.analyse(mockRequest); // blocked
      await manager.analyse(mockRequest); // blocked

      const stats = manager.getUsageStats();
      expect(stats.rateLimitHitsToday).toBe(2);
    });

    it('canRequest() returns false when rate limited', async () => {
      const provider = makeProvider({ content: validJson, latencyMs: 10, tokensUsed: 10, error: null });
      const manager  = new AIRequestManager(provider, makeConfig({ maxPerMinute: 1 }), logger);
      await manager.analyse(mockRequest);
      expect(manager.canRequest()).toBe(false);
    });
  });

  describe('error handling', () => {
    it('returns null on provider error', async () => {
      const provider = makeProvider({ content: '', latencyMs: 100, tokensUsed: null, error: 'Network error' });
      const manager  = new AIRequestManager(provider, makeConfig({ retryAttempts: 0 }), logger);
      const result   = await manager.analyse(mockRequest);
      expect(result).toBeNull();
    });

    it('returns null on 429 rate limit from provider', async () => {
      const provider = makeProvider({ content: '', latencyMs: 100, tokensUsed: null, error: 'Rate limit: 429' });
      const manager  = new AIRequestManager(provider, makeConfig({ retryAttempts: 2 }), logger);
      const result   = await manager.analyse(mockRequest);
      expect(result).toBeNull();
    });

    it('returns null on invalid JSON response', async () => {
      const provider = makeProvider({ content: 'I think you should buy!', latencyMs: 100, tokensUsed: 50, error: null });
      const manager  = new AIRequestManager(provider, makeConfig({ retryAttempts: 0 }), logger);
      const result   = await manager.analyse(mockRequest);
      expect(result).toBeNull();
    });

    it('increments error counter on failure', async () => {
      const provider = makeProvider({ content: '', latencyMs: 100, tokensUsed: null, error: 'Timeout' });
      const manager  = new AIRequestManager(provider, makeConfig({ retryAttempts: 0 }), logger);
      await manager.analyse(mockRequest);
      expect(manager.getUsageStats().errorsToday).toBe(1);
    });

    it('retries on network error (not on 429)', async () => {
      const analyse = jest.fn()
        .mockResolvedValueOnce({ content: '', latencyMs: 100, tokensUsed: null, error: 'Connection refused' })
        .mockResolvedValueOnce({ content: validJson, latencyMs: 100, tokensUsed: 50, error: null });

      const provider = { name: 'groq' as const, analyse };
      const manager  = new AIRequestManager(provider, makeConfig({ retryAttempts: 1 }), logger);
      const result   = await manager.analyse(mockRequest);

      expect(analyse).toHaveBeenCalledTimes(2);
      expect(result).not.toBeNull();
      expect(result?.decision).toBe('BUY');
    });
  });

  describe('usage stats', () => {
    it('returns all required stat fields', () => {
      const provider = makeProvider({ content: validJson, latencyMs: 10, tokensUsed: 10, error: null });
      const manager  = new AIRequestManager(provider, makeConfig(), logger);
      const stats    = manager.getUsageStats();

      expect(stats).toHaveProperty('requestsToday');
      expect(stats).toHaveProperty('requestsThisMinute');
      expect(stats).toHaveProperty('errorsToday');
      expect(stats).toHaveProperty('rateLimitHitsToday');
      expect(stats).toHaveProperty('remainingToday');
      expect(stats).toHaveProperty('remainingThisMinute');
      expect(stats).toHaveProperty('lastRequestAt');
    });

    it('remainingToday decrements with each request', async () => {
      const provider = makeProvider({ content: validJson, latencyMs: 10, tokensUsed: 10, error: null });
      const manager  = new AIRequestManager(provider, makeConfig({ maxPerDay: 10 }), logger);

      const before = manager.getUsageStats().remainingToday;
      await manager.analyse(mockRequest);
      const after = manager.getUsageStats().remainingToday;

      expect(after).toBe(before - 1);
    });
  });
});

// =============================================================================
// PROMPT TESTS
// =============================================================================

describe('buildMessageArray', () => {
  it('returns system and user messages', () => {
    const messages = buildMessageArray(mockRequest);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
  });

  it('includes symbol in user message', () => {
    const messages = buildMessageArray(mockRequest);
    expect(messages[1]?.content).toContain('BTCUSDT');
  });

  it('includes market regime', () => {
    const messages = buildMessageArray(mockRequest);
    expect(messages[1]?.content).toContain('TRENDING_UP');
  });

  it('includes JSON schema in prompt', () => {
    const messages = buildMessageArray(mockRequest);
    expect(messages[1]?.content).toContain('"decision"');
    expect(messages[1]?.content).toContain('"confidence"');
  });
});
