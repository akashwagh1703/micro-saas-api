import { Global, Module } from '@nestjs/common';
import { SuperAdminService } from './super-admin.service';
import { SuperAdminGuard } from './guards/super-admin.guard';

@Global()
@Module({
  providers: [SuperAdminService, SuperAdminGuard],
  exports: [SuperAdminService, SuperAdminGuard],
})
export class SuperAdminModule {}
