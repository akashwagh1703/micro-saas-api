import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogOrdersService } from '../catalog/catalog-orders.service';
import { parseShippingAddressMessage } from '../catalog/catalog-shipping-address.util';
import { extractDigits } from '../../common/phone.util';

type IncomingMessage = {
  id: number;
  userId: number;
  contactId: number;
  conversationId: number;
  content: string | null;
  contact: {
    phone: string | null;
  };
};

/**
 * After payment confirm, customer replies with delivery address.
 * Matches the latest confirmed order (no address yet) for this contact/phone.
 */
@Injectable()
export class CatalogShippingAddressHandler {
  private readonly logger = new Logger(CatalogShippingAddressHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: CatalogOrdersService,
  ) {}

  async tryHandle(message: IncomingMessage): Promise<boolean> {
    const content = String(message.content ?? '').trim();
    if (!content) return false;

    const parsed = parseShippingAddressMessage(content);
    if (!parsed) return false;

    const order = await this.findAwaitingAddressOrder(message);
    if (!order) return false;

    try {
      await this.orders.setShippingAddress(
        message.userId,
        order.id,
        {
          shipping_name: parsed.shipping_name,
          shipping_address_line: parsed.shipping_address_line,
          shipping_city: parsed.shipping_city,
          shipping_state: parsed.shipping_state,
          shipping_pincode: parsed.shipping_pincode,
          shipping_landmark: parsed.shipping_landmark,
          shipping_phone: parsed.shipping_phone,
        },
        { notifyCustomer: true },
      );
      this.logger.log(
        `Shipping address saved for order ${order.orderNumber} (user ${message.userId})`,
      );
      return true;
    } catch (error: any) {
      this.logger.warn(
        `Shipping address save failed for order ${order.id}: ${error?.message ?? error}`,
      );
      return false;
    }
  }

  private async findAwaitingAddressOrder(message: IncomingMessage) {
    const phoneDigits = extractDigits(message.contact.phone || '');

    const byContact = await this.prisma.catalogOrder.findFirst({
      where: {
        userId: message.userId,
        orderStatus: 'confirmed',
        OR: [{ shippingAddressLine: null }, { shippingPincode: null }],
        contactId: message.contactId,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (byContact) return byContact;

    if (!phoneDigits) return null;

    const candidates = await this.prisma.catalogOrder.findMany({
      where: {
        userId: message.userId,
        orderStatus: 'confirmed',
        OR: [{ shippingAddressLine: null }, { shippingPincode: null }],
        customerPhone: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    return (
      candidates.find((o) => extractDigits(o.customerPhone || '').endsWith(phoneDigits.slice(-10))) ||
      null
    );
  }
}
