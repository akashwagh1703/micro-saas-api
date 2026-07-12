import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { OwnerNotificationsService } from './owner-notifications.service';
import { ExpoPushService } from './expo-push.service';

@Module({
  controllers: [NotificationsController],
  providers: [OwnerNotificationsService, ExpoPushService],
  exports: [OwnerNotificationsService, ExpoPushService],
})
export class NotificationsModule {}
