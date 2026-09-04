import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '@trading/database';

export const aiRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /ai/analyses — recent AI predictions
  fastify.get('/analyses', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const query = request.query as { limit?: string; symbol?: string };
      const limit  = Math.min(parseInt(query.limit ?? '20', 10), 100);

      const predictions = await prisma.aiPrediction.findMany({
        where: query.symbol ? { symbol: query.symbol } : {},
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return reply.send({
        success: true,
        data: predictions,
        timestamp: new Date().toISOString(),
      });
    },
  });

  // GET /ai/usage — daily usage stats
  fastify.get('/usage', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const query = request.query as { days?: string };
      const days  = Math.min(parseInt(query.days ?? '7', 10), 30);

      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceStr = since.toISOString().slice(0, 10);

      const usage = await prisma.aiUsageLog.findMany({
        where:   { date: { gte: sinceStr } },
        orderBy: { date: 'desc' },
      });

      // Summary totals
      const totals = usage.reduce(
        (acc, row) => ({
          requests:  acc.requests  + row.requestsCount,
          errors:    acc.errors    + row.errorsCount,
          rateLimits: acc.rateLimits + row.rateLimitHits,
        }),
        { requests: 0, errors: 0, rateLimits: 0 },
      );

      return reply.send({
        success: true,
        data: { daily: usage, totals },
        timestamp: new Date().toISOString(),
      });
    },
  });

  // GET /ai/status — quick liveness + quota check
  fastify.get('/status', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const today = new Date().toISOString().slice(0, 10);
      const todayUsage = await prisma.aiUsageLog.findFirst({
        where: { date: today },
      });

      const aiEnabled = process.env['AI_ENABLED'] !== 'false';
      const maxPerDay = parseInt(process.env['AI_MAX_REQUESTS_PER_DAY'] ?? '50', 10);
      const used      = todayUsage?.requestsCount ?? 0;

      return reply.send({
        success: true,
        data: {
          enabled:          aiEnabled,
          provider:         process.env['AI_PROVIDER'] ?? 'groq',
          model:            process.env['AI_MODEL'] ?? 'unknown',
          unavailableMode:  process.env['AI_UNAVAILABLE_MODE'] ?? 'NO_TRADE',
          requestsToday:    used,
          maxPerDay,
          remainingToday:   Math.max(0, maxPerDay - used),
          errorsToday:      todayUsage?.errorsCount ?? 0,
          rateLimitHitsToday: todayUsage?.rateLimitHits ?? 0,
        },
        timestamp: new Date().toISOString(),
      });
    },
  });
};
