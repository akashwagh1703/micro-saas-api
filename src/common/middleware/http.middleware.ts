import { Injectable, Logger, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { RateLimitService } from '../rate-limit/rate-limit.service';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);

    const start = Date.now();
    const { method, originalUrl } = req;

    res.on('finish', () => {
      const ms = Date.now() - start;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'log';
      this.logger[level](`${method} ${originalUrl} ${res.statusCode} ${ms}ms [${requestId}]`);
    });

    next();
  }
}

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  constructor(private readonly rateLimit: RateLimitService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const path = req.originalUrl.split('?')[0];
    if (path === '/up' || path === '/up/ready' || path === '/up/metrics') {
      next();
      return;
    }

    const ip = this.rateLimit.clientIp(req);
    const windowMs = this.rateLimit.windowMs();
    let limit = this.rateLimit.globalLimit();
    let bucketKey = `global:${ip}`;

    if (
      path.startsWith('/api/auth/login') ||
      path.startsWith('/api/auth/register') ||
      path.startsWith('/api/auth/forgot-password')
    ) {
      limit = this.rateLimit.authLimit();
      bucketKey = `auth:${ip}`;
    } else if (path.startsWith('/api/webhook/') || path.startsWith('/api/hooks/')) {
      limit = this.rateLimit.webhookLimit();
      bucketKey = `webhook:${ip}`;
    }

    const result = this.rateLimit.check(bucketKey, limit, windowMs);
    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      throw new HttpException(
        { message: 'Too many requests. Please try again shortly.', retry_after: result.retryAfterSec },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    next();
  }
}
