import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { WhatsAppApiService } from './whatsapp-api.service';
import { AiService } from './ai.service';
import { ExternalApiService } from './external-api.service';

@Module({
  imports: [SettingsModule],
  providers: [WhatsAppApiService, AiService, ExternalApiService],
  exports: [WhatsAppApiService, AiService, ExternalApiService],
})
export class IntegrationsModule {}
