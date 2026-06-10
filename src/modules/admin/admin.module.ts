import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [BillingModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
