import type { FastifyPluginAsync } from 'fastify';
import type { HealthCheckResponse } from '@trading/types';
import { isDatabaseHealthy, HeartbeatRepo } from '@trading/database';

const startTime = Date.now();
const STALE_MS  = parseInt(process.env['WORKER_STALE_THRESHOLD_MS'] ?? '60000', 10);

async function checkRedis(): Promise<boolean> {
  try {
    const url = process.env['REDIS_URL'];
    if (!url) return false;
    const { default: Redis } = await import('ioredis');
    const r      = new Redis(url, { lazyConnect: true, connectTimeout: 3000 });
    const result = await r.ping().catch(() => null);
    r.disconnect();
    return result === 'PONG';
  } catch {
    return false;
  }
}

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Reply: HealthCheckResponse }>('/health', {
    handler: async (_request, reply) => {
      const [dbOk, redisOk, heartbeat] = await Promise.all([
        isDatabaseHealthy().catch(() => false),
        checkRedis().catch(() => false),
        HeartbeatRepo.getLatestHeartbeat().catch(() => null),
      ]);

      const workerAge   = heartbeat ? Date.now() - heartbeat.lastSeenAt.getTime() : Infinity;
      const workerAlive = workerAge < STALE_MS;
      const workerStatus: HealthCheckResponse['services']['worker'] =
        !heartbeat  ? 'offline' :
        workerAlive ? 'ok'      : 'stale';

      const allOk    = dbOk && redisOk;
      const status: HealthCheckResponse['status'] = allOk ? 'ok' : 'degraded';

      return reply.status(status === 'ok' ? 200 : 503).send({
        status,
        version:   process.env['npm_package_version'] ?? '0.1.0',
        uptime:    Math.floor((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString(),
        services: {
          database:   dbOk    ? 'ok' : 'error',
          redis:      redisOk ? 'ok' : 'error',
          marketData: 'ok',
          worker:     workerStatus,
        },
      });
    },
  });
};
