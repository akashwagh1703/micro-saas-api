import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
}

/**
 * In-memory sliding-window rate limiter (per process).
 * Suitable for single-instance or moderate traffic; use Redis for multi-region scale.
 */
@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly config: ConfigService) {}

  check(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, limit, remaining: limit - 1, retryAfterSec: 0 };
    }

    if (bucket.count >= limit) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      return { allowed: false, limit, remaining: 0, retryAfterSec };
    }

    bucket.count += 1;
    return { allowed: true, limit, remaining: limit - bucket.count, retryAfterSec: 0 };
  }

  globalLimit(): number {
    return parseInt(this.config.get<string>('RATE_LIMIT_MAX') ?? '300', 10);
  }

  authLimit(): number {
    return parseInt(this.config.get<string>('RATE_LIMIT_AUTH_MAX') ?? '20', 10);
  }

  webhookLimit(): number {
    return parseInt(this.config.get<string>('RATE_LIMIT_WEBHOOK_MAX') ?? '120', 10);
  }

  websiteLeadCaptureLimit(): number {
    return parseInt(this.config.get<string>('RATE_LIMIT_WEBSITE_LEAD_MAX') ?? '5', 10);
  }

  windowMs(): number {
    return parseInt(this.config.get<string>('RATE_LIMIT_WINDOW_MS') ?? '60000', 10);
  }

  clientIp(req: { ip?: string; headers?: Record<string, string | string[] | undefined> }): string {
    const forwarded = req.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    return req.ip ?? 'unknown';
  }
}
