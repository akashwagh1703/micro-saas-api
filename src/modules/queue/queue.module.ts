import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { QueueService } from './queue.service';
import { SyncDispatcher } from './sync.dispatcher';
import { JOB_DISPATCHER } from './job-dispatcher';

@Global()
@Module({
  providers: [
    QueueService,
    {
      provide: JOB_DISPATCHER,
      useFactory: (config: ConfigService, moduleRef: ModuleRef, queue: QueueService) =>
        (config.get<string>('QUEUE_DRIVER') ?? 'pgboss') === 'sync'
          ? new SyncDispatcher(moduleRef)
          : queue,
      inject: [ConfigService, ModuleRef, QueueService],
    },
  ],
  exports: [QueueService, JOB_DISPATCHER],
})
export class QueueModule {}
