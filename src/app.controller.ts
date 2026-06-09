import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness — process is up (used by load balancers). */
  @Get('up')
  health() {
    return { status: 'ok', ts: new Date().toISOString() };
  }

  /** Readiness — DB reachable (used by deploy scripts). */
  @Get('up/ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'ok', ts: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        database: 'error',
      });
    }
  }
}
