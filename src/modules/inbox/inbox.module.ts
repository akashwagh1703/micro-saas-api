import { Module } from '@nestjs/common';
import { ActivityLoggerModule } from '../../common/activity-logger.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { InstagramModule } from '../instagram/instagram.module';
import { InboxService } from './inbox.service';
import { InboxController } from './inbox.controller';

@Module({
  imports: [ActivityLoggerModule, IntegrationsModule, WhatsappModule, InstagramModule],
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
