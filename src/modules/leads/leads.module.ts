import { Module } from '@nestjs/common';
import { ActivityLoggerModule } from '../../common/activity-logger.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [ActivityLoggerModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
