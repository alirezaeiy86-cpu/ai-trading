/**
 * Execution Tests — Phase 7
 * Tests paper execution logic without real database calls.
 * DB calls are mocked so tests run offline and deterministically.
 */

import { PaperExecutionProvider } from '../paper-execution.provider';
import { PositionMonitor }        from '../position-monitor';
import type { OpenTradeParams, CloseTradeParams } from '../execution-provider.interface';

// =============================================================================
// MOCKS
// =============================================================================

// Mock all database modules
jest.mock('@trading/database', () => ({
  PositionRepo: {
    createPosition:   jest.fn(),
    getPositionById:  jest.fn(),
    getOpenPositions: jest.fn(),
    updatePosition:   jest.fn(),
    closePosition:    jest.fn(),
  },
  OrderRepo: {
    createOrder:          jest.fn(),
    updateOrder:          jest.fn(),
    cancelPendingOrders:  jest.fn(),
  },
  PaperAccountRepo: {
    getPaperAccount:     jest.fn(),
    updatePaperAccount:  jest.fn(),
  },
  SystemEventRepo: {
    logEvent: jest.fn(),
  },
}));

import {
  PositionRepo,
  OrderRepo,
  PaperAccountRepo,
  SystemEventRepo,
} from '@trading/database';

// Minimal logger stub
const logger = {
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as never;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockAccount = {
  id: 'paper-main',
  currentBalance: 10_000,
  equity:         10_000,
  highWaterMark:  10_000,
  currency: 'USDT',
};

const mockOrder = {
  id: 'order-1',
  clientOrderId: 'cid-1',
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'MARKET',
  status: 'PENDING',
  quantity: 0.1,
  filledQuantity: 0,
  fees: 0,
  feeCurrency: 'USDT',
  isPaper: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPosition = {
  id:          'pos-1',
  symbol:      'BTCUSDT',
  side:        'LONG',
  status:      'OPEN',
  entryPrice:  50_000,
  quantity:    0.1,
  stopLoss:    49_000,
  takeProfit:  52_000,
  currentPrice: 50_000,
  unrealisedPnl: 0,
  realisedPnl:   0,
  fees:          5,
  openedAt:    new Date(),
  isPaper:     true,
};

const openParams: OpenTradeParams = {
  symbol:        'BTCUSDT',
  direction:     'LONG',
  entryPrice:    50_000,
  quantity:      0.1,
  stopLoss:      49_000,
  takeProfit:    52_000,
  strategyScore: 80,
  aiConfidence:  0.82,
  marketRegime:  'TRENDING_UP',
};

// =============================================================================
// PAPER EXECUTION PROVIDER TESTS
// =============================================================================

describe('PaperExecutionProvider', () => {
  let provider: PaperExecutionProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new PaperExecutionProvider(logger);

    // Default mock returns
    (PaperAccountRepo.getPaperAccount as jest.Mock).mockResolvedValue(mockAccount);
    (PaperAccountRepo.updatePaperAccount as jest.Mock).mockResolvedValue(mockAccount);
    (OrderRepo.createOrder as jest.Mock).mockResolvedValue(mockOrder);
    (OrderRepo.updateOrder as jest.Mock).mockResolvedValue({ ...mockOrder, status: 'FILLED' });
    (PositionRepo.createPosition as jest.Mock).mockResolvedValue(mockPosition);
    (PositionRepo.getPositionById as jest.Mock).mockResolvedValue(mockPosition);
    (PositionRepo.closePosition as jest.Mock).mockResolvedValue({ ...mockPosition, status: 'CLOSED' });
    (SystemEventRepo.logEvent as jest.Mock).mockResolvedValue({});
  });

  describe('mode', () => {
    it('reports paper mode', () => {
      expect(provider.mode).toBe('paper');
    });
  });

  describe('openTrade', () => {
    it('returns success with positionId', async () => {
      const result = await provider.openTrade(openParams);
      expect(result.success).toBe(true);
      expect(result.positionId).toBe('pos-1');
      expect(result.error).toBeUndefined();
    });

    it('creates an order and fills it', async () => {
      await provider.openTrade(openParams);
      expect(OrderRepo.createOrder).toHaveBeenCalledTimes(1);
      expect(OrderRepo.updateOrder).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ status: 'FILLED', filledQuantity: 0.1 }),
      );
    });

    it('creates a position with correct parameters', async () => {
      await provider.openTrade(openParams);
      expect(PositionRepo.createPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol:    'BTCUSDT',
          side:      'LONG',
          quantity:  0.1,
          stopLoss:  49_000,
          takeProfit: 52_000,
          isPaper:   true,
        }),
      );
    });

    it('applies slippage to fill price (long buys higher)', async () => {
      await provider.openTrade(openParams);
      const createCall = (PositionRepo.createPosition as jest.Mock).mock.calls[0]?.[0];
      // Fill price should be slightly above entry due to slippage
      expect(createCall?.entryPrice).toBeGreaterThan(50_000);
      expect(createCall?.entryPrice).toBeLessThan(50_100);
    });

    it('deducts fees from account balance', async () => {
      await provider.openTrade(openParams);
      expect(PaperAccountRepo.updatePaperAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          currentBalance: expect.any(Number),
        }),
      );
      const updateCall = (PaperAccountRepo.updatePaperAccount as jest.Mock).mock.calls[0]?.[0];
      // Balance should be less than original (fees deducted)
      expect(updateCall?.currentBalance).toBeLessThan(10_000);
    });

    it('rejects when insufficient balance', async () => {
      (PaperAccountRepo.getPaperAccount as jest.Mock).mockResolvedValue({
        ...mockAccount,
        currentBalance: 1,    // only $1
        availableBalance: 1,
      });
      const result = await provider.openTrade(openParams);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient balance');
    });

    it('logs a system event on success', async () => {
      await provider.openTrade(openParams);
      expect(SystemEventRepo.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'POSITION_OPENED', level: 'info' }),
      );
    });

    it('returns failure gracefully on DB error', async () => {
      (OrderRepo.createOrder as jest.Mock).mockRejectedValue(new Error('DB error'));
      const result = await provider.openTrade(openParams);
      expect(result.success).toBe(false);
      expect(result.error).toContain('DB error');
    });
  });

  describe('closeTrade', () => {
    const closeParams: CloseTradeParams = {
      positionId:  'pos-1',
      closePrice:  52_000,
      closeReason: 'TAKE_PROFIT',
    };

    it('returns success', async () => {
      const result = await provider.closeTrade(closeParams);
      expect(result.success).toBe(true);
      expect(result.positionId).toBe('pos-1');
    });

    it('calculates positive P&L for winning LONG trade', async () => {
      await provider.closeTrade(closeParams);
      const closeCall = (PositionRepo.closePosition as jest.Mock).mock.calls[0];
      // realisedPnl = (52000 - 50000) * 0.1 - fees ≈ $200 - fees
      const realisedPnl = closeCall?.[1];
      expect(realisedPnl).toBeGreaterThan(150); // after fees
    });

    it('calculates negative P&L for losing trade', async () => {
      const lossClose: CloseTradeParams = {
        positionId:  'pos-1',
        closePrice:  48_000,  // below entry — loss
        closeReason: 'STOP_LOSS',
      };
      await provider.closeTrade(lossClose);
      const closeCall = (PositionRepo.closePosition as jest.Mock).mock.calls[0];
      const realisedPnl = closeCall?.[1];
      expect(realisedPnl).toBeLessThan(0);
    });

    it('applies slippage on close (long sells lower)', async () => {
      await provider.closeTrade(closeParams);
      const orderCall = (OrderRepo.createOrder as jest.Mock).mock.calls[0]?.[0];
      // Close fill price should be slightly below 52000 for LONG
      expect(orderCall?.price).toBeLessThan(52_000);
      expect(orderCall?.price).toBeGreaterThan(51_900);
    });

    it('rejects closing an already-closed position', async () => {
      (PositionRepo.getPositionById as jest.Mock).mockResolvedValue({
        ...mockPosition, status: 'CLOSED',
      });
      const result = await provider.closeTrade(closeParams);
      expect(result.success).toBe(false);
      expect(result.error).toContain('already closed');
    });

    it('rejects closing a non-existent position', async () => {
      (PositionRepo.getPositionById as jest.Mock).mockResolvedValue(null);
      const result = await provider.closeTrade({ ...closeParams, positionId: 'bad-id' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('logs TAKE_PROFIT_HIT event', async () => {
      await provider.closeTrade(closeParams);
      expect(SystemEventRepo.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'TAKE_PROFIT_HIT' }),
      );
    });

    it('logs STOP_LOSS_HIT event', async () => {
      await provider.closeTrade({ ...closeParams, closeReason: 'STOP_LOSS', closePrice: 49_000 });
      expect(SystemEventRepo.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'STOP_LOSS_HIT' }),
      );
    });
  });

  describe('updateStop', () => {
    it('updates stop loss successfully', async () => {
      (PositionRepo.updatePosition as jest.Mock).mockResolvedValue(mockPosition);
      const result = await provider.updateStop({ positionId: 'pos-1', newStopLoss: 49_500 });
      expect(result.success).toBe(true);
      expect(PositionRepo.updatePosition).toHaveBeenCalledWith(
        'pos-1',
        expect.objectContaining({ stopLoss: 49_500 }),
      );
    });
  });

  describe('cancelAllPending', () => {
    it('cancels all pending orders', async () => {
      (OrderRepo.cancelPendingOrders as jest.Mock).mockResolvedValue(3);
      const count = await provider.cancelAllPending();
      expect(count).toBe(3);
      expect(OrderRepo.cancelPendingOrders).toHaveBeenCalledWith(true);
    });
  });
});

// =============================================================================
// POSITION MONITOR TESTS
// =============================================================================

describe('PositionMonitor', () => {
  let monitor:  PositionMonitor;
  let provider: PaperExecutionProvider;
  let getPrice: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new PaperExecutionProvider(logger);
    getPrice = jest.fn();
    monitor  = new PositionMonitor(provider, getPrice, logger);

    (PaperAccountRepo.getPaperAccount as jest.Mock).mockResolvedValue(mockAccount);
    (PaperAccountRepo.updatePaperAccount as jest.Mock).mockResolvedValue(mockAccount);
    (OrderRepo.createOrder as jest.Mock).mockResolvedValue(mockOrder);
    (OrderRepo.updateOrder as jest.Mock).mockResolvedValue({ ...mockOrder, status: 'FILLED' });
    (PositionRepo.closePosition as jest.Mock).mockResolvedValue({ ...mockPosition, status: 'CLOSED' });
    (PositionRepo.getPositionById as jest.Mock).mockResolvedValue(mockPosition);
    (SystemEventRepo.logEvent as jest.Mock).mockResolvedValue({});
  });

  it('returns 0 when no open positions', async () => {
    (PositionRepo.getOpenPositions as jest.Mock).mockResolvedValue([]);
    const closed = await monitor.run(true);
    expect(closed).toBe(0);
  });

  it('updates unrealised P&L', async () => {
    (PositionRepo.getOpenPositions as jest.Mock).mockResolvedValue([mockPosition]);
    (PositionRepo.updatePosition as jest.Mock).mockResolvedValue(mockPosition);
    getPrice.mockResolvedValue(51_000);

    await monitor.run(true);

    expect(PositionRepo.updatePosition).toHaveBeenCalledWith(
      'pos-1',
      expect.objectContaining({
        currentPrice:  51_000,
        unrealisedPnl: expect.any(Number),
      }),
    );
  });

  it('closes position when take profit is hit (LONG)', async () => {
    (PositionRepo.getOpenPositions as jest.Mock).mockResolvedValue([mockPosition]);
    (PositionRepo.updatePosition as jest.Mock).mockResolvedValue(mockPosition);
    getPrice.mockResolvedValue(52_500); // above TP of 52000

    const closed = await monitor.run(true);
    expect(closed).toBe(1);
    expect(PositionRepo.closePosition).toHaveBeenCalledWith(
      'pos-1',
      expect.any(Number),
      expect.any(Number),
      'TAKE_PROFIT',
    );
  });

  it('closes position when stop loss is hit (LONG)', async () => {
    (PositionRepo.getOpenPositions as jest.Mock).mockResolvedValue([mockPosition]);
    (PositionRepo.updatePosition as jest.Mock).mockResolvedValue(mockPosition);
    getPrice.mockResolvedValue(48_500); // below SL of 49000

    const closed = await monitor.run(true);
    expect(closed).toBe(1);
    expect(PositionRepo.closePosition).toHaveBeenCalledWith(
      'pos-1',
      expect.any(Number),
      expect.any(Number),
      'STOP_LOSS',
    );
  });

  it('does not close when price is between SL and TP', async () => {
    (PositionRepo.getOpenPositions as jest.Mock).mockResolvedValue([mockPosition]);
    (PositionRepo.updatePosition as jest.Mock).mockResolvedValue(mockPosition);
    getPrice.mockResolvedValue(50_500); // between SL 49000 and TP 52000

    const closed = await monitor.run(true);
    expect(closed).toBe(0);
    expect(PositionRepo.closePosition).not.toHaveBeenCalled();
  });

  it('handles SHORT position stop loss correctly', async () => {
    const shortPos = {
      ...mockPosition,
      id:         'pos-short',
      side:       'SHORT',
      entryPrice: 50_000,
      stopLoss:   51_500,   // above entry for SHORT
      takeProfit: 48_000,
    };
    (PositionRepo.getOpenPositions as jest.Mock).mockResolvedValue([shortPos]);
    (PositionRepo.getPositionById as jest.Mock).mockResolvedValue(shortPos);
    (PositionRepo.updatePosition as jest.Mock).mockResolvedValue(shortPos);
    getPrice.mockResolvedValue(52_000); // above SL 51500

    const closed = await monitor.run(true);
    expect(closed).toBe(1);
    expect(PositionRepo.closePosition).toHaveBeenCalledWith(
      'pos-short', expect.any(Number), expect.any(Number), 'STOP_LOSS',
    );
  });

  it('handles SHORT position take profit correctly', async () => {
    const shortPos = {
      ...mockPosition,
      id:         'pos-short',
      side:       'SHORT',
      entryPrice: 50_000,
      stopLoss:   51_500,
      takeProfit: 48_000,
    };
    (PositionRepo.getOpenPositions as jest.Mock).mockResolvedValue([shortPos]);
    (PositionRepo.getPositionById as jest.Mock).mockResolvedValue(shortPos);
    (PositionRepo.updatePosition as jest.Mock).mockResolvedValue(shortPos);
    getPrice.mockResolvedValue(47_500); // below TP 48000

    const closed = await monitor.run(true);
    expect(closed).toBe(1);
    expect(PositionRepo.closePosition).toHaveBeenCalledWith(
      'pos-short', expect.any(Number), expect.any(Number), 'TAKE_PROFIT',
    );
  });

  it('continues monitoring other positions if one throws', async () => {
    const goodPos = { ...mockPosition, id: 'pos-good' };
    (PositionRepo.getOpenPositions as jest.Mock).mockResolvedValue([
      { ...mockPosition, id: 'pos-bad' },
      goodPos,
    ]);
    (PositionRepo.updatePosition as jest.Mock).mockResolvedValue(mockPosition);

    // First call throws, second succeeds
    getPrice
      .mockRejectedValueOnce(new Error('Price fetch failed'))
      .mockResolvedValueOnce(50_500);

    // Should not throw even if one position errors
    await expect(monitor.run(true)).resolves.not.toThrow();
  });
});
