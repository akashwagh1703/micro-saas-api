import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogger } from '../../common/activity-logger.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SettingsService } from '../settings/settings.service';
import { WhatsAppApiService } from '../integrations/whatsapp-api.service';
import { InboxService } from '../inbox/inbox.service';
import { OwnerNotificationsService } from '../notifications/owner-notifications.service';
import { extractDigits } from '../../common/phone.util';
import { localDateStrInTimeZone } from './timezone.util';
import {
  buildBookingMessageContext,
  DEFAULT_BOOKING_CONFIRMED_BUTTON,
  DEFAULT_BOOKING_CONFIRMED_MESSAGE,
  formatSlotLabel,
  resolveBookSlotNodeData,
  substituteContext,
} from '../workflows/nodes/booking-node.helpers';

interface OwnerBookingAlert {
  id: number;
  resource_name: string | null;
  starts_at: string;
  service_label: string | null;
  conversation_id?: number | null;
}

interface SerializedBooking extends OwnerBookingAlert {
  resource_id: number;
  contact_id?: number | null;
  workflow_execution_id?: number | null;
  ends_at: string;
  status: string;
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

/** Owner and customer alerts for booking lifecycle events. */
@Injectable()
export class BookingNotificationService {
  private readonly logger = new Logger(BookingNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly activity: ActivityLogger,
    private readonly crypto: CryptoService,
    private readonly whatsappApi: WhatsAppApiService,
    private readonly inbox: InboxService,
    private readonly ownerNotifications: OwnerNotificationsService,
  ) {}

  async notifyOwner(
    userId: number,
    booking: OwnerBookingAlert,
    options?: { contact_name?: string | null; is_pending?: boolean },
  ): Promise<void> {
    const timeZone = (await this.settings.get(userId, 'timezone')) || 'Asia/Kolkata';
    const when = formatBookingWhen(booking.starts_at, timeZone);
    const resource = booking.resource_name ?? 'Team member';
    const service = booking.service_label ? ` · ${booking.service_label}` : '';
    const customer = options?.contact_name ? ` for ${options.contact_name}` : '';
    const pending = options?.is_pending === true;
    const description = `${resource} · ${when}${service}${customer}`;

    await this.activity.log(
      userId,
      pending ? 'booking_requested' : 'booking_created',
      pending ? 'New booking request' : 'New appointment booked',
      description,
      {
        booking_id: booking.id,
        starts_at: booking.starts_at,
        resource_name: booking.resource_name,
        service_label: booking.service_label,
        pending,
      },
    );

    void this.ownerNotifications.notify(userId, {
      type: pending ? 'booking_requested' : 'booking_created',
      title: pending ? 'New booking request' : 'New appointment booked',
      body: description,
      metadata: {
        booking_id: booking.id,
        route: '/scheduling/bookings',
        starts_at: booking.starts_at,
        resource_name: booking.resource_name,
        service_label: booking.service_label,
        pending,
      },
      sendPush: true,
    });

    await this.sendWhatsAppAlertIfConfigured(userId, resource, when, service, customer, pending);
  }

  /** Sends the customer an interactive confirmation after the owner approves a pending booking. */
  async notifyCustomerConfirmed(userId: number, booking: SerializedBooking): Promise<void> {
    if (!booking.conversation_id) {
      this.logger.debug(`Booking ${booking.id} has no conversation — skip customer confirm`);
      return;
    }

    const timeZone = (await this.settings.get(userId, 'timezone')) || 'Asia/Kolkata';
    const businessName = await this.resolveBusinessName(userId);
    const when = formatSlotLabel(booking.starts_at, timeZone);
    const preferredDate = localDateStrInTimeZone(new Date(booking.starts_at), timeZone);

    let contactName: string | null = null;
    if (booking.contact_id) {
      const contact = await this.prisma.contact.findUnique({ where: { id: booking.contact_id } });
      contactName = contact?.name ?? null;
    }

    const bookSlotData = await resolveBookSlotNodeData(
      this.prisma,
      userId,
      booking.workflow_execution_id,
    );

    const messageContext = buildBookingMessageContext({
      businessName,
      contactName,
      resourceName: booking.resource_name,
      serviceType: booking.service_label,
      bookingTime: when,
      preferredDate,
      bookingId: booking.id,
    });

    const confirmedTemplate = String(
      bookSlotData.confirmed_message ?? DEFAULT_BOOKING_CONFIRMED_MESSAGE,
    );
    const confirmedHeader = String(bookSlotData.confirmed_header ?? '').trim();
    const confirmedButton = String(
      bookSlotData.confirmed_button ?? DEFAULT_BOOKING_CONFIRMED_BUTTON,
    ).slice(0, 20);

    const confirmedBody = substituteContext(confirmedTemplate, messageContext);
    const body = confirmedHeader
      ? `${substituteContext(confirmedHeader, messageContext)}\n\n${confirmedBody}`
      : confirmedBody;

    try {
      const result = await this.inbox.sendInteractiveButtons(
        userId,
        booking.conversation_id,
        body,
        [{ id: `booking_confirmed_${booking.id}`, title: confirmedButton || 'Thank you!' }],
        { source: 'booking_confirmed' },
      );
      if (!result.success) {
        this.logger.warn(
          `Customer booking confirmation failed for booking ${booking.id}: ${result.error}`,
        );
      }
    } catch (error: any) {
      this.logger.warn(`Customer booking confirmation error: ${error.message}`);
    }
  }

  private async resolveBusinessName(userId: number): Promise<string> {
    const businessName = (await this.settings.get(userId, 'business_name'))?.trim();
    if (businessName) return businessName;
    const description = (await this.settings.get(userId, 'business_description'))?.trim();
    if (description) return description;
    return 'Our business';
  }

  private async sendWhatsAppAlertIfConfigured(
    userId: number,
    resource: string,
    when: string,
    service: string,
    customer: string,
    pending: boolean,
  ): Promise<void> {
    const alertPhoneRaw = await this.settings.get(userId, 'booking_alert_phone');
    if (!alertPhoneRaw?.trim()) return;

    const account = await this.prisma.whatsAppAccount.findUnique({ where: { userId } });
    if (!account?.isConnected || !account.accessToken || !account.phoneNumberId) return;

    const accessToken = this.crypto.decrypt(account.accessToken);
    if (!accessToken) return;

    const to = extractDigits(alertPhoneRaw);
    if (!to) return;

    const message = pending
      ? `📋 New booking *request*\n\n${resource}\n${when}${service}${customer}\n\nOpen AutoWave → Bookings to confirm or cancel.`
      : `📅 New booking\n\n${resource}\n${when}${service}${customer}\n\nOpen AutoWave → Bookings to view details.`;

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
