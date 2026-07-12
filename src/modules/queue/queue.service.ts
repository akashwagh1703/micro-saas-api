import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import PgBoss from 'pg-boss';
import { JobDispatcher } from './job-dispatcher';
import { SyncDispatcher } from './sync.dispatcher';
import {
  ALL_QUEUES,
  CareerTaskJob,
  QUEUE_CAREER_TASK,
  QUEUE_EXECUTE_WORKFLOW,
  QUEUE_PROCESS_INCOMING,
  QUEUE_SEND_MESSAGE,
  QUEUE_SEND_INTERACTIVE_MESSAGE,
  SendMessageJob,
  SendInteractiveMessageJob,
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
  private boss?: PgBoss;
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: unknown) => void;
  private enabled = false;

  constructor(
    private readonly config: ConfigService,
    private readonly moduleRef: ModuleRef,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
  }

  async onModuleInit(): Promise<void> {
    // Do not block HTTP startup — pg-boss connects in the background.
    void this.initBoss().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`pg-boss background init failed: ${message}`);
      this.resolveReady();
    });
  }

  private async initBoss(): Promise<void> {
    const driver = this.config.get<string>('QUEUE_DRIVER') ?? 'pgboss';
    if (driver !== 'pgboss') {
      this.logger.log(`QUEUE_DRIVER=${driver}; pg-boss disabled (work runs inline).`);
      this.resolveReady();
      return;
    }

    try {
      this.enabled = true;
      const connectionString = this.config.get<string>('DATABASE_URL');
      this.boss = new PgBoss({ connectionString });
      this.boss.on('error', (err) => this.logger.error(`pg-boss error: ${err.message}`));

      await this.boss.start();
      for (const queue of ALL_QUEUES) {
        try {
          await this.boss.createQueue(queue);
        } catch {
          // queue already exists
        }
      }
      this.logger.log('Queue started (pg-boss).');
      this.resolveReady();
    } catch (err) {
      this.enabled = false;
      this.boss = undefined;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `pg-boss failed to start — HTTP API will still run; background jobs disabled: ${message}`,
      );
      this.resolveReady();
    }
  }

  /** Resolves when queue init finished (success or graceful disable). */
  async waitUntilReady(): Promise<void> {
    await this.ready;
  }

  /** True when pg-boss connected and workers can register. */
  isBossRunning(): boolean {
    return this.enabled && !!this.boss;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.enabled && this.boss) {
      await this.boss.stop({ graceful: true });
    }
  }

  private async assertBoss(): Promise<PgBoss> {
    await this.ready;
    if (!this.enabled || !this.boss) {
      throw new Error('pg-boss is not enabled');
    }
    return this.boss;
  }

  /** Registers a worker handler for a queue. Unwraps pg-boss job batches. */
  async work<T>(queue: string, handler: (data: T) => Promise<void>): Promise<void> {
    const boss = await this.assertBoss();
    await boss.work<T>(queue, async (jobs) => {
      for (const job of jobs) {
        await handler(job.data);
      }
    });
  }

  private syncFallback(): SyncDispatcher {
    return new SyncDispatcher(this.moduleRef);
  }

  /** Run inline when pg-boss is down so WhatsApp webhooks still get a reply. */
  private async withQueueFallback<T>(
    label: string,
    enqueue: () => Promise<T>,
    inline: () => Promise<void>,
  ): Promise<void> {
    try {
      await enqueue();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`${label}: pg-boss enqueue failed (${message}) — running inline`);
      await inline();
    }
  }

  async enqueueProcessIncoming(messageId: number): Promise<void> {
    await this.withQueueFallback(
      'process-incoming',
      async () => {
        const boss = await this.assertBoss();
        await boss.send(QUEUE_PROCESS_INCOMING, { messageId }, { retryLimit: 3 });
      },
      () => this.syncFallback().enqueueProcessIncoming(messageId),
    );
  }

  async enqueueExecuteWorkflow(
    executionId: number,
    options?: { startAfterSeconds?: number },
  ): Promise<void> {
    await this.withQueueFallback(
      'execute-workflow',
      async () => {
        const boss = await this.assertBoss();
        const startAfter = options?.startAfterSeconds;
        await boss.send(
          QUEUE_EXECUTE_WORKFLOW,
          { executionId },
          {
            retryLimit: 2,
            ...(startAfter ? { startAfter } : {}),
          },
        );
      },
      () => this.syncFallback().enqueueExecuteWorkflow(executionId, options),
    );
  }

  async enqueueSendMessage(payload: SendMessageJob): Promise<void> {
    await this.withQueueFallback(
      'send-message',
      async () => {
        const boss = await this.assertBoss();
        await boss.send(QUEUE_SEND_MESSAGE, payload, { retryLimit: 3 });
      },
      () => this.syncFallback().enqueueSendMessage(payload),
    );
  }

  async enqueueSendInteractiveMessage(payload: SendInteractiveMessageJob): Promise<void> {
    await this.withQueueFallback(
      'send-interactive-message',
      async () => {
        const boss = await this.assertBoss();
        await boss.send(QUEUE_SEND_INTERACTIVE_MESSAGE, payload, {
          retryLimit: 3,
          expireInSeconds: 300,
        });
      },
      () => this.syncFallback().enqueueSendInteractiveMessage(payload),
    );
  }

  async enqueueCareerTask(payload: CareerTaskJob): Promise<void> {
    const boss = await this.assertBoss();
    await boss.send(QUEUE_CAREER_TASK, payload, { retryLimit: 2 });
  }

  /** Register a cron schedule (stored in PostgreSQL — safe with multiple API instances). */
  async scheduleCron(
    queue: string,
    cron: string,
    data: object = {},
    options?: { tz?: string },
  ): Promise<void> {
    const boss = await this.assertBoss();
    await boss.schedule(queue, cron, data, options ?? {});
  }
}
