import { Global, Module } from '@nestjs/common';
import { ActivityLogger } from './activity-logger.service';

@Global()
@Module({
  providers: [ActivityLogger],
  exports: [ActivityLogger],
})
export class ActivityLoggerModule {}
