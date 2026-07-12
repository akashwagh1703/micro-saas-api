import { Module } from '@nestjs/common';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { ActivityLoggerModule } from '../../common/activity-logger.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { SettingsModule } from '../settings/settings.module';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { BookingNotificationService } from './booking-notification.service';
import { V4AvailabilityGuard } from '../../common/guards/v4-availability.guard';

@Module({
  imports: [SettingsModule, ActivityLoggerModule, IntegrationsModule, CryptoModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService, BookingNotificationService, V4AvailabilityGuard],
  exports: [AvailabilityService, BookingNotificationService],
})
export class AvailabilityModule {}
