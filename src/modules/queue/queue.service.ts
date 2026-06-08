import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PgBoss from 'pg-boss';
import { JobDispatcher } from './job-dispatcher';
import {
  ALL_QUEUES,
  CareerTaskJob,
  QUEUE_CAREER_TASK,
  QUEUE_EXECUTE_WORKFLOW,
  QUEUE_PROCESS_INCOMING,
  QUEUE_SEND_MESSAGE,
  SendMessageJob,
} from './queue.constants';

/**
 * PostgreSQL-backed job queue (pg-boss). Both the publisher and the workers run
 * in this single process, so the app deploys as one always-on service with no
 * Redis and no separate worker dyno. Disabled when QUEUE_DRIVER != 'pgboss'
 * (e.g. on serverless, where SyncDispatcher runs work inline instead).
 */
@Injectable()
export class QueueService implements JobDispatcher, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private boss: PgBoss;
  private ready: Promise<void>;
  private enabled = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const driver = this.config.get<string>('QUEUE_DRIVER') ?? 'pgboss';
    if (driver !== 'pgboss') {
      this.logger.log(`QUEUE_DRIVER=${driver}; pg-boss disabled (work runs inline).`);
      return;
    }
    this.enabled = true;

    const connectionString = this.config.get<string>('DATABASE_URL');
    this.boss = new PgBoss({ connectionString });
    this.boss.on('error', (err) => this.logger.error(`pg-boss error: ${err.message}`));

    this.ready = (async () => {
      await this.boss.start();
      for (const queue of ALL_QUEUES) {
        try {
          await this.boss.createQueue(queue);
        } catch {
          // queue already exists
        }
      }
      this.logger.log('Queue started (pg-boss).');
    })();

    await this.ready;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.enabled) {
      await this.boss?.stop({ graceful: true });
    }
  }

  /** Registers a worker handler for a queue. Unwraps pg-boss job batches. */
  async work<T>(queue: string, handler: (data: T) => Promise<void>): Promise<void> {
    await this.ready;
    await this.boss.work<T>(queue, async (jobs) => {
      for (const job of jobs) {
        await handler(job.data);
      }
    });
  }

  async enqueueProcessIncoming(messageId: number): Promise<void> {
    await this.ready;
    await this.boss.send(QUEUE_PROCESS_INCOMING, { messageId }, { retryLimit: 3 });
  }

  async enqueueExecuteWorkflow(executionId: number): Promise<void> {
    await this.ready;
    await this.boss.send(QUEUE_EXECUTE_WORKFLOW, { executionId }, { retryLimit: 2 });
  }

  async enqueueSendMessage(payload: SendMessageJob): Promise<void> {
    await this.ready;
    await this.boss.send(QUEUE_SEND_MESSAGE, payload, { retryLimit: 3 });
  }

  async enqueueCareerTask(payload: CareerTaskJob): Promise<void> {
    await this.ready;
    await this.boss.send(QUEUE_CAREER_TASK, payload, { retryLimit: 2 });
  }

  /** Register a cron schedule (stored in PostgreSQL — safe with multiple API instances). */
  async scheduleCron(
    queue: string,
    cron: string,
    data: object = {},
    options?: { tz?: string },
  ): Promise<void> {
    await this.ready;
    await this.boss.schedule(queue, cron, data, options ?? {});
  }
}
