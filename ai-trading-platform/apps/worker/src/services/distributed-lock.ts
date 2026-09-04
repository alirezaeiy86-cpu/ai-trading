import type { Redis } from 'ioredis';
import { randomUUID } from 'crypto';

// =============================================================================
// DISTRIBUTED LOCK
// Prevents duplicate trade execution when the cloud platform starts a second
// worker instance during restart (e.g. rolling deploy on Fly.io).
//
// Uses Redis SET NX EX pattern:
//   SET key value NX EX ttl
//   → sets key only if it does not exist, with TTL
//
// The lock holder is identified by a random lockId.
// Only the holder can release the lock (prevents accidental releases).
// =============================================================================

const EXECUTION_LOCK_KEY = 'trading:execution:lock';
const EXECUTION_LOCK_TTL = 30; // seconds — enough for one trade cycle

export class DistributedLock {
  private lockId: string | null = null;

  constructor(private readonly redis: Redis) {}

  /**
   * Acquire the execution lock.
   * Returns true if acquired, false if another instance holds it.
   */
  async acquire(ttlSeconds = EXECUTION_LOCK_TTL): Promise<boolean> {
    const id     = randomUUID();
    const result = await this.redis.set(
      EXECUTION_LOCK_KEY,
      id,
      'NX',
      'EX',
      ttlSeconds,
    );

    if (result === 'OK') {
      this.lockId = id;
      return true;
    }
    return false;
  }

  /**
   * Release the lock.
   * Only releases if this instance owns the lock (via lockId check).
   */
  async release(): Promise<void> {
    if (!this.lockId) return;

    // Lua script for atomic check-and-delete
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    await this.redis.eval(script, 1, EXECUTION_LOCK_KEY, this.lockId);
    this.lockId = null;
  }

  /**
   * Extend the lock TTL (call periodically during long-running operations).
   */
  async extend(ttlSeconds = EXECUTION_LOCK_TTL): Promise<boolean> {
    if (!this.lockId) return false;

    const current = await this.redis.get(EXECUTION_LOCK_KEY);
    if (current !== this.lockId) return false;

    await this.redis.expire(EXECUTION_LOCK_KEY, ttlSeconds);
    return true;
  }

  /**
   * Run a function with the lock held.
   * Automatically releases on completion or error.
   */
  async withLock<T>(
    fn: () => Promise<T>,
    ttlSeconds = EXECUTION_LOCK_TTL,
  ): Promise<{ acquired: boolean; result?: T }> {
    const acquired = await this.acquire(ttlSeconds);
    if (!acquired) return { acquired: false };

    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      await this.release();
    }
  }
}
