import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import {
  COMMAND_CHANNEL,
  WORKER_STATUS_KEY,
  type CommandMessage,
  type WorkerCommand,
} from './redis-commands';

// =============================================================================
// COMMAND SUBSCRIBER
// Listens on the Redis pub/sub channel for control commands.
// Callbacks are invoked synchronously when a command arrives.
// =============================================================================

export type CommandHandler = (command: WorkerCommand, reason: string) => Promise<void>;

export class CommandSubscriber {
  private subscribed = false;

  constructor(
    private readonly subscriber: Redis,
    private readonly mainClient: Redis,
    private readonly handler:    CommandHandler,
    private readonly logger:     Logger,
  ) {}

  async start(): Promise<void> {
    if (this.subscribed) return;

    await this.subscriber.subscribe(COMMAND_CHANNEL);
    this.subscribed = true;

    this.subscriber.on('message', (channel, message) => {
      if (channel !== COMMAND_CHANNEL) return;

      try {
        const msg = JSON.parse(message) as CommandMessage;
        this.logger.info({ command: msg.command, reason: msg.reason }, 'Received command via Redis');
        void this.handler(msg.command, msg.reason ?? '').catch((err) => {
          this.logger.error({ err, command: msg.command }, 'Command handler error');
        });
      } catch (err) {
        this.logger.warn({ err, message }, 'Failed to parse command message');
      }
    });

    this.subscriber.on('error', (err) => {
      this.logger.error({ err }, 'Redis subscriber error');
    });

    this.logger.info({ channel: COMMAND_CHANNEL }, 'Command subscriber started');
  }

  async stop(): Promise<void> {
    if (!this.subscribed) return;
    await this.subscriber.unsubscribe(COMMAND_CHANNEL);
    this.subscribed = false;
    this.logger.info('Command subscriber stopped');
  }

  /**
   * Write the current worker status to Redis so the API can read it
   * without polling the database.
   */
  async setStatus(status: string): Promise<void> {
    await this.mainClient.set(WORKER_STATUS_KEY, status, 'EX', 120); // TTL 2 min
  }
}
