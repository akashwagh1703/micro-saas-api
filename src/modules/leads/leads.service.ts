import { Injectable, NotFoundException } from '@nestjs/common';
import { Lead, Prisma, WorkflowExecution } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogger } from '../../common/activity-logger.service';
import { CreateLeadWhatsAppDto, UpdateLeadDto } from './dto/lead.dto';

interface CreateFromExecutionInput {
  execution: WorkflowExecution;
  context: Record<string, unknown>;
  notes?: string;
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogger,
  ) {}

  async createFromExecution({ execution, context, notes }: CreateFromExecutionInput): Promise<Lead> {
    const collected =
      context.__collected && typeof context.__collected === 'object'
        ? (context.__collected as Record<string, unknown>)
        : {};

    return this.createLead(execution.userId, {
      channel: 'whatsapp',
      name: this.asString(context.contact_name) || undefined,
      phone: this.normalizePhone(this.asString(context.contact_phone)),
      sourceMessage: this.asString(context.message) || undefined,
      collected: Object.keys(collected).length > 0 ? collected : undefined,
      contactId: execution.contactId ?? undefined,
      conversationId: execution.conversationId ?? undefined,
      workflowId: execution.workflowId,
      executionId: execution.id,
      notes: notes?.trim() || undefined,
    });
  }

  async createFromWhatsApp(userId: number, dto: CreateLeadWhatsAppDto): Promise<Lead> {
    return this.createLead(userId, {
      channel: 'whatsapp',
      name: dto.name,
      phone: dto.phone ? this.normalizePhone(dto.phone) : undefined,
      sourceMessage: dto.source_message,
      collected: dto.collected,
      contactId: dto.contact_id,
      conversationId: dto.conversation_id,
      notes: dto.notes,
    });
  }

  async update(userId: number, id: number, dto: UpdateLeadDto): Promise<Lead> {
    await this.findOrFail(userId, id);

    const data: Prisma.LeadUpdateInput = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.notes !== undefined) data.notes = dto.notes;

    return this.prisma.lead.update({ where: { id }, data });
  }

  async findOrFail(userId: number, id: number): Promise<Lead> {
    const lead = await this.prisma.lead.findFirst({ where: { userId, id } });
    if (!lead) {
      throw new NotFoundException('No query results for model [Lead].');
    }
    return lead;
  }

  async stats(userId: number) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [total, thisWeek, newCount, contacted, qualified, lost, won] =
      await this.prisma.$transaction([
        this.prisma.lead.count({ where: { userId } }),
        this.prisma.lead.count({ where: { userId, createdAt: { gte: weekAgo } } }),
        this.prisma.lead.count({ where: { userId, status: 'new' } }),
        this.prisma.lead.count({ where: { userId, status: 'contacted' } }),
        this.prisma.lead.count({ where: { userId, status: 'qualified' } }),
        this.prisma.lead.count({ where: { userId, status: 'lost' } }),
        this.prisma.lead.count({ where: { userId, status: 'won' } }),
      ]);

    return {
      total,
      this_week: thisWeek,
      new: newCount,
      contacted,
      qualified,
      lost,
      won,
    };
  }

  buildExportCsv(leads: Lead[]): string {
    const headers = [
      'id',
      'channel',
      'status',
      'name',
      'phone',
      'username',
      'source_message',
      'collected',
      'notes',
      'created_at',
    ];
    const rows = leads.map((lead) =>
      [
        lead.id,
        lead.channel,
        lead.status,
        lead.name ?? '',
        lead.phone ?? '',
        lead.username ?? '',
        lead.sourceMessage ?? '',
        lead.collected ? JSON.stringify(lead.collected) : '',
        lead.notes ?? '',
        lead.createdAt?.toISOString() ?? '',
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(','),
    );
    return [headers.join(','), ...rows].join('\n');
  }

  private async createLead(
    userId: number,
    data: {
      channel: string;
      name?: string;
      phone?: string;
      username?: string;
      sourceMessage?: string;
      collected?: Record<string, unknown>;
      contactId?: number;
      conversationId?: number;
      workflowId?: number;
      executionId?: number;
      notes?: string;
    },
  ): Promise<Lead> {
    const lead = await this.prisma.lead.create({
      data: {
        userId,
        channel: data.channel,
        name: data.name ?? null,
        phone: data.phone ?? null,
        username: data.username ?? null,
        sourceMessage: data.sourceMessage ?? null,
        collected: data.collected ? (data.collected as Prisma.InputJsonValue) : undefined,
        contactId: data.contactId ?? null,
        conversationId: data.conversationId ?? null,
        workflowId: data.workflowId ?? null,
        executionId: data.executionId ?? null,
        notes: data.notes ?? null,
      },
    });

    await this.activity.log(userId, 'lead_created', 'New lead captured', data.name || data.phone || 'WhatsApp lead', {
      lead_id: lead.id,
      channel: data.channel,
    });

    return lead;
  }

  private asString(value: unknown): string {
    return value === null || value === undefined ? '' : String(value);
  }

  private normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }
}
