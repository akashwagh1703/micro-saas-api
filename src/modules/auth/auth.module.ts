import { Module } from '@nestjs/common';
import { WorkflowsModule } from '../workflows/workflows.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [WorkflowsModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
