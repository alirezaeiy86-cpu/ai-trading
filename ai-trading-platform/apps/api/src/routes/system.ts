import type { FastifyPluginAsync } from 'fastify';
import { isDatabaseHealthy, HeartbeatRepo } from '@trading/database';

export const systemRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/status', {
    onRequest: [fastify.authenticate],
    handler: async (_request, reply) => {
      const staleMs = parseInt(process.env['WORKER_STALE_THRESHOLD_MS'] ?? '60000', 10);
      const [dbOk, heartbeat] = await Promise.all([
        isDatabaseHealthy().catch(() => false),
        HeartbeatRepo.getLatestHeartbeat().catch(() => null),
      ]);

      const workerAlive = heartbeat
        ? Date.now() - heartbeat.lastSeenAt.getTime() < staleMs
        : false;

      return reply.send({
        success: true,
        data: {
          tradingMode:   process.env['PAPER_TRADING'] !== 'false' ? 'PAPER' : 'LIVE',
          aiEnabled:     process.env['AI_ENABLED'] !== 'false',
          version:       process.env['npm_package_version'] ?? '0.1.0',
          environment:   process.env['NODE_ENV'] ?? 'development',
          database:      dbOk ? 'ok' : 'error',
          workerStatus:  heartbeat?.status ?? 'UNKNOWN',
          workerAlive,
          lastHeartbeat: heartbeat?.lastSeenAt ?? null,
        },
        timestamp: new Date().toISOString(),
      });
    },
  });
};
