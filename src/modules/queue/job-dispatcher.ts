import { SendMessageJob } from './queue.constants';

/**
 * Abstraction over background work. Two implementations exist:
 *  - QueueService (pg-boss): enqueues jobs drained by an in-process worker
 *    (for always-on hosts like Render).
 *  - SyncDispatcher: runs the work inline during the request (for serverless
 *    hosts like Vercel, where no persistent worker process exists).
 *
 * Selected at runtime via the QUEUE_DRIVER env var (`pgboss` | `sync`).
 */
export interface JobDispatcher {
  enqueueProcessIncoming(messageId: number): Promise<void>;
  enqueueExecuteWorkflow(executionId: number): Promise<void>;
  enqueueSendMessage(payload: SendMessageJob): Promise<void>;
}

export const JOB_DISPATCHER = Symbol('JOB_DISPATCHER');
