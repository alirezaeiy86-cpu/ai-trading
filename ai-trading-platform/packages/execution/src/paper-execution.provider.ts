import { randomUUID } from 'crypto';
import type { Logger } from 'pino';
import type { Position, CloseReason } from '@trading/types';
import {
  PositionRepo,
  OrderRepo,
  PaperAccountRepo,
  SystemEventRepo,
} from '@trading/database';
import type {
  ExecutionProvider,
  OpenTradeParams,
  CloseTradeParams,
  UpdateStopParams,
  ExecutionResult,
} from './execution-provider.interface';

// =============================================================================
// PAPER EXECUTION PROVIDER
// Simulates realistic order execution using real market data but virtual funds.
//
// Simulation includes:
//   - Market order slippage (configurable)
//   - Taker fees (0.1% per side)
//   - Realistic fill prices
//   - P&L tracking in the paper account
//   - Stop loss and take profit detection (via position monitor)
// =============================================================================

const TAKER_FEE_RATE = 0.001;   // 0.1%
const SLIPPAGE_PCT   = 0.0005;  // 0.05% adverse slippage on market orders

export class PaperExecutionProvider implements ExecutionProvider {
  readonly mode = 'paper' as const;

  constructor(private readonly logger: Logger) {}

  // ── Open a position ────────────────────────────────────────────────────────

  async openTrade(params: OpenTradeParams): Promise<ExecutionResult> {
    try {
      const {
        symbol, direction, entryPrice, quantity,
        stopLoss, takeProfit,
        strategyScore, aiConfidence, marketRegime,
        signalId, decisionLogId,
      } = params;

      // Simulate slippage — market order fills slightly worse than quoted
      const fillPrice = direction === 'LONG'
        ? entryPrice * (1 + SLIPPAGE_PCT)   // long fills higher
        : entryPrice * (1 - SLIPPAGE_PCT);   // short fills lower

      const notional = fillPrice * quantity;
      const openFees = notional * TAKER_FEE_RATE;

      // Verify paper account has enough balance
      const account = await PaperAccountRepo.getPaperAccount();
      if (account.currentBalance < notional + openFees) {
        return {
          success: false, positionId: null, orderId: null,
          error: `Insufficient balance: need $${(notional + openFees).toFixed(2)}, have $${account.currentBalance.toFixed(2)}`,
        };
      }

      // Create entry order
      const order = await OrderRepo.createOrder({
        symbol,
        side:     direction === 'LONG' ? 'BUY' : 'SELL',
        type:     'MARKET',
        quantity,
        price:    fillPrice,
        isPaper:  true,
      });

      // Fill the order immediately (paper trading)
      await OrderRepo.updateOrder(order.id, {
        status:        'FILLED',
        filledQuantity: quantity,
        avgFillPrice:  fillPrice,
        fees:          openFees,
        feeCurrency:   'USDT',
        filledAt:      new Date(),
        exchangeOrderId: `PAPER-${randomUUID().slice(0, 8).toUpperCase()}`,
      });

      // Create the position
      const position = await PositionRepo.createPosition({
        symbol,
        side:        direction,
        entryPrice:  fillPrice,
        quantity,
        stopLoss,
        takeProfit,
        isPaper:     true,
        fees:        openFees,
        strategyScore,
        aiConfidence: aiConfidence ?? undefined,
        marketRegimeAtEntry: marketRegime,
      });

      // Link order to position
      await OrderRepo.updateOrder(order.id, { status: 'FILLED' });

      // Deduct cost from paper balance
      await PaperAccountRepo.updatePaperAccount({
        currentBalance: account.currentBalance - openFees,
        // equity updated by position monitor
      });

      await SystemEventRepo.logEvent({
        type:    'POSITION_OPENED',
        level:   'info',
        message: `📈 ${direction} ${symbol} @ ${fillPrice.toFixed(2)} | qty=${quantity.toFixed(6)} | sl=${stopLoss.toFixed(2)} | tp=${takeProfit.toFixed(2)}`,
        data: {
          positionId:  position.id,
          symbol, direction,
          fillPrice,  quantity,
          stopLoss,   takeProfit,
          fees:        openFees,
          strategyScore, aiConfidence,
        },
      });

      this.logger.info({
        positionId: position.id,
        symbol, direction, fillPrice, quantity,
        sl: stopLoss, tp: takeProfit, fees: openFees,
      }, 'Paper position opened');

      return { success: true, positionId: position.id, orderId: order.id };
    } catch (err) {
      this.logger.error({ err, params }, 'Failed to open paper position');
      return { success: false, positionId: null, orderId: null, error: String(err) };
    }
  }

  // ── Close a position ───────────────────────────────────────────────────────

  async closeTrade(params: CloseTradeParams): Promise<ExecutionResult> {
    try {
      const { positionId, closePrice, closeReason } = params;

      const position = await PositionRepo.getPositionById(positionId);
      if (!position) {
        return { success: false, positionId, orderId: null, error: 'Position not found' };
      }
      if (position.status !== 'OPEN') {
        return { success: false, positionId, orderId: null, error: 'Position already closed' };
      }

      // Simulate close slippage
      const fillPrice = position.side === 'LONG'
        ? closePrice * (1 - SLIPPAGE_PCT)   // long closes slightly lower
        : closePrice * (1 + SLIPPAGE_PCT);   // short closes slightly higher

      const notional  = fillPrice * position.quantity;
      const closeFees = notional * TAKER_FEE_RATE;
      const totalFees = position.fees + closeFees;

      // Calculate realised P&L
      let rawPnl: number;
      if (position.side === 'LONG') {
        rawPnl = (fillPrice - position.entryPrice) * position.quantity;
      } else {
        rawPnl = (position.entryPrice - fillPrice) * position.quantity;
      }
      const realisedPnl = rawPnl - totalFees;

      // Create close order
      const order = await OrderRepo.createOrder({
        symbol:   position.symbol,
        side:     position.side === 'LONG' ? 'SELL' : 'BUY',
        type:     'MARKET',
        quantity: position.quantity,
        price:    fillPrice,
        isPaper:  true,
        positionId,
      });

      await OrderRepo.updateOrder(order.id, {
        status:         'FILLED',
        filledQuantity:  position.quantity,
        avgFillPrice:    fillPrice,
        fees:            closeFees,
        feeCurrency:     'USDT',
        filledAt:        new Date(),
        exchangeOrderId: `PAPER-${randomUUID().slice(0, 8).toUpperCase()}`,
      });

      // Close the position
      await PositionRepo.closePosition(positionId, realisedPnl, totalFees, closeReason);

      // Credit P&L to paper account
      const account = await PaperAccountRepo.getPaperAccount();
      const newBalance = account.currentBalance + notional + realisedPnl - closeFees;
      await PaperAccountRepo.updatePaperAccount({ currentBalance: newBalance });

      const emoji = realisedPnl > 0 ? '✅' : '❌';
      const eventType = closeReason === 'TAKE_PROFIT' ? 'TAKE_PROFIT_HIT'
        : closeReason === 'STOP_LOSS' ? 'STOP_LOSS_HIT'
        : 'POSITION_CLOSED';

      await SystemEventRepo.logEvent({
        type:    eventType as never,
        level:   realisedPnl > 0 ? 'info' : 'warn',
        message: `${emoji} CLOSED ${position.side} ${position.symbol} | PnL: ${realisedPnl >= 0 ? '+' : ''}$${realisedPnl.toFixed(2)} | Reason: ${closeReason}`,
        data: {
          positionId,
          symbol:      position.symbol,
          side:        position.side,
          entryPrice:  position.entryPrice,
          closePrice:  fillPrice,
          quantity:    position.quantity,
          realisedPnl,
          totalFees,
          closeReason,
        },
      });

      this.logger.info({
        positionId,
        symbol:     position.symbol,
        side:       position.side,
        entryPrice: position.entryPrice,
        closePrice: fillPrice,
        realisedPnl,
        closeReason,
      }, 'Paper position closed');

      return { success: true, positionId, orderId: order.id };
    } catch (err) {
      this.logger.error({ err, params }, 'Failed to close paper position');
      return { success: false, positionId: params.positionId, orderId: null, error: String(err) };
    }
  }

  // ── Update stop loss ───────────────────────────────────────────────────────

  async updateStop(params: UpdateStopParams): Promise<ExecutionResult> {
    try {
      const { positionId, newStopLoss } = params;
      await PositionRepo.updatePosition(positionId, { stopLoss: newStopLoss });

      this.logger.debug({ positionId, newStopLoss }, 'Stop loss updated');
      return { success: true, positionId, orderId: null };
    } catch (err) {
      return { success: false, positionId: params.positionId, orderId: null, error: String(err) };
    }
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  async getOpenPositions(): Promise<Position[]> {
    const rows = await PositionRepo.getOpenPositions(true);
    return rows as unknown as Position[];
  }

  async cancelAllPending(): Promise<number> {
    return OrderRepo.cancelPendingOrders(true);
  }
}
