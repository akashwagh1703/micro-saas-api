import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthMailService } from './auth-mail.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule],
  controllers: [AuthController],
  providers: [AuthService, AuthMailService],
})
export class AuthModule {}
