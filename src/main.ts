import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { QueueWorker } from './modules/jobs/queue.worker';
import { CareerPgBossScheduler } from './modules/career/career-pgboss.scheduler';
import { BillingPgBossScheduler } from './modules/billing/billing-pgboss.scheduler';
import { WorkflowScheduleService } from './modules/workflows/workflow-schedule.service';

async function bootstrap() {
  const log = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { rawBody: true });

  configureApp(app);

  const port = Number(process.env.PORT ?? 3000);
  log.log(`Starting HTTP listener on port ${port}…`);
  await app.listen(port, '0.0.0.0');
  log.log(`API listening on port ${port}`);

  try {
    await app.get(QueueWorker).registerWorkers();
    await app.get(CareerPgBossScheduler).registerSchedules();
    await app.get(BillingPgBossScheduler).registerSchedules();
    await app.get(WorkflowScheduleService).ensureGlobalTick();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Background queue setup failed (API stays online): ${message}`);
  }
}

bootstrap().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`[Bootstrap] Fatal startup error: ${message}`);
  if (err instanceof Error && err.stack) {
    // eslint-disable-next-line no-console
    console.error(err.stack);
  }
  process.exit(1);
});
