import { Injectable, Logger } from '@nestjs/common';
import { CatalogOrder } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogger } from '../../common/activity-logger.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { extractDigits } from '../../common/phone.util';
import { SettingsService } from '../settings/settings.service';
import { WhatsAppApiService } from '../integrations/whatsapp-api.service';
import { OwnerNotificationsService } from '../notifications/owner-notifications.service';
import { OwnerNotificationType } from '../notifications/owner-notification.types';
import { formatAddressAskMessage } from './catalog-shipping-address.util';
import { buildCourierTrackingUrl } from './catalog-tracking-url.util';

function customerLabel(order: CatalogOrder): string {
  const name = order.customerName?.trim() || null;
  const phone = order.customerPhone?.trim() || null;
  if (name && phone) return `${name} (${phone})`;
  return name || phone || 'Customer';
}

function amountLabel(order: CatalogOrder): string {
  const amount = Number(order.amountInr);
  return Number.isFinite(amount) ? `₹${amount.toLocaleString('en-IN')}` : '—';
}

@Injectable()
export class CatalogOrderNotificationService {
  private readonly logger = new Logger(CatalogOrderNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly activity: ActivityLogger,
    private readonly crypto: CryptoService,
    private readonly whatsappApi: WhatsAppApiService,
    private readonly ownerNotifications: OwnerNotificationsService,
  ) {}

  async notifyPaymentSubmitted(userId: number, order: CatalogOrder): Promise<void> {
    const customer = customerLabel(order);
    const body = `${customer}\n${order.productName} · ${amountLabel(order)}\nOrder ${order.orderNumber}`;

    await this.activity.log(
      userId,
      OwnerNotificationType.CATALOG_ORDER_PAYMENT_SUBMITTED,
      'Catalog payment to verify',
      body,
      {
        order_id: order.id,
        order_number: order.orderNumber,
        product_name: order.productName,
        amount_inr: Number(order.amountInr),
      },
    );

    void this.ownerNotifications.notify(userId, {
      type: OwnerNotificationType.CATALOG_ORDER_PAYMENT_SUBMITTED,
      title: 'Catalog payment to verify',
      body,
      metadata: {
        order_id: order.id,
        order_number: order.orderNumber,
        route: '/catalog-orders',
      },
      sendPush: true,
    });

    await this.sendOwnerWhatsAppAlert(
      userId,
      `🛍️ New catalog payment\n\n${body}\n\nOpen AutoWave → Orders to confirm or reject.`,
    );

    const customerName = order.customerName?.trim() || 'there';
    await this.sendCustomerText(
      userId,
      order,
      [
        `✅ *Payment screenshot received*`,
        ``,
        `Hi ${customerName}, thank you. We have received your payment screenshot.`,
        ``,
        `*Order details*`,
        `Order: *${order.orderNumber}*`,
        `Product: *${order.productName}*`,
        `Qty: ${order.quantity}`,
        `Amount: *${amountLabel(order)}*`,
        order.customerPhone ? `Phone: ${order.customerPhone}` : null,
        ``,
        `Our team is verifying your payment now. You will receive a confirmation message once it is approved.`,
      ]
        .filter((line) => line != null)
        .join('\n'),
    );
  }

  async notifyConfirmed(userId: number, order: CatalogOrder): Promise<void> {
    await this.sendCustomerText(userId, order, formatAddressAskMessage(order));
  }

  async notifyAddressReceived(userId: number, order: CatalogOrder): Promise<void> {
    const customerName = order.customerName?.trim() || order.shippingName?.trim() || 'there';
    const addressBits = [
      order.shippingName,
      order.shippingAddressLine,
      [order.shippingCity, order.shippingState].filter(Boolean).join(', '),
      order.shippingPincode ? `PIN ${order.shippingPincode}` : null,
      order.shippingLandmark ? `Landmark: ${order.shippingLandmark}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    await this.sendCustomerText(
      userId,
      order,
      [
        `📦 *Address received*`,
        ``,
        `Hi ${customerName}, thanks — we saved your delivery address for order *${order.orderNumber}*.`,
        ``,
        addressBits,
        ``,
        `Your order is now *ready to ship*. We will message you with tracking once it is dispatched.`,
      ].join('\n'),
    );
  }

  async notifyShipped(userId: number, order: CatalogOrder): Promise<void> {
    const customerName = order.customerName?.trim() || order.shippingName?.trim() || 'there';
    const courier = order.courierName?.trim();
    const tracking = order.trackingNumber?.trim();
    const trackingUrl =
      order.trackingUrl?.trim() ||
      buildCourierTrackingUrl(order.courierName, order.trackingNumber);
    await this.sendCustomerText(
      userId,
      order,
      [
        `🚚 *Order shipped*`,
        ``,
        `Hi ${customerName}, great news — your order *${order.orderNumber}* (*${order.productName}*) has been dispatched.`,
        courier ? `Courier: *${courier}*` : null,
        tracking ? `AWB / Tracking: *${tracking}*` : null,
        trackingUrl ? `Track here: ${trackingUrl}` : null,
        ``,
        `You will receive updates from the courier as it moves. Thank you for shopping with us.`,
      ]
        .filter((line) => line != null)
        .join('\n'),
    );
  }

  async notifyDelivered(userId: number, order: CatalogOrder): Promise<void> {
    const customerName = order.customerName?.trim() || order.shippingName?.trim() || 'there';
    await this.sendCustomerText(
      userId,
      order,
      [
        `✅ *Order delivered*`,
        ``,
        `Hi ${customerName}, your order *${order.orderNumber}* (*${order.productName}*) has been marked as delivered.`,
        ``,
        `We hope you enjoy it. Reply here if you need any help.`,
      ].join('\n'),
    );
  }

  async notifyRejected(userId: number, order: CatalogOrder): Promise<void> {
    const reason = order.rejectionReason?.trim();
    const reasonLine = reason ? `\nReason: ${reason}` : '';
    const customerName = order.customerName?.trim() || 'there';
    await this.sendCustomerText(
      userId,
      order,
      [
        `❌ *Payment not verified*`,
        ``,
        `Hi ${customerName}, we could not verify the payment for order *${order.orderNumber}*.`,
        ``,
        `Product: *${order.productName}*`,
        `Amount: *${amountLabel(order)}*${reasonLine}`,
        ``,
        `Please reply here if you need help, or place a new order from the catalog.`,
      ].join('\n'),
    );
  }

  private async sendCustomerText(
    userId: number,
    order: CatalogOrder,
    message: string,
  ): Promise<void> {
    const to = extractDigits(order.customerPhone || '');
    if (!to) return;

    const creds = await this.getWhatsAppCreds(userId);
    if (!creds) return;

    try {
      const result = await this.whatsappApi.sendTextMessage(
        creds.accessToken,
        creds.phoneNumberId,
        to,
        message,
      );
      if (!result.success) {
        this.logger.warn(
          `Customer catalog order notify failed (${order.orderNumber}): ${result.message ?? 'send failed'}`,
        );
      }
    } catch (error: any) {
      this.logger.warn(
        `Customer catalog order notify error (${order.orderNumber}): ${error.message}`,
      );
    }
  }

  private async sendOwnerWhatsAppAlert(userId: number, message: string): Promise<void> {
    const alertPhoneRaw = await this.settings.get(userId, 'booking_alert_phone');
    if (!alertPhoneRaw?.trim()) return;

    const to = extractDigits(alertPhoneRaw);
    if (!to) return;

    const creds = await this.getWhatsAppCreds(userId);
    if (!creds) return;

    try {
      const result = await this.whatsappApi.sendTextMessage(
        creds.accessToken,
        creds.phoneNumberId,
        to,
        message,
      );
      if (!result.success) {
        this.logger.warn(
          `Owner catalog order alert failed for user ${userId}: ${result.message ?? 'send failed'}`,
        );
      }
    } catch (error: any) {
      this.logger.warn(`Owner catalog order alert error for user ${userId}: ${error.message}`);
    }
  }

  private async getWhatsAppCreds(
    userId: number,
  ): Promise<{ accessToken: string; phoneNumberId: string } | null> {
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { userId } });
    if (!account?.isConnected || !account.accessToken || !account.phoneNumberId) return null;
    const accessToken = this.crypto.decrypt(account.accessToken);
    if (!accessToken) return null;
    return { accessToken, phoneNumberId: account.phoneNumberId };
  }
}
