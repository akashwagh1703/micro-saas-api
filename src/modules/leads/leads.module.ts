import { Module } from '@nestjs/common';
import { ActivityLoggerModule } from '../../common/activity-logger.module';
import { SettingsModule } from '../settings/settings.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [ActivityLoggerModule, SettingsModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
