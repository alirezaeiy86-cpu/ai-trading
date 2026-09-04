import type { RiskSettings } from '@trading/types';
import type { AccountState, PositionSizeResult } from './types';

// =============================================================================
// POSITION SIZING
// Uses risk-based sizing: the position size is calculated from the risk amount
// and stop-loss distance — NOT from a fixed dollar amount.
//
// Formula:
//   riskAmount    = balance × riskPerTradePercent
//   stopDistance  = |entry - stopLoss|
//   rawSize       = riskAmount / stopDistance
//   adjustedSize  = rawSize × (1 - feeRate) × (1 - slippagePct)
//   finalSize     = min(adjustedSize, maxPositionSize)
// =============================================================================

const FEE_RATE      = 0.001;   // 0.1% taker fee (Binance default)
const SLIPPAGE_PCT  = 0.0005;  // 0.05% slippage estimate
const MIN_STOP_PCT  = 0.001;   // 0.1% minimum stop distance

export function calculatePositionSize(
  account:    AccountState,
  settings:   RiskSettings,
  entryPrice: number,
  stopLoss:   number,
): PositionSizeResult {
  const invalid = (reason: string): PositionSizeResult => ({
    size: 0, riskAmount: 0, riskPercent: 0,
    stopDistance: 0, fees: 0, valid: false, reason,
  });

  if (entryPrice <= 0) return invalid('Invalid entry price');
  if (stopLoss  <= 0) return invalid('Invalid stop loss');
  if (account.balance <= 0) return invalid('No account balance');

  const stopDistance = Math.abs(entryPrice - stopLoss);
  if (stopDistance === 0) return invalid('Stop loss equals entry price');

  // Minimum stop distance check
  const stopDistPct = stopDistance / entryPrice;
  if (stopDistPct < MIN_STOP_PCT) {
    return invalid(
      `Stop too close (${(stopDistPct * 100).toFixed(3)}% < ${MIN_STOP_PCT * 100}% minimum)`,
    );
  }

  const riskAmount  = account.balance * settings.riskPerTradePercent;
  const riskPercent = settings.riskPerTradePercent;

  if (riskAmount > account.availableBalance) {
    return invalid('Insufficient available balance for this trade');
  }

  // Raw size before fees/slippage
  const rawSize = riskAmount / stopDistance;

  // Adjust for fees and slippage
  const adjustedSize = rawSize * (1 - FEE_RATE) * (1 - SLIPPAGE_PCT);

  // Check leverage
  const notional  = adjustedSize * entryPrice;
  const leverage  = notional / account.availableBalance;
  if (leverage > settings.maxLeverage) {
    const maxSize = (account.availableBalance * settings.maxLeverage) / entryPrice;
    // Reduce to max leverage — but this also reduces the risk amount
    const cappedSize  = Math.min(adjustedSize, maxSize);
    const cappedRisk  = cappedSize * stopDistance;
    const fees        = notional * FEE_RATE;
    return {
      size:         Math.max(0, cappedSize),
      riskAmount:   cappedRisk,
      riskPercent:  cappedRisk / account.balance,
      stopDistance,
      fees,
      valid:        cappedSize > 0,
      reason:       cappedSize > 0 ? undefined : 'Position size too small after leverage cap',
    };
  }

  const fees = notional * FEE_RATE;

  if (adjustedSize <= 0) return invalid('Calculated position size is zero or negative');

  return {
    size:        adjustedSize,
    riskAmount,
    riskPercent,
    stopDistance,
    fees,
    valid:       true,
  };
}

/**
 * Round a position size to exchange step size precision.
 * e.g. stepSize=0.001 → rounds to 3 decimal places
 */
export function roundToStepSize(size: number, stepSize: number): number {
  if (stepSize <= 0) return size;
  const precision = Math.round(-Math.log10(stepSize));
  return Math.floor(size / stepSize) * stepSize;
}
