import { loadConfig } from '@trading/config';
import { createLogger } from '@trading/logger';
import { connectDatabase, disconnectDatabase } from '@trading/database';
import { TradingWorker } from './worker';

const config = loadConfig();
const logger = createLogger({ name: 'worker', level: config.LOG_LEVEL });

async function main(): Promise<void> {
  logger.info(
    {
      tradingMode: config.PAPER_TRADING ? 'PAPER' : 'LIVE',
      aiEnabled: config.AI_ENABLED,
    },
    'Starting Trading Worker',
  );

  // Connect to database before starting the worker
  logger.info('Connecting to database...');
  await connectDatabase();
  logger.info('Database connected');

  const worker = new TradingWorker(config, logger);

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received — stopping worker gracefully');
    await worker.stop();
    await disconnectDatabase();
    logger.info('Worker stopped cleanly');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection in worker');
    process.exit(1);
  });

  await worker.start();
}

void main();
