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
      return {
        status: 'ready',
        database: 'ok',
        uptime_sec: Math.floor(process.uptime()),
        ts: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        database: 'error',
      });
    }
  }

  /** Lightweight process metrics for operators (no auth — hide behind firewall in prod). */
  @Get('up/metrics')
  metrics() {
    const mem = process.memoryUsage();
    return {
      status: 'ok',
      uptime_sec: Math.floor(process.uptime()),
      memory: {
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      },
      node: process.version,
      ts: new Date().toISOString(),
    };
  }
}
