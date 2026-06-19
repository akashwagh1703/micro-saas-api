import { Global, Module } from '@nestjs/common';
import { WebhookIdempotencyService } from './webhook-idempotency.service';

@Global()
@Module({
  providers: [WebhookIdempotencyService],
  exports: [WebhookIdempotencyService],
})
export class WebhookIdempotencyModule {}
