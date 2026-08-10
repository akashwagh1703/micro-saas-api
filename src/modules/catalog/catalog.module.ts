import { Module } from '@nestjs/common';
import { ActivityLoggerModule } from '../../common/activity-logger.module';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { BillingModule } from '../billing/billing.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { CatalogController } from './catalog.controller';
import { CatalogPublicController } from './catalog-public.controller';
import { CatalogService } from './catalog.service';
import { CatalogShareService } from './catalog-share.service';
import { CatalogStorageService } from './catalog-storage.service';
import { CatalogWhatsAppContextService } from './catalog-whatsapp-context.service';
import { CatalogOrdersService } from './catalog-orders.service';
import { CatalogOrderNotificationService } from './catalog-order-notification.service';
import { CatalogPackingSlipService } from './catalog-packing-slip.service';

@Module({
  imports: [
    BillingModule,
    IntegrationsModule,
    CryptoModule,
    NotificationsModule,
    SettingsModule,
    ActivityLoggerModule,
  ],
  controllers: [CatalogController, CatalogPublicController],
  providers: [
    CatalogService,
    CatalogStorageService,
    CatalogShareService,
    CatalogWhatsAppContextService,
    CatalogOrdersService,
    CatalogOrderNotificationService,
    CatalogPackingSlipService,
  ],
  exports: [
    CatalogService,
    CatalogShareService,
    CatalogWhatsAppContextService,
    CatalogOrdersService,
    CatalogOrderNotificationService,
  ],
})
export class CatalogModule {}
