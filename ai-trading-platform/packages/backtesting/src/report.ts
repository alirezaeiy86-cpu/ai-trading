import type { BacktestResult } from './types';

// =============================================================================
// BACKTEST REPORT FORMATTER
// Converts BacktestResult into a structured text report.
// Used for logging and the API response.
// =============================================================================

export function formatBacktestReport(result: BacktestResult): string {
  if (result.status === 'FAILED') {
    return `BACKTEST FAILED\nStrategy: ${result.config.strategyName}\nError: ${result.error ?? 'Unknown error'}`;
  }

  const r = result;
  const pct = (v: number): string => `${(v * 100).toFixed(2)}%`;
  const usd = (v: number): string => `$${v.toFixed(2)}`;
  const num = (v: number, d = 2): string => v.toFixed(d);

  const durationDays = Math.round(
    (r.config.endDate.getTime() - r.config.startDate.getTime()) / 86_400_000,
  );

  const lines: string[] = [
    '═══════════════════════════════════════════════════════════════',
    ' BACKTEST REPORT',
    '═══════════════════════════════════════════════════════════════',
    '',
    ` Strategy  : ${r.config.strategyName}`,
    ` Symbol    : ${r.config.symbol}`,
    ` Timeframe : ${r.config.timeframe}`,
    ` Period    : ${r.config.startDate.toISOString().slice(0, 10)} → ${r.config.endDate.toISOString().slice(0, 10)} (${durationDays}d)`,
    ` Capital   : ${usd(r.config.initialBalance)}`,
    '',
    '── PERFORMANCE ─────────────────────────────────────────────────',
    '',
    ` Net P&L         : ${usd(r.netPnl)} (${pct(r.netPnlPercent)})`,
    ` Total Fees      : ${usd(r.totalFees)}`,
    ` Final Balance   : ${usd(r.config.initialBalance + r.netPnl)}`,
    '',
    '── TRADES ───────────────────────────────────────────────────────',
    '',
    ` Total Trades    : ${r.totalTrades}`,
    ` Winning         : ${r.winningTrades} (${pct(r.winRate)})`,
    ` Losing          : ${r.losingTrades} (${pct(1 - r.winRate)})`,
    ` Largest Win     : ${usd(r.largestWin)}`,
    ` Largest Loss    : ${usd(r.largestLoss)}`,
    ` Avg Win         : ${usd(r.avgWin)}`,
    ` Avg Loss        : ${usd(r.avgLoss)}`,
    ` Avg Trade       : ${usd(r.avgTrade)}`,
    ` Avg R           : ${num(r.avgR, 3)}R`,
    '',
    '── RISK ─────────────────────────────────────────────────────────',
    '',
    ` Max Drawdown    : ${usd(r.maxDrawdown)} (${pct(r.maxDrawdownPct)})`,
    ` Profit Factor   : ${r.profitFactor === Infinity ? '∞' : num(r.profitFactor)}`,
    ` Sharpe Ratio    : ${num(r.sharpeRatio)}`,
    ` Calmar Ratio    : ${num(r.calmarRatio)}`,
    ` Expectancy/Trade: ${usd(r.expectancy)}`,
    '',
    '─────────────────────────────────────────────────────────────────',
    '',
    ' ⚠  Backtest results do not guarantee future performance.',
    ' ⚠  Always validate on out-of-sample data before live trading.',
    '',
    '═══════════════════════════════════════════════════════════════',
  ];

  return lines.join('\n');
}

/**
 * Convert BacktestResult to a JSON-serialisable object suitable
 * for storing in the database or sending via API.
 */
export function serializeBacktestResult(result: BacktestResult): Record<string, unknown> {
  return {
    status:          result.status,
    error:           result.error,
    startedAt:       result.startedAt.toISOString(),
    completedAt:     result.completedAt.toISOString(),

    totalTrades:     result.totalTrades,
    winningTrades:   result.winningTrades,
    losingTrades:    result.losingTrades,
    winRate:         result.winRate,
    netPnl:          result.netPnl,
    netPnlPercent:   result.netPnlPercent,
    profitFactor:    isFinite(result.profitFactor) ? result.profitFactor : null,
    avgR:            result.avgR,
    maxDrawdown:     result.maxDrawdown,
    maxDrawdownPct:  result.maxDrawdownPct,
    largestWin:      result.largestWin,
    largestLoss:     result.largestLoss,
    avgWin:          result.avgWin,
    avgLoss:         result.avgLoss,
    avgTrade:        result.avgTrade,
    totalFees:       result.totalFees,
    sharpeRatio:     result.sharpeRatio,
    calmarRatio:     result.calmarRatio,
    expectancy:      result.expectancy,

    // Compact equity curve for chart rendering
    equityCurve: result.equityCurve.map((p) => ({
      date:     p.date.toISOString(),
      equity:   Math.round(p.equity * 100) / 100,
      drawdown: Math.round(p.drawdown * 10000) / 10000,
    })),

    // Trade list (compact)
    trades: result.trades.map((t) => ({
      id:          t.id,
      entryDate:   t.entryDate.toISOString(),
      exitDate:    t.exitDate.toISOString(),
      side:        t.side,
      entryPrice:  t.entryPrice,
      exitPrice:   t.exitPrice,
      quantity:    t.quantity,
      pnl:         Math.round(t.pnl * 100) / 100,
      pnlR:        Math.round(t.pnlR * 100) / 100,
      fees:        Math.round(t.fees * 100) / 100,
      closeReason: t.closeReason,
      regime:      t.marketRegime,
    })),
  };
}
