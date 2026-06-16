import { Module } from '@nestjs/common';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { SettingsModule } from '../settings/settings.module';
import { WhatsAppApiService } from './whatsapp-api.service';
import { InstagramApiService } from './instagram-api.service';
import { AiService } from './ai.service';
import { ExternalApiService } from './external-api.service';
import { CredentialVaultService } from './credential-vault.service';
import { CredentialsController } from './credentials.controller';

@Module({
  imports: [SettingsModule, CryptoModule],
  controllers: [CredentialsController],
  providers: [
    WhatsAppApiService,
    InstagramApiService,
    AiService,
    ExternalApiService,
    CredentialVaultService,
  ],
  exports: [
    WhatsAppApiService,
    InstagramApiService,
    AiService,
    ExternalApiService,
    CredentialVaultService,
  ],
})
export class IntegrationsModule {}
