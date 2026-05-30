import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [SettingsModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
