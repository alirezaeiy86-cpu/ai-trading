import http from 'node:http';
import { loadConfig } from '@trading/config';
import { createLogger } from '@trading/logger';
import { connectDatabase, disconnectDatabase } from '@trading/database';
import { TradingWorker } from './worker';

const config = loadConfig();
const logger = createLogger({ name: 'worker', level: config.LOG_LEVEL });

// ─────────────────────────────────────────────────────────────────────────
// Minimal HTTP server, only so Render (or any PaaS that free-tiers "Web
// Services" but not "Background Workers") sees an open port and treats
// this process as a normal web service. It runs alongside the real worker
// loop — Node's event loop is single-threaded but non-blocking, so this
// costs nothing and never interferes with the worker's own async timers.
// A ping service (e.g. cron-job.org) should hit "/" every few minutes to
// stop the free instance from sleeping.
// ─────────────────────────────────────────────────────────────────────────
function startKeepAliveServer(): void {
  const port = Number(process.env['PORT']) || 10000;

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });

  server.listen(port, () => {
    logger.info({ port }, 'Keep-alive HTTP server listening (worker disguised as web service)');
  });
}

async function main(): Promise<void> {
  startKeepAliveServer();

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
    logger.error({ err: reason }, 'Unhandled rejection in worker');
    process.exit(1);
  });

  try {
    await worker.start();
  } catch (err) {
    logger.error({ err }, 'worker.start() threw');
    process.exit(1);
  }
}

void main();
