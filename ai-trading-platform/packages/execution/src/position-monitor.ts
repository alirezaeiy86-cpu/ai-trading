import type { Logger } from 'pino';
import { PositionRepo, PaperAccountRepo, SystemEventRepo } from '@trading/database';
import type { ExecutionProvider } from './execution-provider.interface';

// =============================================================================
// POSITION MONITOR
// Runs on every position-monitoring job cycle (every 60 seconds).
// For each open position:
//   1. Fetch current market price
//   2. Update unrealised P&L
//   3. Check stop loss hit
//   4. Check take profit hit
//   5. Check trailing stop (Phase 8+)
//   6. Update paper account equity
//
// The monitor never places orders — it delegates to ExecutionProvider.closeTrade().
// =============================================================================

export type PriceFetcher = (symbol: string) => Promise<number>;

export class PositionMonitor {
  constructor(
    private readonly provider:     ExecutionProvider,
    private readonly getPrice:     PriceFetcher,
    private readonly logger:       Logger,
  ) {}

  /**
   * Run one monitoring cycle across all open positions.
   * Returns the number of positions that were closed.
   */
  async run(isPaper: boolean): Promise<number> {
    const positions = await PositionRepo.getOpenPositions(isPaper);
    if (positions.length === 0) return 0;

    let closed = 0;

    for (const position of positions) {
      try {
        const currentPrice = await this.getPrice(position.symbol);

        // ── Update unrealised P&L ─────────────────────────────────────────
        const unrealisedPnl = position.side === 'LONG'
          ? (currentPrice - position.entryPrice) * position.quantity - position.fees
          : (position.entryPrice - currentPrice) * position.quantity - position.fees;

        await PositionRepo.updatePosition(position.id, {
          currentPrice,
          unrealisedPnl,
        });

        // ── Stop loss check ───────────────────────────────────────────────
        const slHit = position.side === 'LONG'
          ? currentPrice <= position.stopLoss
          : currentPrice >= position.stopLoss;

        if (slHit) {
          this.logger.warn({
            positionId: position.id,
            symbol:     position.symbol,
            side:       position.side,
            stopLoss:   position.stopLoss,
            currentPrice,
          }, 'Stop loss triggered');

          const result = await this.provider.closeTrade({
            positionId:  position.id,
            closePrice:  position.stopLoss,   // fill at stop price
            closeReason: 'STOP_LOSS',
          });

          if (result.success) {
            closed++;
            await SystemEventRepo.logEvent({
              type:    'STOP_LOSS_HIT',
              level:   'warn',
              message: `🛑 Stop loss hit: ${position.side} ${position.symbol} @ ${position.stopLoss.toFixed(2)}`,
              data: { positionId: position.id, symbol: position.symbol, currentPrice },
            });
          }
          continue; // skip TP check — position is closed
        }

        // ── Take profit check ─────────────────────────────────────────────
        const tpHit = position.side === 'LONG'
          ? currentPrice >= position.takeProfit
          : currentPrice <= position.takeProfit;

        if (tpHit) {
          this.logger.info({
            positionId:  position.id,
            symbol:      position.symbol,
            side:        position.side,
            takeProfit:  position.takeProfit,
            currentPrice,
          }, 'Take profit triggered');

          const result = await this.provider.closeTrade({
            positionId:  position.id,
            closePrice:  position.takeProfit,
            closeReason: 'TAKE_PROFIT',
          });

          if (result.success) {
            closed++;
            await SystemEventRepo.logEvent({
              type:    'TAKE_PROFIT_HIT',
              level:   'info',
              message: `🎯 Take profit hit: ${position.side} ${position.symbol} @ ${position.takeProfit.toFixed(2)}`,
              data: { positionId: position.id, symbol: position.symbol, currentPrice },
            });
          }
        }
      } catch (err) {
        this.logger.error({ err, positionId: position.id }, 'Position monitor error');
      }
    }

    // Update paper account equity after all price updates
    if (isPaper) {
      await this.syncEquity(isPaper);
    }

    return closed;
  }

  /** Sync paper account equity = balance + total unrealised PnL */
  private async syncEquity(isPaper: boolean): Promise<void> {
    const openPositions = await PositionRepo.getOpenPositions(isPaper);
    const unrealised    = openPositions.reduce((s, p) => s + p.unrealisedPnl, 0);
    const account       = await PaperAccountRepo.getPaperAccount();
    await PaperAccountRepo.updatePaperAccount({
      equity: account.currentBalance + unrealised,
    });
  }
}
