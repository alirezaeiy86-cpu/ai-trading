import type { Order, Position, CloseReason } from '@trading/types';

// =============================================================================
// EXECUTION PROVIDER INTERFACE
// Both PaperExecutionProvider and LiveExecutionProvider implement this.
// The worker never calls exchange APIs directly — only via this interface.
//
// Implementations:
//   PaperExecutionProvider  — simulated fills, virtual P&L (Phase 7)
//   LiveExecutionProvider   — real exchange orders (Phase 14)
// =============================================================================

export interface OpenTradeParams {
  symbol:     string;
  direction:  'LONG' | 'SHORT';
  entryPrice: number;
  quantity:   number;
  stopLoss:   number;
  takeProfit: number;
  /** Context for the decision log */
  strategyScore:  number;
  aiConfidence:   number | null;
  marketRegime:   string;
  signalId?:      string;
  decisionLogId?: string;
}

export interface CloseTradeParams {
  positionId:  string;
  closePrice:  number;
  closeReason: CloseReason;
}

export interface UpdateStopParams {
  positionId: string;
  newStopLoss: number;
}

export interface ExecutionResult {
  success:    boolean;
  positionId: string | null;
  orderId:    string | null;
  error?:     string;
}

export interface ExecutionProvider {
  readonly mode: 'paper' | 'live';

  /**
   * Open a new trade position.
   * Returns the created position ID on success.
   */
  openTrade(params: OpenTradeParams): Promise<ExecutionResult>;

  /**
   * Close an existing position at the given price.
   */
  closeTrade(params: CloseTradeParams): Promise<ExecutionResult>;

  /**
   * Update the stop loss on an open position.
   */
  updateStop(params: UpdateStopParams): Promise<ExecutionResult>;

  /**
   * Get all currently open positions.
   */
  getOpenPositions(): Promise<Position[]>;

  /**
   * Cancel all pending (unfilled) orders.
   * Used by emergency stop.
   */
  cancelAllPending(): Promise<number>;
}
