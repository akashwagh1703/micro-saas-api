import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { SuperAdminService } from '../super-admin.service';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly superAdmin: SuperAdminService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: User }>();
    const user = request.user;
    if (!user || !this.superAdmin.isSuperAdmin(user.email)) {
      throw new ForbiddenException('Super admin access required.');
    }
    return true;
  }
}
