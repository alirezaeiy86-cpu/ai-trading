import { loadConfig } from '@trading/config';
import { createLogger } from '@trading/logger';
import { connectDatabase, disconnectDatabase } from '@trading/database';
import { initAuthService } from './services/auth.service';
import { buildServer } from './server';

const config = loadConfig();
const logger = createLogger({ name: 'api', level: config.LOG_LEVEL });

async function main(): Promise<void> {
  logger.info({ tradingMode: config.PAPER_TRADING ? 'PAPER' : 'LIVE' }, 'Starting API server');

  logger.info('Connecting to database...');
  await connectDatabase();
  logger.info('Database connected');

  logger.info('Initialising auth service...');
  await initAuthService(config.DASHBOARD_PASSWORD);
  logger.info('Auth service ready');

  const server = await buildServer(config, logger);

  try {
    await server.listen({ port: config.API_PORT, host: config.API_HOST });
    logger.info({ port: config.API_PORT }, 'API server listening');
  } catch (err) {
    logger.error({ err }, 'Failed to start API server');
    process.exit(1);
  }
}

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Shutdown signal received');
  await disconnectDatabase();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
  process.exit(1);
});

void main();
