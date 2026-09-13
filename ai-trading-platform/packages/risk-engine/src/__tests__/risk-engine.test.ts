import { RiskEngine } from '../risk-engine';
import { calculatePositionSize } from '../position-sizing';
import { isWithinTradingHours } from '../trading-hours';
import type { RiskSettings } from '@trading/types';
import type { AccountState, TradingState, TradeProposal } from '../types';

// =============================================================================
// TEST FIXTURES
// =============================================================================

const defaultSettings: RiskSettings = {
  riskPerTradePercent:  0.01,   // 1%
  minRiskReward:        2.0,
  maxDailyLossPercent:  0.03,   // 3%
  maxWeeklyLossPercent: 0.06,   // 6%
  maxDrawdownPercent:   0.10,   // 10%
  maxTradesPerDay:      5,
  maxOpenPositions:     3,
  maxLeverage:          1,
  minStrategyScore:     70,
  minAIConfidence:      0.75,
  allowedSymbols:       [],     // empty = all allowed
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
};

const healthyAccount: AccountState = {
  balance:          10_000,
  equity:           10_000,
  availableBalance: 10_000,
  highWaterMark:    10_000,
  currency:         'USDT',
  isPaper:          true,
};

const cleanState: TradingState = {
  openPositions:       [],
  tradesToday:         0,
  realisedPnlToday:    0,
  unrealisedPnlToday:  0,
  realisedPnlWeek:     0,
  lastTradeAt:         null,
  lastLossAt:          null,
  consecutiveLosses:   0,
  emergencyStopActive: false,
  dailyLossBreached:   false,
  drawdownBreached:    false,
};

const goodProposal: TradeProposal = {
  symbol:        'BTCUSDT',
  direction:     'LONG',
  entryPrice:    50_000,
  stopLoss:      49_000,   // $1000 below entry
  takeProfit:    52_000,   // $2000 above entry → R:R = 2.0
  strategyScore: 80,
  aiConfidence:  0.80,
  signal:        {} as never,
  aiResult:      null,
};

function makeEngine(overrides: Partial<RiskSettings> = {}): RiskEngine {
  return new RiskEngine({ ...defaultSettings, ...overrides });
}

// =============================================================================
// RISK ENGINE TESTS
// =============================================================================

describe('RiskEngine — Happy Path', () => {
  it('approves a well-formed trade', () => {
    const engine = makeEngine();
    const result = engine.validate(goodProposal, healthyAccount, cleanState);
    expect(result.approved).toBe(true);
    expect(result.rejectionReasons).toHaveLength(0);
    expect(result.positionSize).toBeGreaterThan(0);
    expect(result.riskAmount).toBeGreaterThan(0);
    expect(result.riskReward).toBeCloseTo(2.0, 1);
  });

  it('calculates correct position size for 1% risk', () => {
    const engine = makeEngine();
    const result = engine.validate(goodProposal, healthyAccount, cleanState);
    // riskAmount ≈ 10000 × 0.01 = $100
    expect(result.riskAmount).toBeCloseTo(100, 0);
    // size ≈ 100 / 1000 = 0.1 BTC (before fees)
    expect(result.positionSize).toBeCloseTo(0.1, 2);
  });
});

// =============================================================================
describe('RiskEngine — Emergency & System Checks', () => {
  it('rejects when emergency stop is active', () => {
    const engine = makeEngine();
    const result = engine.validate(
      goodProposal, healthyAccount,
      { ...cleanState, emergencyStopActive: true },
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons[0]?.code).toBe('EMERGENCY_STOP');
  });

  it('rejects when balance is zero', () => {
    const engine = makeEngine();
    const result = engine.validate(
      goodProposal,
      { ...healthyAccount, balance: 0, availableBalance: 0 },
      cleanState,
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'INSUFFICIENT_BALANCE')).toBe(true);
  });
});

// =============================================================================
describe('RiskEngine — Loss Limits', () => {
  it('rejects when daily loss limit reached (3%)', () => {
    const engine = makeEngine();
    // $300 loss on $10k account = 3%
    const result = engine.validate(
      goodProposal, healthyAccount,
      { ...cleanState, realisedPnlToday: -300 },
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'DAILY_LOSS_LIMIT')).toBe(true);
  });

  it('rejects when unrealised loss pushes over daily limit', () => {
    const engine = makeEngine();
    const result = engine.validate(
      goodProposal, healthyAccount,
      {
        ...cleanState,
        realisedPnlToday:   -100,
        unrealisedPnlToday: -250, // total -350 > 3% of 10k
      },
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'DAILY_LOSS_LIMIT')).toBe(true);
  });

  it('allows trade when daily loss is below limit', () => {
    const engine = makeEngine();
    const result = engine.validate(
      goodProposal, healthyAccount,
      { ...cleanState, realisedPnlToday: -200 }, // 2% < 3%
    );
    expect(result.approved).toBe(true);
  });

  it('rejects when weekly loss limit reached (6%)', () => {
    const engine = makeEngine();
    const result = engine.validate(
      goodProposal, healthyAccount,
      { ...cleanState, realisedPnlWeek: -620 }, // 6.2% > 6%
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'WEEKLY_LOSS_LIMIT')).toBe(true);
  });
});

// =============================================================================
describe('RiskEngine — Drawdown', () => {
  it('rejects when max drawdown reached (10%)', () => {
    const engine = makeEngine();
    const result = engine.validate(
      goodProposal,
      {
        ...healthyAccount,
        highWaterMark: 10_000,
        equity:        8_900, // 11% drawdown
      },
      cleanState,
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'MAX_DRAWDOWN')).toBe(true);
  });

  it('allows trade at 9% drawdown (below 10% limit)', () => {
    const engine = makeEngine();
    const result = engine.validate(
      goodProposal,
      { ...healthyAccount, highWaterMark: 10_000, equity: 9_100 },
      cleanState,
    );
    expect(result.approved).toBe(true);
  });
});

// =============================================================================
describe('RiskEngine — Trade Count Limits', () => {
  it('rejects when max trades per day reached', () => {
    const engine = makeEngine({ maxTradesPerDay: 5 });
    const result = engine.validate(
      goodProposal, healthyAccount,
      { ...cleanState, tradesToday: 5 },
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'MAX_TRADES_TODAY')).toBe(true);
  });

  it('allows trade when trades < max', () => {
    const engine = makeEngine({ maxTradesPerDay: 5 });
    const result = engine.validate(
      goodProposal, healthyAccount,
      { ...cleanState, tradesToday: 4 },
    );
    expect(result.approved).toBe(true);
  });

  it('rejects when max open positions reached', () => {
    const fakePosition = { symbol: 'ETHUSDT', status: 'OPEN' } as never;
    const engine = makeEngine({ maxOpenPositions: 3 });
    const result = engine.validate(
      goodProposal, healthyAccount,
      { ...cleanState, openPositions: [fakePosition, fakePosition, fakePosition] },
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'MAX_OPEN_POSITIONS')).toBe(true);
  });
});

// =============================================================================
describe('RiskEngine — Cooldowns', () => {
  it('rejects during post-trade cooldown', () => {
    const engine = makeEngine({ cooldownAfterTradeMs: 300_000 }); // 5 min
    const result = engine.validate(
      goodProposal, healthyAccount,
      { ...cleanState, lastTradeAt: new Date() }, // just now
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'COOLDOWN_AFTER_TRADE')).toBe(true);
  });

  it('allows trade after cooldown expires', () => {
    const engine = makeEngine({ cooldownAfterTradeMs: 300_000 });
    const sixMinAgo = new Date(Date.now() - 360_000);
    const result = engine.validate(
      goodProposal, healthyAccount,
      { ...cleanState, lastTradeAt: sixMinAgo },
    );
    expect(result.approved).toBe(true);
  });

  it('rejects during post-loss cooldown', () => {
    const engine = makeEngine({ cooldownAfterLossMs: 1_800_000 }); // 30 min
    const result = engine.validate(
      goodProposal, healthyAccount,
      { ...cleanState, lastLossAt: new Date() },
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'COOLDOWN_AFTER_LOSS')).toBe(true);
  });
});

// =============================================================================
describe('RiskEngine — Direction & Symbol Restrictions', () => {
  it('rejects short trade when shorts disabled', () => {
    const engine = makeEngine({ shortEnabled: false });
    const result = engine.validate(
      { ...goodProposal, direction: 'SHORT', stopLoss: 51_000, takeProfit: 48_000 },
      healthyAccount, cleanState,
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'DIRECTION_DISABLED')).toBe(true);
  });

  it('rejects symbol not in allowlist', () => {
    const engine = makeEngine({ allowedSymbols: ['ETHUSDT'] });
    const result = engine.validate(goodProposal, healthyAccount, cleanState);
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'SYMBOL_NOT_ALLOWED')).toBe(true);
  });

  it('allows symbol when allowlist is empty (all allowed)', () => {
    const engine = makeEngine({ allowedSymbols: [] });
    const result = engine.validate(goodProposal, healthyAccount, cleanState);
    expect(result.approved).toBe(true);
  });

  it('rejects when position already open for same symbol', () => {
    const engine = makeEngine();
    const openPos = { symbol: 'BTCUSDT', status: 'OPEN' } as never;
    const result  = engine.validate(
      goodProposal, healthyAccount,
      { ...cleanState, openPositions: [openPos] },
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'POSITION_ALREADY_OPEN')).toBe(true);
  });
});

// =============================================================================
describe('RiskEngine — Signal Quality', () => {
  it('rejects when strategy score below minimum', () => {
    const engine = makeEngine({ minStrategyScore: 80 });
    const result = engine.validate(
      { ...goodProposal, strategyScore: 72 },
      healthyAccount, cleanState,
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'STRATEGY_SCORE_TOO_LOW')).toBe(true);
  });

  it('rejects when AI confidence below minimum', () => {
    const engine = makeEngine({ minAIConfidence: 0.80 });
    const result = engine.validate(
      { ...goodProposal, aiConfidence: 0.70 },
      healthyAccount, cleanState,
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'AI_CONFIDENCE_TOO_LOW')).toBe(true);
  });

  it('skips AI confidence check when AI disabled', () => {
    const engine = makeEngine({ aiEnabled: false });
    const result = engine.validate(
      { ...goodProposal, aiConfidence: 0.10 }, // low but AI disabled
      healthyAccount, cleanState,
    );
    expect(result.approved).toBe(true);
  });

  it('skips AI confidence check when aiConfidence is null', () => {
    const engine = makeEngine({ aiEnabled: true });
    const result = engine.validate(
      { ...goodProposal, aiConfidence: null },
      healthyAccount, cleanState,
    );
    // null confidence = AI didn't run, should still pass other checks
    expect(result.rejectionReasons.every((r) => r.code !== 'AI_CONFIDENCE_TOO_LOW')).toBe(true);
  });

  it('rejects when R:R below minimum', () => {
    const engine = makeEngine({ minRiskReward: 2.0 });
    // Entry 50000, Stop 49500 (risk=500), TP 50800 (reward=800) → R:R=1.6
    const result = engine.validate(
      { ...goodProposal, stopLoss: 49_500, takeProfit: 50_800 },
      healthyAccount, cleanState,
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'RISK_REWARD_TOO_LOW')).toBe(true);
  });
});

// =============================================================================
describe('RiskEngine — Stop Loss / Take Profit Validity', () => {
  it('rejects invalid stop loss (above entry for LONG)', () => {
    const engine = makeEngine();
    const result = engine.validate(
      { ...goodProposal, stopLoss: 51_000 }, // above entry for LONG
      healthyAccount, cleanState,
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'INVALID_STOP_LOSS')).toBe(true);
  });

  it('rejects invalid take profit (below entry for LONG)', () => {
    const engine = makeEngine();
    const result = engine.validate(
      { ...goodProposal, takeProfit: 49_000 }, // below entry for LONG
      healthyAccount, cleanState,
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'INVALID_TAKE_PROFIT')).toBe(true);
  });

  it('rejects zero stop loss', () => {
    const engine = makeEngine();
    const result = engine.validate(
      { ...goodProposal, stopLoss: 0 },
      healthyAccount, cleanState,
    );
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some((r) => r.code === 'INVALID_STOP_LOSS')).toBe(true);
  });
});

// =============================================================================
describe('RiskEngine — canTrade quick check', () => {
  it('returns ok=true in clean state', () => {
    const engine = makeEngine();
    const result = engine.canTrade(healthyAccount, cleanState);
    expect(result.ok).toBe(true);
  });

  it('returns ok=false when emergency stop active', () => {
    const engine = makeEngine();
    const result = engine.canTrade(healthyAccount, { ...cleanState, emergencyStopActive: true });
    expect(result.ok).toBe(false);
  });

  it('returns ok=false when daily loss breached', () => {
    const engine = makeEngine();
    const result = engine.canTrade(
      healthyAccount,
      { ...cleanState, realisedPnlToday: -400 }, // 4% > 3%
    );
    expect(result.ok).toBe(false);
  });
});

// =============================================================================
describe('Position Sizing', () => {
  it('calculates correct size for 1% risk with $1000 stop', () => {
    const result = calculatePositionSize(
      healthyAccount,
      defaultSettings,
      50_000,
      49_000, // $1000 stop
    );
    expect(result.valid).toBe(true);
    // riskAmount = 10000 * 0.01 = $100, size = 100/1000 = 0.1 BTC (before fees)
    expect(result.riskAmount).toBeCloseTo(100, 0);
    expect(result.size).toBeCloseTo(0.1, 2);
  });

  it('returns invalid when stop equals entry', () => {
    const result = calculatePositionSize(healthyAccount, defaultSettings, 50_000, 50_000);
    expect(result.valid).toBe(false);
  });

  it('returns invalid when stop is too close (<0.1%)', () => {
    const result = calculatePositionSize(
      healthyAccount, defaultSettings,
      50_000, 49_990, // only $10 away = 0.02%
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Stop too close');
  });

  it('riskAmount is exactly 1% of balance', () => {
    const result = calculatePositionSize(healthyAccount, defaultSettings, 50_000, 48_000);
    expect(result.riskAmount).toBeCloseTo(100, 0);
    expect(result.riskPercent).toBeCloseTo(0.01, 3);
  });

  it('scales with different risk percentages', () => {
    const result2pct = calculatePositionSize(
      healthyAccount,
      { ...defaultSettings, riskPerTradePercent: 0.02 },
      50_000, 49_000,
    );
    expect(result2pct.riskAmount).toBeCloseTo(200, 0);
    expect(result2pct.size).toBeCloseTo(0.2, 2);
  });
});

// =============================================================================
describe('Trading Hours', () => {
  it('returns true for 00:00–23:59 (always open)', () => {
    const now = new Date();
    expect(isWithinTradingHours('00:00', '23:59', now)).toBe(true);
  });

  it('returns true when current time is within window', () => {
    const noon = new Date();
    noon.setUTCHours(12, 0, 0, 0);
    expect(isWithinTradingHours('09:00', '17:00', noon)).toBe(true);
  });

  it('returns false when outside window', () => {
    const midnight = new Date();
    midnight.setUTCHours(2, 0, 0, 0);
    expect(isWithinTradingHours('09:00', '17:00', midnight)).toBe(false);
  });

  it('handles overnight windows (22:00–02:00)', () => {
    const elevenPM = new Date();
    elevenPM.setUTCHours(23, 0, 0, 0);
    expect(isWithinTradingHours('22:00', '02:00', elevenPM)).toBe(true);

    const oneAM = new Date();
    oneAM.setUTCHours(1, 0, 0, 0);
    expect(isWithinTradingHours('22:00', '02:00', oneAM)).toBe(true);

    const noonUTC = new Date();
    noonUTC.setUTCHours(12, 0, 0, 0);
    expect(isWithinTradingHours('22:00', '02:00', noonUTC)).toBe(false);
  });
});
