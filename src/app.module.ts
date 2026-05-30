import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { ActivityLoggerModule } from './common/activity-logger.module';
import { QueueModule } from './modules/queue/queue.module';
import { AuthModule } from './modules/auth/auth.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { SettingsModule } from './modules/settings/settings.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { BillingModule } from './modules/billing/billing.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CryptoModule,
    ActivityLoggerModule,
    QueueModule,
    AuthModule,
    DashboardModule,
    WhatsappModule,
    ContactsModule,
    InboxModule,
    WorkflowsModule,
    SettingsModule,
    BillingModule,
    WebhooksModule,
    JobsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
