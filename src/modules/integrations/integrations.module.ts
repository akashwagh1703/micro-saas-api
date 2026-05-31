import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { WhatsAppApiService } from './whatsapp-api.service';
import { InstagramApiService } from './instagram-api.service';
import { AiService } from './ai.service';
import { ExternalApiService } from './external-api.service';

@Module({
  imports: [SettingsModule],
  providers: [WhatsAppApiService, InstagramApiService, AiService, ExternalApiService],
  exports: [WhatsAppApiService, InstagramApiService, AiService, ExternalApiService],
})
export class IntegrationsModule {}
