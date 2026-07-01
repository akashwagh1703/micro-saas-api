import { Controller, Get, ServiceUnavailableException, Headers, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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

  /** Process metrics for operators — requires METRICS_TOKEN in production. */
  @Get('up/metrics')
  metrics(@Headers('x-metrics-token') token?: string) {
    const expected = this.config.get<string>('METRICS_TOKEN')?.trim();
    const isProd = this.config.get<string>('NODE_ENV') === 'production';

    if (expected) {
      if (!token || token !== expected) {
        throw new UnauthorizedException('Invalid or missing metrics token');
      }
    } else if (isProd) {
      throw new UnauthorizedException(
        'METRICS_TOKEN must be set in production to access /up/metrics',
      );
    }

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
