import Redis from 'ioredis';

// =============================================================================
// REDIS CONNECTION FACTORY
// Creates a configured IORedis client.
// Uses a separate subscriber connection for pub/sub (required by Redis protocol).
// =============================================================================

export interface RedisClients {
  /** Main client for commands, get/set, BullMQ */
  client:     Redis;
  /** Dedicated subscriber client — cannot be used for regular commands */
  subscriber: Redis;
}

function buildRedisOptions(url: string): ConstructorParameters<typeof Redis>[0] {
  return {
    // Parse from URL
    ...parseRedisUrl(url),

    // Reconnection
    maxRetriesPerRequest:    3,
    enableReadyCheck:        true,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 500, 5_000);
      return delay;
    },

    // Timeouts
    connectTimeout:          10_000,
    commandTimeout:          5_000,

    // Keepalive
    keepAlive:               30_000,

    lazyConnect:             false,
  };
}

function parseRedisUrl(url: string): { host: string; port: number; password?: string; db?: number } {
  try {
    const parsed   = new URL(url);
    const password = parsed.password || undefined;
    const db       = parsed.pathname ? parseInt(parsed.pathname.slice(1) || '0', 10) : 0;
    return {
      host:     parsed.hostname,
      port:     parseInt(parsed.port || '6379', 10),
      password,
      db:       isNaN(db) ? 0 : db,
    };
  } catch {
    return { host: 'localhost', port: 6379 };
  }
}

export function createRedisClients(redisUrl: string): RedisClients {
  const opts = buildRedisOptions(redisUrl);
  return {
    client:     new Redis(opts as ConstructorParameters<typeof Redis>[0]),
    subscriber: new Redis(opts as ConstructorParameters<typeof Redis>[0]),
  };
}

/**
 * Check if Redis is reachable.
 */
export async function isRedisHealthy(redis: Redis): Promise<boolean> {
  try {
    const result = await redis.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
