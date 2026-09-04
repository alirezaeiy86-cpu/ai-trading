import type { Logger } from 'pino';

// =============================================================================
// REDIS COMMAND SERVICE
// Publishes bot control commands via Redis pub/sub.
// The worker subscribes to the same channel and acts immediately.
//
// Channel: trading:commands
// Commands: PAUSE | RESUME | EMERGENCY_STOP | START
//
// This replaces the Phase 1 approach of "log the intent" with real-time
// command delivery to the running worker process.
// =============================================================================

export type WorkerCommand = 'PAUSE' | 'RESUME' | 'EMERGENCY_STOP' | 'START';

export interface CommandMessage {
  command:   WorkerCommand;
  reason?:   string;
  issuedAt:  string;
  issuedBy:  string;
}

export const COMMAND_CHANNEL = 'trading:commands';
export const HEARTBEAT_KEY   = 'trading:worker:heartbeat';
export const WORKER_STATUS_KEY = 'trading:worker:status';

/**
 * Publish a command to the worker via Redis.
 * Returns true if at least one subscriber received it.
 */
export async function publishCommand(
  redis: import('ioredis').Redis,
  command: WorkerCommand,
  reason = 'Dashboard action',
  logger?: Logger,
): Promise<boolean> {
  const message: CommandMessage = {
    command,
    reason,
    issuedAt: new Date().toISOString(),
    issuedBy: 'dashboard',
  };

  const subscribers = await redis.publish(COMMAND_CHANNEL, JSON.stringify(message));
  logger?.info({ command, reason, subscribers }, 'Command published to Redis');
  return subscribers > 0;
}

/**
 * Read the last known worker status from Redis.
 * Falls back to 'UNKNOWN' if no status stored.
 */
export async function getWorkerStatusFromRedis(
  redis: import('ioredis').Redis,
): Promise<string> {
  const status = await redis.get(WORKER_STATUS_KEY);
  return status ?? 'UNKNOWN';
}
