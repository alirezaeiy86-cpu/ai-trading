import type { FastifyPluginAsync } from 'fastify';
import { StatisticsRepo } from '@trading/database';

export const statisticsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /statistics/daily?days=30
  fastify.get('/daily', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const query = request.query as { days?: string };
      const days = Math.min(parseInt(query.days ?? '30', 10), 365);
      const isPaper = process.env['PAPER_TRADING'] !== 'false';
      const stats = await StatisticsRepo.getDailyStatistics(days, isPaper);
      return reply.send({
        success: true,
        data: stats.reverse(), // oldest first for charts
        timestamp: new Date().toISOString(),
      });
    },
  });

  // GET /statistics/summary
  fastify.get('/summary', {
    onRequest: [fastify.authenticate],
    handler: async (_request, reply) => {
      const isPaper = process.env['PAPER_TRADING'] !== 'false';
      const [allTime, today] = await Promise.all([
        StatisticsRepo.getAllTimeStats(isPaper),
        StatisticsRepo.getTodayStatistics(isPaper),
      ]);
      return reply.send({
        success: true,
        data: { allTime, today },
        timestamp: new Date().toISOString(),
      });
    },
  });
};
