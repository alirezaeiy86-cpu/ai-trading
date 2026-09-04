import type { Logger } from 'pino';
import type { ExecutionProvider } from './execution-provider.interface';
import { PaperExecutionProvider } from './paper-execution.provider';
import { LiveExecutionProvider }  from './live-execution.provider';

// =============================================================================
// EXECUTION PROVIDER FACTORY
// Reads PAPER_TRADING / LIVE_TRADING env vars and returns the correct provider.
// Only one provider can be active at a time.
// =============================================================================

export function createExecutionProvider(
  isPaper: boolean,
  logger:  Logger,
): ExecutionProvider {
  if (isPaper) {
    logger.info('ExecutionProvider: PAPER mode (virtual funds)');
    return new PaperExecutionProvider(logger);
  }

  // Live trading — extra safety log
  logger.warn(
    '⚠️  ExecutionProvider: LIVE mode — REAL FUNDS AT RISK. ' +
    'Ensure paper trading validation is complete.',
  );
  return new LiveExecutionProvider();
}
