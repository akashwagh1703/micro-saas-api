import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CatalogController } from './catalog.controller';
import { CatalogPublicController } from './catalog-public.controller';
import { CatalogService } from './catalog.service';
import { CatalogShareService } from './catalog-share.service';
import { CatalogStorageService } from './catalog-storage.service';
import { CatalogWhatsAppContextService } from './catalog-whatsapp-context.service';

@Module({
  imports: [BillingModule],
  controllers: [CatalogController, CatalogPublicController],
  providers: [
    CatalogService,
    CatalogStorageService,
    CatalogShareService,
    CatalogWhatsAppContextService,
  ],
  exports: [CatalogService, CatalogShareService, CatalogWhatsAppContextService],
})
export class CatalogModule {}
