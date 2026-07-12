import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogger } from '../../common/activity-logger.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SettingsService } from '../settings/settings.service';
import { WhatsAppApiService } from '../integrations/whatsapp-api.service';
import { extractDigits } from '../../common/phone.util';

interface OwnerBookingAlert {
  id: number;
  resource_name: string | null;
  starts_at: string;
  service_label: string | null;
}

function formatBookingWhen(iso: string, timeZone = 'Asia/Kolkata'): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/** Owner-facing alerts when a booking is created (activity feed + optional WhatsApp). */
@Injectable()
export class BookingNotificationService {
  private readonly logger = new Logger(BookingNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly activity: ActivityLogger,
    private readonly crypto: CryptoService,
    private readonly whatsappApi: WhatsAppApiService,
  ) {}

  async notifyOwner(
    userId: number,
    booking: OwnerBookingAlert,
    options?: { contact_name?: string | null },
  ): Promise<void> {
    const timeZone = (await this.settings.get(userId, 'timezone')) || 'Asia/Kolkata';
    const when = formatBookingWhen(booking.starts_at, timeZone);
    const resource = booking.resource_name ?? 'Team member';
    const service = booking.service_label ? ` · ${booking.service_label}` : '';
    const customer = options?.contact_name ? ` for ${options.contact_name}` : '';
    const description = `${resource} · ${when}${service}${customer}`;

    await this.activity.log(userId, 'booking_created', 'New appointment booked', description, {
      booking_id: booking.id,
      starts_at: booking.starts_at,
      resource_name: booking.resource_name,
      service_label: booking.service_label,
    });

    await this.sendWhatsAppAlertIfConfigured(userId, resource, when, service, customer);
  }

  private async sendWhatsAppAlertIfConfigured(
    userId: number,
    resource: string,
    when: string,
    service: string,
    customer: string,
  ): Promise<void> {
    const alertPhoneRaw = await this.settings.get(userId, 'booking_alert_phone');
    if (!alertPhoneRaw?.trim()) return;

    const account = await this.prisma.whatsAppAccount.findUnique({ where: { userId } });
    if (!account?.isConnected || !account.accessToken || !account.phoneNumberId) return;

    const accessToken = this.crypto.decrypt(account.accessToken);
    if (!accessToken) return;

    const to = extractDigits(alertPhoneRaw);
    if (!to) return;

    const message = `📅 New booking\n\n${resource}\n${when}${service}${customer}\n\nOpen AutoWave → Bookings to view details.`;

    try {
      const result = await this.whatsappApi.sendTextMessage(
        accessToken,
        account.phoneNumberId,
        to,
        message,
      );
      if (!result.success) {
        this.logger.warn(
          `Owner booking alert failed for user ${userId}: ${result.message ?? 'send failed'}`,
        );
      }
    } catch (error: any) {
      this.logger.warn(`Owner booking alert error for user ${userId}: ${error.message}`);
    }
  }
}
