import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { TenantBrandingService } from './tenant-branding.service';
import { BrandingPublicController } from './branding-public.controller';

@Module({
  controllers: [SettingsController, BrandingPublicController],
  providers: [SettingsService, TenantBrandingService],
  exports: [SettingsService, TenantBrandingService],
})
export class SettingsModule {}
