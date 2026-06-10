import { Controller, Headers, Logger, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { BillingService } from './billing.service';
import { CareerSeekerBillingService } from '../career/services/career-seeker-billing.service';

@Controller('webhook/razorpay')
export class BillingWebhookController {
  private readonly logger = new Logger(BillingWebhookController.name);

  constructor(
    private readonly billing: BillingService,
    private readonly seekerBilling: CareerSeekerBillingService,
  ) {}

  @Post()
  async receive(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-razorpay-signature') signature: string | undefined,
  ) {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const body = rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

    if (!signature) {
      this.logger.warn('Missing Razorpay webhook signature');
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    const payload =
      typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(body.toString());
    const event = payload.event as string;
    const entity = payload.payload?.subscription?.entity ?? payload.payload?.payment?.entity ?? {};

    try {
      if (this.billing.verifyWebhookSignature(body, signature)) {
        await this.billing.handleWebhookEvent(event, entity);
        res.status(200).json({ ok: true });
        return;
      }

      const handledSeeker = await this.seekerBilling.handleWebhookWithSignature(
        body,
        signature,
        payload,
      );
      if (handledSeeker) {
        res.status(200).json({ ok: true });
        return;
      }

      this.logger.warn('Invalid Razorpay webhook signature');
      res.status(400).json({ error: 'Invalid signature' });
    } catch (err) {
      this.logger.error('Webhook handling failed', err);
      res.status(500).json({ error: 'Webhook failed' });
    }
  }
}
