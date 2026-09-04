import type { Logger } from 'pino';
import type { Config } from '@trading/config';
import type { WorkerHeartbeat, WorkerStatus } from '@trading/types';
import { HeartbeatRepo } from '@trading/database';

const WORKER_VERSION = '0.1.0';

export class HeartbeatService {
  private intervalId:   NodeJS.Timeout | null = null;
  private workerId:     string;
  private currentStatus: WorkerStatus = 'STOPPED';
  private currentJob:   string | null = null;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {
    this.workerId = `worker-${process.pid}-${Date.now()}`;
  }

  setStatus(status: WorkerStatus): void {
    this.currentStatus = status;
  }

  setCurrentJob(job: string | null): void {
    this.currentJob = job;
  }

  start(getUptimeSeconds: () => number): Promise<void> {
    this.intervalId = setInterval(() => {
      const heartbeat: WorkerHeartbeat = {
        workerId:      this.workerId,
        workerVersion: WORKER_VERSION,
        status:        this.currentStatus,
        tradingMode:   this.config.PAPER_TRADING ? 'PAPER' : 'LIVE',
        currentJob:    this.currentJob,
        uptimeSeconds: getUptimeSeconds(),
        lastSeenAt:    new Date(),
        memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        queuedJobs:    0,
      };

      HeartbeatRepo.upsertHeartbeat(heartbeat).catch((err: unknown) => {
        this.logger.warn({ err }, 'Failed to write heartbeat');
      });

      this.logger.debug({
        status:    heartbeat.status,
        uptimeSec: heartbeat.uptimeSeconds,
        memMb:     heartbeat.memoryUsageMb,
        job:       heartbeat.currentJob,
      }, 'Heartbeat');
    }, this.config.WORKER_HEARTBEAT_INTERVAL_MS);

    this.logger.info(
      { workerId: this.workerId, intervalMs: this.config.WORKER_HEARTBEAT_INTERVAL_MS },
      'Heartbeat service started',
    );
    return Promise.resolve();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.logger.info('Heartbeat service stopped');
  }
}
