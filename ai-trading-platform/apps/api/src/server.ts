import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Logger } from 'pino';
import type { Config } from '@trading/config';

import authPlugin from './plugins/auth.plugin';
import { healthRoutes } from './routes/health';
import { systemRoutes } from './routes/system';
import { authRoutes } from './routes/auth';
import { dashboardRoutes } from './routes/dashboard';
import { positionRoutes } from './routes/positions';
import { orderRoutes } from './routes/orders';
import { signalRoutes } from './routes/signals';
import { settingsRoutes } from './routes/settings';
import { botRoutes } from './routes/bot';
import { logsRoutes, riskRoutes } from './routes/logs-risk';
import { statisticsRoutes } from './routes/statistics';
import { marketDataRoutes } from './routes/market';
import { backtestRoutes }   from './routes/backtest';
import { aiRoutes }         from './routes/ai';

export async function buildServer(config: Config, logger: Logger): Promise<FastifyInstance> {
  const server = Fastify({
    logger: false,
    trustProxy: true,
  });

  server.log = logger as unknown as FastifyInstance['log'];

  // ── Security ──────────────────────────────────────────────────────────────
  await server.register(helmet, { contentSecurityPolicy: false });

  await server.register(cors, {
    origin: config.API_CORS_ORIGIN,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
  });

  await server.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => ({
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: `Retry after ${String(ctx.after)}` },
      timestamp: new Date().toISOString(),
    }),
  });

  // ── Auth plugin (JWT + cookies) ──────────────────────────────────────────
  await server.register(authPlugin, { config });

  // ── Public routes ─────────────────────────────────────────────────────────
  await server.register(healthRoutes, { prefix: '/' });
  await server.register(authRoutes,   { prefix: '/auth' });

  // ── Protected routes ──────────────────────────────────────────────────────
  await server.register(systemRoutes,     { prefix: '/system' });
  await server.register(dashboardRoutes,  { prefix: '/dashboard' });
  await server.register(positionRoutes,   { prefix: '/positions' });
  await server.register(orderRoutes,      { prefix: '/orders' });
  await server.register(signalRoutes,     { prefix: '/signals' });
  await server.register(settingsRoutes,   { prefix: '/settings' });
  await server.register(botRoutes,        { prefix: '/bot' });
  await server.register(logsRoutes,       { prefix: '/logs' });
  await server.register(riskRoutes,       { prefix: '/risk' });
  await server.register(statisticsRoutes, { prefix: '/statistics' });
  await server.register(marketDataRoutes, { prefix: '/market' });
  await server.register(backtestRoutes,   { prefix: '/backtest' });
  await server.register(aiRoutes,         { prefix: '/ai' });

  // ── Error handlers ────────────────────────────────────────────────────────
  server.setErrorHandler((error, request, reply) => {
    logger.error({ err: error, url: request.url }, 'Request error');
    void reply.status(error.statusCode ?? 500).send({
      success: false,
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message:
          config.NODE_ENV === 'production' && !error.statusCode
            ? 'Internal server error'
            : error.message,
      },
      timestamp: new Date().toISOString(),
    });
  });

  server.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: `${request.method} ${request.url} not found` },
      timestamp: new Date().toISOString(),
    });
  });

  return server;
}
