import type { RiskSettings } from '@trading/types';
import type {
  AccountState,
  TradingState,
  TradeProposal,
  RiskCheckResult,
  RiskValidationOutput,
  RejectionCode,
} from './types';
import { calculatePositionSize } from './position-sizing';
import { isWithinTradingHours, isAlwaysOpen } from './trading-hours';

// =============================================================================
// RISK ENGINE
// The highest-priority component in the system.
// Has absolute veto power over Strategy Engine and AI Engine.
// AI cannot override Risk Engine decisions.
//
// Validation order (fail-fast where critical, collect all for transparency):
//   1.  Emergency stop / system state
//   2.  Account balance / margin
//   3.  Daily / weekly loss limits
//   4.  Max drawdown
//   5.  Trade count limits
//   6.  Open position limits
//   7.  Cooldown periods
//   8.  Consecutive losses
//   9.  Direction restrictions
//  10.  Symbol allowlist
//  11.  Trading hours
//  12.  Existing position check
//  13.  Profit target check
//  14.  Signal quality (strategy score)
//  15.  AI confidence
//  16.  Risk/reward ratio
//  17.  Stop loss validity
//  18.  Take profit validity
//  19.  Position sizing
//  20.  Leverage
// =============================================================================

export class RiskEngine {
  constructor(private readonly settings: RiskSettings) {}

  /**
   * The main validation entry point.
   * Returns a full RiskValidationOutput — approved=true only if ALL checks pass.
   */
  validate(
    proposal:  TradeProposal,
    account:   AccountState,
    state:     TradingState,
  ): RiskValidationOutput {
    const rejections: Array<{ code: RejectionCode; reason: string }> = [];

    const reject = (code: RejectionCode, reason: string): RiskCheckResult => {
      rejections.push({ code, reason });
      return { passed: false, code, reason };
    };

    const pass = (): RiskCheckResult => ({ passed: true });

    // ── 1. Emergency stop ────────────────────────────────────────────────────
    this.check(
      () => !state.emergencyStopActive,
      () => reject('EMERGENCY_STOP', 'Emergency stop is active — no new trades'),
      () => pass(),
    );

    // ── 2. Account balance ───────────────────────────────────────────────────
    this.check(
      () => account.balance > 0,
      () => reject('INSUFFICIENT_BALANCE', 'Account balance is zero or negative'),
      () => pass(),
    );

    this.check(
      () => account.availableBalance > 0,
      () => reject('INSUFFICIENT_BALANCE', 'No available balance for new positions'),
      () => pass(),
    );

    // ── 3. Daily loss limit ──────────────────────────────────────────────────
    const totalDayPnl = state.realisedPnlToday + state.unrealisedPnlToday;
    const dayLossPct  = totalDayPnl < 0
      ? Math.abs(totalDayPnl) / account.balance
      : 0;

    this.check(
      () => dayLossPct < this.settings.maxDailyLossPercent,
      () => reject(
        'DAILY_LOSS_LIMIT',
        `Daily loss ${(dayLossPct * 100).toFixed(2)}% ≥ limit ${(this.settings.maxDailyLossPercent * 100).toFixed(2)}%`,
      ),
      () => pass(),
    );

    // ── 4. Weekly loss limit ─────────────────────────────────────────────────
    const weekLossPct = state.realisedPnlWeek < 0
      ? Math.abs(state.realisedPnlWeek) / account.balance
      : 0;

    this.check(
      () => weekLossPct < this.settings.maxWeeklyLossPercent,
      () => reject(
        'WEEKLY_LOSS_LIMIT',
        `Weekly loss ${(weekLossPct * 100).toFixed(2)}% ≥ limit ${(this.settings.maxWeeklyLossPercent * 100).toFixed(2)}%`,
      ),
      () => pass(),
    );

    // ── 5. Max drawdown ──────────────────────────────────────────────────────
    const drawdownPct = account.highWaterMark > 0
      ? (account.highWaterMark - account.equity) / account.highWaterMark
      : 0;

    this.check(
      () => drawdownPct < this.settings.maxDrawdownPercent,
      () => reject(
        'MAX_DRAWDOWN',
        `Drawdown ${(drawdownPct * 100).toFixed(2)}% ≥ max ${(this.settings.maxDrawdownPercent * 100).toFixed(2)}%`,
      ),
      () => pass(),
    );

    // ── 6. Max trades today ──────────────────────────────────────────────────
    this.check(
      () => state.tradesToday < this.settings.maxTradesPerDay,
      () => reject(
        'MAX_TRADES_TODAY',
        `${state.tradesToday}/${this.settings.maxTradesPerDay} trades used today`,
      ),
      () => pass(),
    );

    // ── 7. Max open positions ────────────────────────────────────────────────
    this.check(
      () => state.openPositions.length < this.settings.maxOpenPositions,
      () => reject(
        'MAX_OPEN_POSITIONS',
        `${state.openPositions.length}/${this.settings.maxOpenPositions} positions open`,
      ),
      () => pass(),
    );

    // ── 8. Cooldown after any trade ──────────────────────────────────────────
    if (state.lastTradeAt && this.settings.cooldownAfterTradeMs > 0) {
      const elapsed = Date.now() - state.lastTradeAt.getTime();
      this.check(
        () => elapsed >= this.settings.cooldownAfterTradeMs,
        () => reject(
          'COOLDOWN_AFTER_TRADE',
          `Cooldown active — ${Math.ceil((this.settings.cooldownAfterTradeMs - elapsed) / 1000)}s remaining`,
        ),
        () => pass(),
      );
    }

    // ── 9. Cooldown after loss ───────────────────────────────────────────────
    if (state.lastLossAt && this.settings.cooldownAfterLossMs > 0) {
      const elapsed = Date.now() - state.lastLossAt.getTime();
      this.check(
        () => elapsed >= this.settings.cooldownAfterLossMs,
        () => reject(
          'COOLDOWN_AFTER_LOSS',
          `Post-loss cooldown — ${Math.ceil((this.settings.cooldownAfterLossMs - elapsed) / 1000)}s remaining`,
        ),
        () => pass(),
      );
    }

    // ── 10. Direction restrictions ───────────────────────────────────────────
    if (proposal.direction === 'LONG') {
      this.check(
        () => this.settings.longEnabled,
        () => reject('DIRECTION_DISABLED', 'Long trades are disabled in settings'),
        () => pass(),
      );
    } else if (proposal.direction === 'SHORT') {
      this.check(
        () => this.settings.shortEnabled,
        () => reject('DIRECTION_DISABLED', 'Short trades are disabled in settings'),
        () => pass(),
      );
    }

    // ── 11. Symbol allowlist ─────────────────────────────────────────────────
    if (this.settings.allowedSymbols.length > 0) {
      this.check(
        () => this.settings.allowedSymbols.includes(proposal.symbol),
        () => reject(
          'SYMBOL_NOT_ALLOWED',
          `${proposal.symbol} is not in the allowed symbols list`,
        ),
        () => pass(),
      );
    }

    // ── 12. Trading hours ────────────────────────────────────────────────────
    if (!isAlwaysOpen(this.settings.tradingHoursStart, this.settings.tradingHoursEnd)) {
      this.check(
        () => isWithinTradingHours(this.settings.tradingHoursStart, this.settings.tradingHoursEnd),
        () => reject(
          'OUTSIDE_TRADING_HOURS',
          `Outside trading hours (${this.settings.tradingHoursStart}–${this.settings.tradingHoursEnd} UTC)`,
        ),
        () => pass(),
      );
    }

    // ── 13. No existing position in same symbol ──────────────────────────────
    this.check(
      () => !state.openPositions.some(
        (p) => p.symbol === proposal.symbol && p.status === 'OPEN',
      ),
      () => reject(
        'POSITION_ALREADY_OPEN',
        `Already have an open position in ${proposal.symbol}`,
      ),
      () => pass(),
    );

    // ── 14. Strategy score ───────────────────────────────────────────────────
    this.check(
      () => proposal.strategyScore >= this.settings.minStrategyScore,
      () => reject(
        'STRATEGY_SCORE_TOO_LOW',
        `Strategy score ${proposal.strategyScore} < required ${this.settings.minStrategyScore}`,
      ),
      () => pass(),
    );

    // ── 15. AI confidence ────────────────────────────────────────────────────
    if (this.settings.aiEnabled && proposal.aiConfidence !== null) {
      this.check(
        () => proposal.aiConfidence! >= this.settings.minAIConfidence,
        () => reject(
          'AI_CONFIDENCE_TOO_LOW',
          `AI confidence ${(proposal.aiConfidence! * 100).toFixed(0)}% < required ${(this.settings.minAIConfidence * 100).toFixed(0)}%`,
        ),
        () => pass(),
      );
    }

    // ── 16. Stop loss validity ───────────────────────────────────────────────
    const { entryPrice, stopLoss, takeProfit, direction } = proposal;

    this.check(
      () => stopLoss > 0,
      () => reject('INVALID_STOP_LOSS', 'Stop loss must be greater than zero'),
      () => pass(),
    );

    if (direction === 'LONG') {
      this.check(
        () => stopLoss < entryPrice,
        () => reject('INVALID_STOP_LOSS', `Stop loss ${stopLoss} must be below entry ${entryPrice} for LONG`),
        () => pass(),
      );
    } else {
      this.check(
        () => stopLoss > entryPrice,
        () => reject('INVALID_STOP_LOSS', `Stop loss ${stopLoss} must be above entry ${entryPrice} for SHORT`),
        () => pass(),
      );
    }

    // ── 17. Take profit validity ─────────────────────────────────────────────
    this.check(
      () => takeProfit > 0,
      () => reject('INVALID_TAKE_PROFIT', 'Take profit must be greater than zero'),
      () => pass(),
    );

    if (direction === 'LONG') {
      this.check(
        () => takeProfit > entryPrice,
        () => reject('INVALID_TAKE_PROFIT', `Take profit ${takeProfit} must be above entry ${entryPrice} for LONG`),
        () => pass(),
      );
    } else {
      this.check(
        () => takeProfit < entryPrice,
        () => reject('INVALID_TAKE_PROFIT', `Take profit ${takeProfit} must be below entry ${entryPrice} for SHORT`),
        () => pass(),
      );
    }

    // ── 18. Risk/reward ratio ────────────────────────────────────────────────
    const risk   = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    const rr     = risk > 0 ? reward / risk : 0;

    this.check(
      () => rr >= this.settings.minRiskReward,
      () => reject(
        'RISK_REWARD_TOO_LOW',
        `R:R ${rr.toFixed(2)} < required ${this.settings.minRiskReward}`,
      ),
      () => pass(),
    );

    // ── 19 & 20. Position sizing + leverage ──────────────────────────────────
    const sizing = calculatePositionSize(account, this.settings, entryPrice, stopLoss);

    if (!sizing.valid) {
      rejections.push({ code: 'POSITION_SIZE_TOO_SMALL', reason: sizing.reason ?? 'Position size invalid' });
    }

    // ── Result ───────────────────────────────────────────────────────────────
    const approved = rejections.length === 0 && sizing.valid;

    if (approved) {
      return {
        approved:            true,
        rejectionReasons:    [],
        positionSize:        sizing.size,
        riskAmount:          sizing.riskAmount,
        riskPercent:         sizing.riskPercent,
        adjustedStopLoss:    stopLoss,
        adjustedTakeProfit:  takeProfit,
        riskReward:          rr,
        fees:                sizing.fees,
      };
    }

    return {
      approved:         false,
      rejectionReasons: rejections,
    };
  }

  /**
   * Quick check — is the account in a state where any trading is permitted?
   * Used by the worker to skip strategy evaluation entirely when blocked.
   */
  canTrade(account: AccountState, state: TradingState): { ok: boolean; reason?: string } {
    if (state.emergencyStopActive) return { ok: false, reason: 'Emergency stop active' };

    const dayLossPct = (state.realisedPnlToday + state.unrealisedPnlToday) < 0
      ? Math.abs(state.realisedPnlToday + state.unrealisedPnlToday) / account.balance
      : 0;
    if (dayLossPct >= this.settings.maxDailyLossPercent) {
      return { ok: false, reason: `Daily loss limit reached (${(dayLossPct * 100).toFixed(2)}%)` };
    }

    const drawdownPct = account.highWaterMark > 0
      ? (account.highWaterMark - account.equity) / account.highWaterMark
      : 0;
    if (drawdownPct >= this.settings.maxDrawdownPercent) {
      return { ok: false, reason: `Max drawdown reached (${(drawdownPct * 100).toFixed(2)}%)` };
    }

    if (state.tradesToday >= this.settings.maxTradesPerDay) {
      return { ok: false, reason: `Max trades reached (${state.tradesToday}/${this.settings.maxTradesPerDay})` };
    }

    if (state.openPositions.length >= this.settings.maxOpenPositions) {
      return { ok: false, reason: `Max positions open (${state.openPositions.length}/${this.settings.maxOpenPositions})` };
    }

    return { ok: true };
  }

  /**
   * Check if the daily profit target has been reached.
   */
  isProfitTargetReached(
    settings:   RiskSettings & { dailyProfitTargetPercent?: number; dailyProfitTargetAmount?: number },
    account:    AccountState,
    todayPnl:   number,
  ): boolean {
    if (settings.dailyProfitTargetAmount && todayPnl >= settings.dailyProfitTargetAmount) {
      return true;
    }
    if (settings.dailyProfitTargetPercent && todayPnl / account.balance >= settings.dailyProfitTargetPercent) {
      return true;
    }
    return false;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private check(
    condition: () => boolean,
    onFail:    () => RiskCheckResult,
    onPass:    () => RiskCheckResult,
  ): RiskCheckResult {
    return condition() ? onPass() : onFail();
  }
}
