import type { FastifyPluginAsync } from 'fastify';
import { PositionRepo } from '@trading/database';

export const positionRoutes: FastifyPluginAsync = async (fastify) => {
  const isPaper = process.env['PAPER_TRADING'] !== 'false';

  // GET /positions  — open positions
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    handler: async (_request, reply) => {
      const positions = await PositionRepo.getOpenPositions(isPaper);
      return reply.send({
        success: true,
        data: positions,
        timestamp: new Date().toISOString(),
      });
    },
  });

  // GET /positions/history  — closed positions
  fastify.get('/history', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);
      const offset = parseInt(query.offset ?? '0', 10);

      const { positions, total } = await PositionRepo.getClosedPositions(isPaper, limit, offset);
      return reply.send({
        success: true,
        data: {
          items: positions,
          total,
          page: Math.floor(offset / limit) + 1,
          pageSize: limit,
          hasMore: offset + limit < total,
        },
        timestamp: new Date().toISOString(),
      });
    },
  });

  // GET /positions/:id
  fastify.get('/:id', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const position = await PositionRepo.getPositionById(id);
      if (!position) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: `Position ${id} not found` },
          timestamp: new Date().toISOString(),
        });
      }
      return reply.send({
        success: true,
        data: position,
        timestamp: new Date().toISOString(),
      });
    },
  });
};
