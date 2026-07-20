import type { Booking, Contact, ResourceSchedule, ServiceResource } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BookingNotificationService } from './booking-notification.service';
import { getVerticalAvailabilityDefaults } from './availability-vertical-defaults';
import {
  ACTIVE_BOOKING_STATUSES,
  filterFutureSlotsForToday,
  generateAvailableSlots,
  pickScheduleForDay,
  type ScheduleWindow,
} from './slot-engine';
import {
  dayOfWeekForDate,
  DEFAULT_TENANT_TIMEZONE,
  isValidDateStr,
  isValidTimeStr,
  utcDayRangeForLocalDate,
} from './timezone.util';
import type {
  CreateBookingDto,
  CreateResourceDto,
  ScheduleSlotDto,
  UpdateResourceDto,
} from './dto/availability.dto';

function serializeResource(resource: ServiceResource & { schedules?: ResourceSchedule[] }) {
  return {
    id: resource.id,
    name: resource.name,
    type: resource.type,
    is_active: resource.isActive,
    metadata: resource.metadata ?? null,
    schedules: (resource.schedules ?? []).map(serializeSchedule),
    created_at: resource.createdAt?.toISOString?.() ?? resource.createdAt,
    updated_at: resource.updatedAt?.toISOString?.() ?? resource.updatedAt,
  };
}

function serializeSchedule(schedule: ResourceSchedule) {
  return {
    id: schedule.id,
    day_of_week: schedule.dayOfWeek,
    start_time: schedule.startTime,
    end_time: schedule.endTime,
    slot_minutes: schedule.slotMinutes,
    is_active: schedule.isActive,
  };
}

function serializeBooking(
  booking: Booking & {
    resource?: ServiceResource;
    contact?: Contact | null;
    conversation?: { contact?: Contact | null } | null;
  },
) {
  const contact = booking.contact ?? booking.conversation?.contact ?? null;
  return {
    id: booking.id,
    resource_id: booking.resourceId,
    resource_name: booking.resource?.name ?? null,
    contact_id: booking.contactId ?? contact?.id ?? null,
    contact_name: contact?.name ?? null,
    contact_phone: contact?.phone ?? null,
    contact_username: contact?.username ?? null,
    conversation_id: booking.conversationId,
    workflow_execution_id: booking.workflowExecutionId,
    starts_at: booking.startsAt.toISOString(),
    ends_at: booking.endsAt.toISOString(),
    status: booking.status,
    service_label: booking.serviceLabel,
    notes: booking.notes,
    created_at: booking.createdAt?.toISOString?.() ?? booking.createdAt,
    updated_at: booking.updatedAt?.toISOString?.() ?? booking.updatedAt,
  };
}

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly bookingNotifications: BookingNotificationService,
  ) {}

  async listResources(userId: number) {
    const items = await this.prisma.serviceResource.findMany({
      where: { userId },
      include: { schedules: { orderBy: { dayOfWeek: 'asc' } } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return { data: items.map(serializeResource) };
  }

  async createResource(userId: number, dto: CreateResourceDto) {
    const profile = await this.settings.getBusinessProfile(userId);
    const defaults = getVerticalAvailabilityDefaults(profile.business_category);
    const resource = await this.prisma.serviceResource.create({
      data: {
        userId,
        name: dto.name.trim(),
        type: dto.type ?? defaults.resourceType,
        metadata: dto.metadata ? (dto.metadata as Prisma.InputJsonValue) : undefined,
      },
      include: { schedules: true },
    });
    return { resource: serializeResource(resource) };
  }

  async updateResource(userId: number, resourceId: number, dto: UpdateResourceDto) {
    const existing = await this.requireResource(userId, resourceId);
    const resource = await this.prisma.serviceResource.update({
      where: { id: existing.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
        ...(dto.metadata !== undefined
          ? { metadata: dto.metadata as Prisma.InputJsonValue }
          : {}),
      },
      include: { schedules: { orderBy: { dayOfWeek: 'asc' } } },
    });
    return { resource: serializeResource(resource) };
  }

  async deactivateResource(userId: number, resourceId: number) {
    return this.updateResource(userId, resourceId, { is_active: false });
  }

  async setSchedule(userId: number, resourceId: number, weeklySlots: ScheduleSlotDto[]) {
    const resource = await this.requireResource(userId, resourceId);
    this.validateWeeklySlots(weeklySlots);

    await this.prisma.$transaction(async (tx) => {
      await tx.resourceSchedule.deleteMany({ where: { resourceId: resource.id } });
      if (weeklySlots.length > 0) {
        await tx.resourceSchedule.createMany({
          data: weeklySlots.map((slot) => ({
            resourceId: resource.id,
            dayOfWeek: slot.day_of_week,
            startTime: slot.start_time,
            endTime: slot.end_time,
            slotMinutes: slot.slot_minutes ?? 30,
            isActive: slot.is_active ?? true,
          })),
        });
      }
    });

    const updated = await this.prisma.serviceResource.findFirst({
      where: { id: resource.id, userId },
      include: { schedules: { orderBy: { dayOfWeek: 'asc' } } },
    });
    return { resource: serializeResource(updated!) };
  }

  async getSlots(userId: number, date: string, resourceId?: number) {
    this.assertValidDate(date);
    const timeZone = await this.getTenantTimezone(userId);

    if (resourceId != null) {
      const resource = await this.requireResource(userId, resourceId);
      const slots = await this.slotsForResource(userId, resource, date, timeZone);
      return {
        date,
        timezone: timeZone,
        resources: [
          {
            resource_id: resource.id,
            resource_name: resource.name,
            resource_type: resource.type,
            slots,
          },
        ],
      };
    }

    const resources = await this.prisma.serviceResource.findMany({
      where: { userId, isActive: true },
      orderBy: { name: 'asc' },
    });

    const rows = await Promise.all(
      resources.map(async (resource) => ({
        resource_id: resource.id,
        resource_name: resource.name,
        resource_type: resource.type,
        slots: await this.slotsForResource(userId, resource, date, timeZone),
      })),
    );

    return { date, timezone: timeZone, resources: rows };
  }

  async listBookings(userId: number, from?: string, to?: string) {
    const where: { userId: number; startsAt?: { gte?: Date; lt?: Date } } = { userId };
    if (from || to) {
      where.startsAt = {};
      if (from) {
        this.assertValidDate(from);
        const tz = await this.getTenantTimezone(userId);
        where.startsAt.gte = utcDayRangeForLocalDate(from, tz).dayStartUtc;
      }
      if (to) {
        this.assertValidDate(to);
        const tz = await this.getTenantTimezone(userId);
        where.startsAt.lt = utcDayRangeForLocalDate(to, tz).dayEndUtc;
      }
    }

    const items = await this.prisma.booking.findMany({
      where,
      include: {
        resource: true,
        contact: true,
        conversation: { include: { contact: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 500,
    });
    return { data: items.map(serializeBooking) };
  }

  async createBooking(userId: number, dto: CreateBookingDto) {
    const resource = await this.requireResource(userId, dto.resource_id);
    if (!resource.isActive) {
      throw new UnprocessableEntityException('Resource is inactive');
    }

    const startsAt = new Date(dto.starts_at);
    const endsAt = new Date(dto.ends_at);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      throw new UnprocessableEntityException('Invalid booking time range');
    }

    await this.assertNoConflict(userId, resource.id, startsAt, endsAt);

    if (dto.contact_id != null) {
      await this.requireContact(userId, dto.contact_id);
    }
    if (dto.conversation_id != null) {
      await this.requireConversation(userId, dto.conversation_id);
    }

    const booking = await this.prisma.booking.create({
      data: {
        userId,
        resourceId: resource.id,
        contactId: dto.contact_id ?? null,
        conversationId: dto.conversation_id ?? null,
        workflowExecutionId: dto.workflow_execution_id ?? null,
        startsAt,
        endsAt,
        status: dto.status ?? 'confirmed',
        serviceLabel: dto.service_label ?? null,
        notes: dto.notes ?? null,
      },
      include: { resource: true, contact: true, conversation: { include: { contact: true } } },
    });

    const serialized = serializeBooking(booking);
    const resolvedContact =
      booking.contact ??
      booking.conversation?.contact ??
      (dto.conversation_id
        ? (
            await this.prisma.conversation.findFirst({
              where: { id: dto.conversation_id, userId },
              include: { contact: true },
            })
          )?.contact
        : null) ??
      null;
    const contactName = resolvedContact?.name ?? null;
    const contactPhone = resolvedContact?.phone ?? null;
    void this.bookingNotifications.notifyOwner(userId, serialized, {
      contact_name: contactName,
      contact_phone: contactPhone,
      is_pending: (dto.status ?? 'confirmed') === 'pending',
    });

    return { booking: serialized };
  }

  async updateBookingStatus(userId: number, bookingId: number, status: string) {
    const booking = await this.requireBooking(userId, bookingId);
    const previousStatus = booking.status;
    const updated = await this.prisma.booking.update({
      where: { id: booking.id },
      data: { status },
      include: { resource: true, contact: true, conversation: { include: { contact: true } } },
    });
    const serialized = serializeBooking(updated);
    const contactName =
      updated.contact?.name ?? updated.conversation?.contact?.name ?? null;
    const contactPhone =
      updated.contact?.phone ?? updated.conversation?.contact?.phone ?? null;
    const contactOpts = { contact_name: contactName, contact_phone: contactPhone };

    if (status === 'confirmed' && previousStatus === 'pending') {
      void this.bookingNotifications.notifyCustomerConfirmed(userId, serialized);
      void this.bookingNotifications.notifyOwnerConfirmed(userId, serialized, contactOpts);
    }

    if (status === 'cancelled' && (previousStatus === 'pending' || previousStatus === 'confirmed')) {
      void this.bookingNotifications.notifyCustomerCancelled(userId, serialized, {
        wasPending: previousStatus === 'pending',
      });
      void this.bookingNotifications.notifyOwnerCancelled(userId, serialized, contactOpts);
    }

    return { booking: serialized };
  }

  async cancelBooking(userId: number, bookingId: number) {
    return this.updateBookingStatus(userId, bookingId, 'cancelled');
  }

  private async slotsForResource(
    userId: number,
    resource: ServiceResource,
    dateStr: string,
    timeZone: string,
  ) {
    const schedules = await this.prisma.resourceSchedule.findMany({
      where: { resourceId: resource.id, isActive: true },
    });
    const dayOfWeek = dayOfWeekForDate(dateStr, timeZone);
    const schedule = pickScheduleForDay(
      schedules.map(
        (s): ScheduleWindow => ({
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          slotMinutes: s.slotMinutes,
          isActive: s.isActive,
        }),
      ),
      dayOfWeek,
    );
    if (!schedule) return [];

    const { dayStartUtc, dayEndUtc } = utcDayRangeForLocalDate(dateStr, timeZone);
    const bookings = await this.prisma.booking.findMany({
      where: {
        userId,
        resourceId: resource.id,
        startsAt: { lt: dayEndUtc },
        endsAt: { gt: dayStartUtc },
        status: { in: [...ACTIVE_BOOKING_STATUSES] },
      },
    });

    return filterFutureSlotsForToday(
      generateAvailableSlots(
        dateStr,
        timeZone,
        {
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          slotMinutes: schedule.slotMinutes,
        },
        bookings.map((b) => ({
          startsAt: b.startsAt,
          endsAt: b.endsAt,
          status: b.status,
        })),
      ),
      dateStr,
      timeZone,
    );
  }

  private async assertNoConflict(
    userId: number,
    resourceId: number,
    startsAt: Date,
    endsAt: Date,
    excludeBookingId?: number,
  ) {
    const overlapping = await this.prisma.booking.findMany({
      where: {
        userId,
        resourceId,
        status: { in: [...ACTIVE_BOOKING_STATUSES] },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
      take: 1,
    });
    if (overlapping.length > 0) {
      throw new ConflictException('This time slot is already booked');
    }
  }

  private validateWeeklySlots(slots: ScheduleSlotDto[]) {
    const seenDays = new Set<number>();
    for (const slot of slots) {
      if (seenDays.has(slot.day_of_week)) {
        throw new UnprocessableEntityException(`Duplicate schedule for day ${slot.day_of_week}`);
      }
      seenDays.add(slot.day_of_week);
      if (!isValidTimeStr(slot.start_time) || !isValidTimeStr(slot.end_time)) {
        throw new UnprocessableEntityException('start_time and end_time must be HH:mm');
      }
      if (parseTime(slot.end_time) <= parseTime(slot.start_time)) {
        throw new UnprocessableEntityException('end_time must be after start_time');
      }
    }
  }

  private assertValidDate(date: string) {
    if (!isValidDateStr(date)) {
      throw new UnprocessableEntityException('date must be YYYY-MM-DD');
    }
  }

  private async getTenantTimezone(userId: number): Promise<string> {
    const tz = await this.settings.get(userId, 'timezone');
    return tz?.trim() || DEFAULT_TENANT_TIMEZONE;
  }

  private async requireResource(userId: number, resourceId: number) {
    const resource = await this.prisma.serviceResource.findFirst({
      where: { id: resourceId, userId },
    });
    if (!resource) throw new NotFoundException('Resource not found');
    return resource;
  }

  private async requireBooking(userId: number, bookingId: number) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, userId },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  private async requireContact(userId: number, contactId: number) {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, userId } });
    if (!contact) throw new NotFoundException('Contact not found');
  }

  private async requireConversation(userId: number, conversationId: number) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
  }
}

function parseTime(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}
