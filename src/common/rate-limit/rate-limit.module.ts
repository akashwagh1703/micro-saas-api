import { Global, Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';
import { RequestLoggingMiddleware, RateLimitMiddleware } from '../middleware/http.middleware';

@Global()
@Module({
  providers: [RateLimitService, RequestLoggingMiddleware, RateLimitMiddleware],
  exports: [RateLimitService, RequestLoggingMiddleware, RateLimitMiddleware],
})
export class RateLimitModule {}
