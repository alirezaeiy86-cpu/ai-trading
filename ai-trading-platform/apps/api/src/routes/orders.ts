import type { FastifyPluginAsync } from 'fastify';
import { OrderRepo } from '@trading/database';

export const orderRoutes: FastifyPluginAsync = async (fastify) => {
  const isPaper = process.env['PAPER_TRADING'] !== 'false';

  // GET /orders
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const query = request.query as { limit?: string };
      const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);
      const orders = await OrderRepo.getRecentOrders(isPaper, limit);
      return reply.send({
        success: true,
        data: orders,
        timestamp: new Date().toISOString(),
      });
    },
  });
};
