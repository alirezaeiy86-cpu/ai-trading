import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SystemEventRepo, HeartbeatRepo, OrderRepo } from '@trading/database';
import type { SystemEventType } from '@trading/types';

const botActionSchema = z.object({
  reason: z.string().max(500).optional(),
});

// Lazy Redis import — only initialised if Redis is configured
let redisPublisher: import('ioredis').Redis | null = null;

async function getRedisPublisher(): Promise<import('ioredis').Redis | null> {
  const url = process.env['REDIS_URL'];
  if (!url) return null;

  if (!redisPublisher) {
    const { default: Redis } = await import('ioredis');
    redisPublisher = new Redis(url);
  }
  return redisPublisher;
}

async function publishCommand(command: string, reason: string): Promise<boolean> {
  try {
    const redis = await getRedisPublisher();
    if (!redis) return false;
    const { COMMAND_CHANNEL } = await import('../../../worker/src/services/redis-commands');
    const msg = JSON.stringify({ command, reason, issuedAt: new Date().toISOString(), issuedBy: 'dashboard' });
    const subscribers = await redis.publish(COMMAND_CHANNEL, msg);
    return subscribers > 0;
  } catch {
    return false;
  }
}

export const botRoutes: FastifyPluginAsync = async (fastify) => {
  const isPaper = process.env['PAPER_TRADING'] !== 'false';

  fastify.post('/start', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const body = botActionSchema.safeParse(request.body ?? {});
      const reason = body.success ? (body.data.reason ?? 'Dashboard start') : 'Dashboard start';

      const delivered = await publishCommand('START', reason);

      await SystemEventRepo.logEvent({
        type: 'WORKER_STARTED' as SystemEventType, level: 'info',
        message: `Bot start requested: ${reason}`,
        data: { reason, delivered },
      });

      return reply.send({
        success: true,
        data: { message: 'Start command sent.', delivered },
        timestamp: new Date().toISOString(),
      });
    },
  });

  fastify.post('/pause', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const body   = botActionSchema.safeParse(request.body ?? {});
      const reason = body.success ? (body.data.reason ?? 'Dashboard pause') : 'Dashboard pause';
      const delivered = await publishCommand('PAUSE', reason);

      await SystemEventRepo.logEvent({
        type: 'WORKER_PAUSED' as SystemEventType, level: 'info',
        message: `Bot pause requested: ${reason}`,
        data: { reason, delivered },
      });

      return reply.send({
        success: true,
        data: { message: 'Pause command sent.', delivered },
        timestamp: new Date().toISOString(),
      });
    },
  });

  fastify.post('/resume', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const body   = botActionSchema.safeParse(request.body ?? {});
      const reason = body.success ? (body.data.reason ?? 'Dashboard resume') : 'Dashboard resume';
      const delivered = await publishCommand('RESUME', reason);

      await SystemEventRepo.logEvent({
        type: 'WORKER_RESUMED' as SystemEventType, level: 'info',
        message: `Bot resume requested: ${reason}`,
        data: { reason, delivered },
      });

      return reply.send({
        success: true,
        data: { message: 'Resume command sent.', delivered },
        timestamp: new Date().toISOString(),
      });
    },
  });

  fastify.post('/emergency-stop', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const body   = botActionSchema.safeParse(request.body ?? {});
      const reason = body.success ? (body.data.reason ?? 'Dashboard emergency stop') : 'Dashboard emergency stop';

      // 1. Publish to worker via Redis
      const delivered = await publishCommand('EMERGENCY_STOP', reason);

      // 2. Cancel pending paper orders in DB
      const cancelledCount = await OrderRepo.cancelPendingOrders(isPaper);

      // 3. Log
      await SystemEventRepo.logEvent({
        type: 'EMERGENCY_STOP' as SystemEventType, level: 'warn',
        message: `🛑 EMERGENCY STOP: ${reason}`,
        data: { reason, delivered, cancelledOrders: cancelledCount },
      });

      return reply.send({
        success: true,
        data: {
          message: 'Emergency stop activated.',
          delivered,
          cancelledOrders: cancelledCount,
          note: 'Existing positions are NOT closed automatically.',
        },
        timestamp: new Date().toISOString(),
      });
    },
  });

  fastify.get('/status', {
    onRequest: [fastify.authenticate],
    handler: async (_request, reply) => {
      const staleMs   = parseInt(process.env['WORKER_STALE_THRESHOLD_MS'] ?? '60000', 10);
      const heartbeat = await HeartbeatRepo.getLatestHeartbeat();
      const alive     = heartbeat
        ? Date.now() - heartbeat.lastSeenAt.getTime() < staleMs
        : false;

      // Also check Redis for latest status (more real-time than DB)
      let redisStatus: string | null = null;
      try {
        const redis = await getRedisPublisher();
        if (redis) redisStatus = await redis.get('trading:worker:status');
      } catch { /* non-critical */ }

      return reply.send({
        success: true,
        data: {
          workerAlive:  alive,
          workerStatus: redisStatus ?? heartbeat?.status ?? 'UNKNOWN',
          tradingMode:  heartbeat?.tradingMode ?? (isPaper ? 'PAPER' : 'LIVE'),
          lastHeartbeat: heartbeat?.lastSeenAt ?? null,
          uptimeSeconds: heartbeat?.uptimeSeconds ?? 0,
          memoryMb:      heartbeat?.memoryUsageMb ?? 0,
          queuedJobs:    heartbeat?.queuedJobs ?? 0,
        },
        timestamp: new Date().toISOString(),
      });
    },
  });
};
