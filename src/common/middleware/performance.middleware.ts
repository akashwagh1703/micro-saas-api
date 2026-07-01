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
 * Sets appropriate cache headers for different endpoints
 */
@Injectable()
export class CacheHeadersMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Cache config endpoint for 1 hour
    if (req.path === '/api/website/config') {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
    // Cache health endpoint for 5 minutes
    else if (req.path === '/api/website/health') {
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
    // Don't cache POST requests or form submissions
    else if (req.method === 'POST') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    // Default: cache for 5 minutes
    else {
      res.setHeader('Cache-Control', 'public, max-age=300');
    }

    next();
  }
}
