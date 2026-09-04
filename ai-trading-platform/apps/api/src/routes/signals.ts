import type { FastifyPluginAsync } from 'fastify';
import { DecisionLogRepo } from '@trading/database';
import { prisma } from '@trading/database';

export const signalRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /signals — recent strategy signals
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const query = request.query as { limit?: string; symbol?: string };
      const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);

      const signals = await prisma.strategySignal.findMany({
        where: query.symbol ? { symbol: query.symbol } : {},
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { strategy: { select: { displayName: true } } },
      });

      return reply.send({
        success: true,
        data: signals,
        timestamp: new Date().toISOString(),
      });
    },
  });

  // GET /signals/decisions — trade decision audit log
  fastify.get('/decisions', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const query = request.query as { limit?: string; symbol?: string };
      const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);
      const logs = await DecisionLogRepo.getRecentDecisionLogs(limit, query.symbol);
      return reply.send({
        success: true,
        data: logs,
        timestamp: new Date().toISOString(),
      });
    },
  });

  // GET /signals/ai — recent AI analyses
  fastify.get('/ai', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const query = request.query as { limit?: string };
      const limit = Math.min(parseInt(query.limit ?? '20', 10), 100);

      const predictions = await prisma.aiPrediction.findMany({
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
};
