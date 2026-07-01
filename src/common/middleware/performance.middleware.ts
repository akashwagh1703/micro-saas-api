import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Performance Monitoring Middleware
 * Tracks request/response times and logs performance metrics
 */
@Injectable()
export class PerformanceMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PerformanceMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = performance.now();
    const startMemory = process.memoryUsage().heapUsed;
    const logger = this.logger;

    res.on('finish', () => {
      const duration = performance.now() - startTime;
      const memoryDelta = (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024;
      logger.log(
        `${req.method} ${req.path} - ${res.statusCode} - ${duration.toFixed(2)}ms - Memory: ${memoryDelta.toFixed(2)}MB`,
      );
    });

    next();
  }
}

/**
 * Response Cache Headers Middleware
 * Only cache truly public endpoints. Portal/authenticated data must never be browser-cached.
 */
@Injectable()
export class CacheHeadersMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const path = req.path;

    if (path === '/api/website/config' || path.endsWith('/website/config')) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    } else if (req.method === 'GET' && path.includes('/platform/verticals')) {
      res.setHeader('Cache-Control', 'public, max-age=300');
    } else if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else {
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    next();
  }
}
