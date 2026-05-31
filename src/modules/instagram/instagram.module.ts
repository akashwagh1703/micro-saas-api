import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { InstagramService } from './instagram.service';
import { InstagramController } from './instagram.controller';

@Module({
  imports: [IntegrationsModule],
  controllers: [InstagramController],
  providers: [InstagramService],
  exports: [InstagramService],
})
export class InstagramModule {}
