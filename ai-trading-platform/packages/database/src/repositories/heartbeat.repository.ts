import type { WorkerHeartbeat } from '@prisma/client';
import { prisma } from '../client';
import type { WorkerHeartbeat as WorkerHeartbeatType } from '@trading/types';

// =============================================================================
// WORKER HEARTBEAT REPOSITORY
// =============================================================================

/**
 * Upsert the worker's heartbeat.
 * Called every WORKER_HEARTBEAT_INTERVAL_MS by the worker.
 */
export async function upsertHeartbeat(hb: WorkerHeartbeatType): Promise<WorkerHeartbeat> {
  return prisma.workerHeartbeat.upsert({
    where: { workerId: hb.workerId },
    create: {
      workerId: hb.workerId,
      workerVersion: hb.workerVersion,
      status: hb.status,
      tradingMode: hb.tradingMode,
      currentJob: hb.currentJob,
      uptimeSeconds: hb.uptimeSeconds,
      lastSeenAt: hb.lastSeenAt,
      memoryUsageMb: hb.memoryUsageMb,
      queuedJobs: hb.queuedJobs,
    },
    update: {
      status: hb.status,
      currentJob: hb.currentJob,
      uptimeSeconds: hb.uptimeSeconds,
      lastSeenAt: hb.lastSeenAt,
      memoryUsageMb: hb.memoryUsageMb,
      queuedJobs: hb.queuedJobs,
    },
  });
}

/**
 * Get the most recent heartbeat (regardless of workerId).
 * The dashboard uses this to determine if any worker is alive.
 */
export async function getLatestHeartbeat(): Promise<WorkerHeartbeat | null> {
  return prisma.workerHeartbeat.findFirst({
    orderBy: { lastSeenAt: 'desc' },
  });
}

/**
 * Check if the worker is considered alive.
 * @param staleThresholdMs - milliseconds before a heartbeat is considered stale
 */
export async function isWorkerAlive(staleThresholdMs: number): Promise<boolean> {
  const hb = await getLatestHeartbeat();
  if (!hb) return false;
  const age = Date.now() - hb.lastSeenAt.getTime();
  return age < staleThresholdMs;
}
