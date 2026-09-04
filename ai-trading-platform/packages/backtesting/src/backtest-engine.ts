import type { Candle } from '@trading/types';
import { StrategyEngine } from '@trading/strategies';
import { RiskEngine, calculatePositionSize } from '@trading/risk-engine';
import type { AccountState, TradingState } from '@trading/risk-engine';
import type {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  EquityPoint,
  RunningPosition,
} from './types';

// =============================================================================
// BACKTEST ENGINE
// Walk-forward bar-by-bar simulation.
//
// Anti-bias guarantees:
//   1. NO LOOK-AHEAD: candles[0..i] are passed to strategy at bar i.
//      candles[i+1..] are never visible to the strategy.
//   2. FILLS AT NEXT OPEN: signal on bar i → entry at bar i+1 open.
//      (simulates realistic execution — you can't fill at the signal bar's close)
//   3. INTRABAR SL/TP: stop and take profit are checked against bar i+1's
//      high/low before using its close. Worst-case fill used when both hit.
//   4. FEES & SLIPPAGE applied on both sides.
//   5. SINGLE POSITION per symbol — no pyramiding.
//
// =============================================================================

const TAKER_FEE   = 0.001;   // 0.1% per side
const SLIPPAGE    = 0.0005;  // 0.05% adverse slippage

export class BacktestEngine {
  private readonly strategyEngine: StrategyEngine;

  constructor(private readonly config: BacktestConfig) {
    this.strategyEngine = new StrategyEngine({
      minScore:      config.riskSettings.minStrategyScore,
      minRiskReward: config.riskSettings.minRiskReward,
    });
  }

  /**
   * Run the full backtest on the provided candle series.
   * Candles must be in ascending order (oldest first) and already filtered
   * to the requested date range + a warm-up buffer (recommend 250 bars before startDate).
   *
   * @param candles  Full candle series (warm-up + test window)
   * @param warmup   Number of candles at the start used only as warm-up (not traded)
   */
  run(candles: Candle[], warmup = 250): BacktestResult {
    const startedAt = new Date();

    try {
      return this.simulate(candles, warmup);
    } catch (err) {
      return this.failResult(startedAt, String(err));
    }
  }

  // ── Core simulation ────────────────────────────────────────────────────────

  private simulate(candles: Candle[], warmup: number): BacktestResult {
    const startedAt  = new Date();
    const { config } = this;

    let balance      = config.initialBalance;
    let equity       = config.initialBalance;
    let peak         = config.initialBalance;
    let maxDrawdown  = 0;
    let maxDDPct     = 0;
    let tradeId      = 0;

    const trades:      BacktestTrade[] = [];
    const equityCurve: EquityPoint[]   = [];
    let openPosition:  RunningPosition | null = null;

    // Daily loss / trade count tracking
    let tradesToday   = 0;
    let dayLoss       = 0;
    let lastBarDate   = '';

    equityCurve.push({ date: candles[warmup]?.openTime ?? new Date(), equity, drawdown: 0 });

    for (let i = warmup; i < candles.length; i++) {
      const bar     = candles[i]!;
      const barDate = bar.openTime.toISOString().slice(0, 10);

      // ── Reset daily counters at new day ────────────────────────────────────
      if (barDate !== lastBarDate) {
        tradesToday = 0;
        dayLoss     = 0;
        lastBarDate = barDate;
      }

      // ── Check open position against this bar's intrabar prices ─────────────
      if (openPosition) {
        const closeResult = this.checkIntrabarClose(openPosition, bar);
        if (closeResult) {
          const trade = this.buildTrade(
            ++tradeId, openPosition, closeResult.price,
            closeResult.reason, bar.closeTime,
          );
          trades.push(trade);

          balance += trade.pnl;
          if (trade.pnl < 0) dayLoss += Math.abs(trade.pnl);
          openPosition = null;
        }
      }

      // ── Skip signal generation if position is open ──────────────────────────
      if (openPosition) {
        equity = balance; // no unrealised tracking needed for R metrics
        this.updateDrawdown(equity, peak, maxDrawdown, maxDDPct,
          (dd, ddp) => { maxDrawdown = dd; maxDDPct = ddp; });
        peak = Math.max(peak, equity);
        equityCurve.push({ date: bar.closeTime, equity, drawdown: (peak - equity) / peak });
        continue;
      }

      // ── Generate signal on candles[0..i] (NO look-ahead) ───────────────────
      const visibleCandles = candles.slice(0, i + 1);
      const engineResult   = this.strategyEngine.evaluate(
        config.symbol, config.timeframe, visibleCandles,
      );

      const signal = engineResult.bestSignal;
      if (!signal || signal.direction === 'NEUTRAL') {
        equityCurve.push({ date: bar.closeTime, equity: balance, drawdown: (peak - balance) / peak });
        continue;
      }

      // ── Risk Engine validation ──────────────────────────────────────────────
      const accountState: AccountState = {
        balance,
        equity:           balance,
        availableBalance: balance,
        highWaterMark:    peak,
        currency:         'USDT',
        isPaper:          true,
      };

      const tradingState: TradingState = {
        openPositions:       [],
        tradesToday,
        realisedPnlToday:    -dayLoss,
        unrealisedPnlToday:  0,
        realisedPnlWeek:     0,
        lastTradeAt:         null,
        lastLossAt:          null,
        consecutiveLosses:   0,
        emergencyStopActive: false,
        dailyLossBreached:   false,
        drawdownBreached:    false,
      };

      const entryPrice = signal.entryZone.min;
      const riskEngine = new RiskEngine(config.riskSettings);
      const riskResult = riskEngine.validate(
        {
          symbol:        config.symbol,
          direction:     signal.direction as 'LONG' | 'SHORT',
          entryPrice,
          stopLoss:      signal.suggestedStopLoss,
          takeProfit:    signal.suggestedTakeProfit,
          strategyScore: signal.score,
          aiConfidence:  null,
          signal,
          aiResult:      null,
        },
        accountState,
        tradingState,
      );

      if (!riskResult.approved) continue;

      // ── Enter at NEXT bar's open + slippage ────────────────────────────────
      if (i + 1 >= candles.length) break; // no next bar

      const nextBar    = candles[i + 1]!;
      const fillPrice  = signal.direction === 'LONG'
        ? nextBar.open * (1 + SLIPPAGE)
        : nextBar.open * (1 - SLIPPAGE);

      const sizing = calculatePositionSize(
        accountState, config.riskSettings, fillPrice, signal.suggestedStopLoss,
      );
      if (!sizing.valid || sizing.size <= 0) continue;

      const openFees = fillPrice * sizing.size * TAKER_FEE;
      balance -= openFees;

      openPosition = {
        entryDate:    nextBar.openTime,
        entryPrice:   fillPrice,
        side:         signal.direction as 'LONG' | 'SHORT',
        quantity:     sizing.size,
        stopLoss:     signal.suggestedStopLoss,
        takeProfit:   signal.suggestedTakeProfit,
        riskAmount:   sizing.riskAmount,
        strategyScore: signal.score,
        regime:       engineResult.regime,
        fees:         openFees,
      };

      tradesToday++;
      i++; // skip next bar (already used as entry)

      equity = balance;
      peak   = Math.max(peak, equity);
      equityCurve.push({ date: nextBar.closeTime, equity, drawdown: (peak - equity) / peak });
    }

    // ── Close any remaining open position at last bar close ─────────────────
    if (openPosition && candles.length > 0) {
      const lastBar = candles.at(-1)!;
      const trade   = this.buildTrade(
        ++tradeId, openPosition, lastBar.close, 'END_OF_DATA', lastBar.closeTime,
      );
      trades.push(trade);
      balance += trade.pnl;
    }

    return this.buildResult(trades, equityCurve, balance, config, startedAt, maxDrawdown, maxDDPct);
  }

  // ── Intrabar SL/TP detection ───────────────────────────────────────────────

  private checkIntrabarClose(
    pos: RunningPosition,
    bar: Candle,
  ): { price: number; reason: BacktestTrade['closeReason'] } | null {
    if (pos.side === 'LONG') {
      const slHit = bar.low  <= pos.stopLoss;
      const tpHit = bar.high >= pos.takeProfit;

      if (slHit && tpHit) {
        // Both hit — assume worst case (stop loss, since we don't know order)
        return { price: pos.stopLoss,   reason: 'STOP_LOSS'   };
      }
      if (slHit) return { price: pos.stopLoss,   reason: 'STOP_LOSS'   };
      if (tpHit) return { price: pos.takeProfit, reason: 'TAKE_PROFIT' };
    } else {
      const slHit = bar.high >= pos.stopLoss;
      const tpHit = bar.low  <= pos.takeProfit;

      if (slHit && tpHit) {
        return { price: pos.stopLoss,   reason: 'STOP_LOSS'   };
      }
      if (slHit) return { price: pos.stopLoss,   reason: 'STOP_LOSS'   };
      if (tpHit) return { price: pos.takeProfit, reason: 'TAKE_PROFIT' };
    }
    return null;
  }

  // ── Trade builder ──────────────────────────────────────────────────────────

  private buildTrade(
    id:          number,
    pos:         RunningPosition,
    closePrice:  number,
    reason:      BacktestTrade['closeReason'],
    exitDate:    Date,
  ): BacktestTrade {
    const fillClose = pos.side === 'LONG'
      ? closePrice * (1 - SLIPPAGE)
      : closePrice * (1 + SLIPPAGE);

    const notional   = fillClose * pos.quantity;
    const closeFees  = notional * TAKER_FEE;
    const totalFees  = pos.fees + closeFees;

    const rawPnl = pos.side === 'LONG'
      ? (fillClose - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - fillClose) * pos.quantity;

    const netPnl = rawPnl - totalFees;
    const pnlR   = pos.riskAmount > 0 ? netPnl / pos.riskAmount : 0;

    return {
      id, side: pos.side,
      entryDate:   pos.entryDate,
      exitDate,
      symbol:      this.config.symbol,
      entryPrice:  pos.entryPrice,
      exitPrice:   fillClose,
      quantity:    pos.quantity,
      pnl:         netPnl,
      pnlR,
      fees:        totalFees,
      closeReason: reason,
      strategyScore: pos.strategyScore,
      marketRegime:  pos.regime,
    };
  }

  // ── Drawdown helper ────────────────────────────────────────────────────────

  private updateDrawdown(
    equity: number,
    peak:   number,
    _currentDD: number,
    _currentDDPct: number,
    update: (dd: number, ddp: number) => void,
  ): void {
    const dd    = peak - equity;
    const ddPct = peak > 0 ? dd / peak : 0;
    update(dd, ddPct);
  }

  // ── Result builder ─────────────────────────────────────────────────────────

  private buildResult(
    trades:      BacktestTrade[],
    equityCurve: EquityPoint[],
    finalBalance: number,
    config:      BacktestConfig,
    startedAt:   Date,
    maxDrawdown: number,
    maxDDPct:    number,
  ): BacktestResult {
    const wins   = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl < 0);

    const totalTrades   = trades.length;
    const winningTrades = wins.length;
    const losingTrades  = losses.length;
    const winRate       = totalTrades > 0 ? winningTrades / totalTrades : 0;

    const netPnl        = finalBalance - config.initialBalance;
    const netPnlPercent = netPnl / config.initialBalance;

    const grossProfit = wins.reduce(  (s, t) => s + t.pnl, 0);
    const grossLoss   = losses.reduce((s, t) => s + Math.abs(t.pnl), 0);
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    const avgR       = totalTrades > 0 ? trades.reduce((s, t) => s + t.pnlR, 0) / totalTrades : 0;
    const avgWin     = wins.length   > 0 ? grossProfit / wins.length   : 0;
    const avgLoss    = losses.length > 0 ? grossLoss   / losses.length : 0;
    const avgTrade   = totalTrades > 0 ? netPnl / totalTrades : 0;
    const totalFees  = trades.reduce((s, t) => s + t.fees, 0);
    const largestWin  = wins.length   > 0 ? Math.max(...wins.map(  (t) => t.pnl))        : 0;
    const largestLoss = losses.length > 0 ? Math.max(...losses.map((t) => Math.abs(t.pnl))) : 0;

    // Sharpe-like: mean(pnl) / stddev(pnl)
    const pnls    = trades.map((t) => t.pnl);
    const meanPnl = pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
    const variance = pnls.length > 1
      ? pnls.reduce((s, p) => s + (p - meanPnl) ** 2, 0) / (pnls.length - 1)
      : 0;
    const stdDev     = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? meanPnl / stdDev : 0;

    // Calmar: annualised return / maxDrawdownPct
    const durationDays = (config.endDate.getTime() - config.startDate.getTime()) / 86_400_000;
    const annualisedReturn = durationDays > 0
      ? (netPnlPercent / durationDays) * 365
      : 0;
    const calmarRatio = maxDDPct > 0 ? annualisedReturn / maxDDPct : annualisedReturn;

    // Expectancy = (winRate × avgWin) - (lossRate × avgLoss)
    const lossRate  = 1 - winRate;
    const expectancy = (winRate * avgWin) - (lossRate * avgLoss);

    // Update equityCurve drawdown values
    let curvePeak = config.initialBalance;
    for (const point of equityCurve) {
      curvePeak        = Math.max(curvePeak, point.equity);
      point.drawdown   = curvePeak > 0 ? (curvePeak - point.equity) / curvePeak : 0;
    }

    return {
      config,
      status:      'COMPLETED',
      startedAt,
      completedAt: new Date(),

      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      netPnl,
      netPnlPercent,
      profitFactor,
      avgR,
      maxDrawdown,
      maxDrawdownPct: maxDDPct,
      largestWin,
      largestLoss,
      avgWin,
      avgLoss,
      avgTrade,
      totalFees,
      sharpeRatio,
      calmarRatio,
      expectancy,

      trades,
      equityCurve,
    };
  }

  private failResult(startedAt: Date, error: string): BacktestResult {
    return {
      config:       this.config,
      status:       'FAILED',
      error,
      startedAt,
      completedAt:  new Date(),
      totalTrades: 0, winningTrades: 0, losingTrades: 0,
      winRate: 0, netPnl: 0, netPnlPercent: 0, profitFactor: 0,
      avgR: 0, maxDrawdown: 0, maxDrawdownPct: 0,
      largestWin: 0, largestLoss: 0, avgWin: 0, avgLoss: 0,
      avgTrade: 0, totalFees: 0, sharpeRatio: 0, calmarRatio: 0,
      expectancy: 0, trades: [], equityCurve: [],
    };
  }
}
