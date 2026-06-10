import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Platform super-admins — comma-separated emails in SUPER_ADMIN_EMAILS env. */
@Injectable()
export class SuperAdminService {
  private readonly emails: Set<string>;

  constructor(private readonly config: ConfigService) {
    this.emails = new Set(
      (this.config.get<string>('SUPER_ADMIN_EMAILS') ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  isSuperAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    return this.emails.has(email.trim().toLowerCase());
  }
}
