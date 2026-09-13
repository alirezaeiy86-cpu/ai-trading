import type { Position } from '@trading/types';
import type {
  ExecutionProvider,
  OpenTradeParams,
  CloseTradeParams,
  UpdateStopParams,
  ExecutionResult,
} from './execution-provider.interface';

// =============================================================================
// LIVE EXECUTION PROVIDER — STUB
// Real exchange integration is implemented in Phase 14, after extensive
// paper trading validation.
//
// Safety guards:
//   - Throws if instantiated without LIVE_TRADING=true
//   - Every method checks live trading flag before executing
//   - API keys never logged
// =============================================================================

export class LiveExecutionProvider implements ExecutionProvider {
  readonly mode = 'live' as const;

  constructor() {
    if (process.env['LIVE_TRADING'] !== 'true') {
      throw new Error(
        'LiveExecutionProvider cannot be instantiated when LIVE_TRADING != true. ' +
        'Complete paper trading validation first.',
      );
    }
    if (process.env['PAPER_TRADING'] === 'true') {
      throw new Error(
        'Configuration conflict: LIVE_TRADING=true with PAPER_TRADING=true. ' +
        'Set PAPER_TRADING=false for live trading.',
      );
    }
  }

  async openTrade(_params: OpenTradeParams): Promise<ExecutionResult> {
    throw new Error('LiveExecutionProvider.openTrade() not implemented — Phase 14');
  }

  async closeTrade(_params: CloseTradeParams): Promise<ExecutionResult> {
    throw new Error('LiveExecutionProvider.closeTrade() not implemented — Phase 14');
  }

  async updateStop(_params: UpdateStopParams): Promise<ExecutionResult> {
    throw new Error('LiveExecutionProvider.updateStop() not implemented — Phase 14');
  }

  async getOpenPositions(): Promise<Position[]> {
    throw new Error('LiveExecutionProvider.getOpenPositions() not implemented — Phase 14');
  }

  async cancelAllPending(): Promise<number> {
    throw new Error('LiveExecutionProvider.cancelAllPending() not implemented — Phase 14');
  }
}
