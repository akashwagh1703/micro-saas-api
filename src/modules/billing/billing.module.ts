import { Module, forwardRef } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './billing-webhook.controller';
import { PlatformPublicController } from './platform-public.controller';
import { BillingService } from './billing.service';
import { ManualPaymentService } from './manual-payment.service';
import { PaymentProofStorageService } from './payment-proof-storage.service';
import { PlatformUpiConfigService } from './platform-upi-config.service';
import { PlatformAuditService } from './platform-audit.service';
import { BillingNotificationService } from './billing-notification.service';
import { ManualPaymentExpiryService } from './manual-payment-expiry.service';
import { BillingPgBossScheduler } from './billing-pgboss.scheduler';
import { CareerModule } from '../career/career.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

@Module({
  imports: [forwardRef(() => CareerModule), NotificationsModule],
  controllers: [BillingController, BillingWebhookController, PlatformPublicController],
  providers: [
    BillingService,
    ManualPaymentService,
    PaymentProofStorageService,
    PlatformUpiConfigService,
    PlatformAuditService,
    BillingNotificationService,
    ManualPaymentExpiryService,
    SubscriptionLifecycleService,
    BillingPgBossScheduler,
  ],
  exports: [
    BillingService,
    ManualPaymentService,
    PaymentProofStorageService,
    PlatformUpiConfigService,
    PlatformAuditService,
    ManualPaymentExpiryService,
    BillingNotificationService,
    SubscriptionLifecycleService,
  ],
})
export class BillingModule {}
