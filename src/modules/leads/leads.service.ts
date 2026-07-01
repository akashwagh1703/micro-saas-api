import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Lead, Prisma, WorkflowExecution } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogger } from '../../common/activity-logger.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SettingsService } from '../settings/settings.service';
import {
  buildSaveLeadApiConfig,
  buildSaveLeadCurl,
  SaveLeadApiConfig,
} from './lead-api.config';
import { SaveLeadDto, UpdateLeadDto } from './dto/lead.dto';
import { buildCsv } from '../../common/export/csv.util';
import { extractDigits } from '../../common/phone.util';

interface CreateFromExecutionInput {
  execution: WorkflowExecution;
  context: Record<string, unknown>;
  notes?: string;
}

interface NormalizedLeadInput {
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
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogger,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
  ) {}

  /** Same persistence path as the workflow save_lead node. */
  async save(userId: number, dto: SaveLeadDto): Promise<Lead> {
    const normalized = this.normalizeSaveLeadDto(dto);
    this.assertHasLeadData(normalized);
    return this.createLead(userId, normalized);
  }

  async createFromExecution({ execution, context, notes }: CreateFromExecutionInput): Promise<Lead> {
    const collected =
      context.__collected && typeof context.__collected === 'object'
        ? (context.__collected as Record<string, unknown>)
        : undefined;

    return this.save(execution.userId, {
      contact_name: this.asString(context.contact_name) || undefined,
      contact_phone: this.asString(context.contact_phone) || undefined,
      contact_username: this.asString(context.contact_username) || undefined,
      message: this.asString(context.message) || undefined,
      collected,
      contact_id: execution.contactId ?? undefined,
      conversation_id: execution.conversationId ?? undefined,
      workflow_id: execution.workflowId,
      execution_id: execution.id,
      notes,
      channel: this.asString(context.channel) || 'whatsapp',
    });
  }

  /** Creates or returns the Bearer token used in Save Lead API configs. */
  async getOrCreateApiBearerToken(userId: number): Promise<string> {
    const existing = await this.settings.get(userId, 'lead_api_bearer_token');
    if (existing) {
      return existing;
    }

    const { plainText, hash } = this.crypto.generateToken();
    await this.prisma.personalAccessToken.create({
      data: { userId, name: 'lead-api', token: hash },
    });
    await this.settings.set(userId, 'lead_api_bearer_token', plainText);
    return plainText;
  }

  resolveApiBaseUrl(): string {
    return (this.config.get<string>('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  buildSaveLeadApiForUser(
    userId: number,
    collectedFields: string[] = [],
    notes?: string,
    channel: 'whatsapp' | 'instagram' | 'both' = 'whatsapp',
  ): Promise<SaveLeadApiConfig> {
    return this.getOrCreateApiBearerToken(userId).then((token) =>
      buildSaveLeadApiConfig({
        apiBaseUrl: this.resolveApiBaseUrl(),
        bearerToken: token,
        collectedFields,
        notes,
        channel,
      }),
    );
  }

  async getIntegrationConfig(
    userId: number,
    collectedFields: string[] = [],
    notes?: string,
    channel: 'whatsapp' | 'instagram' | 'both' = 'whatsapp',
  ) {
    const api = await this.buildSaveLeadApiForUser(userId, collectedFields, notes, channel);
    return {
      save_url: api.url,
      method: api.method,
      bearer_token: api.headers.Authorization?.replace(/^Bearer\s+/i, '') ?? '',
      headers: api.headers,
      body: api.body,
      api,
      curl: buildSaveLeadCurl(api),
    };
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

    const [total, thisWeek, newCount, contacted, qualified, lost, won, whatsappLeads, instagramLeads] =
      await this.prisma.$transaction([
        this.prisma.lead.count({ where: { userId } }),
        this.prisma.lead.count({ where: { userId, createdAt: { gte: weekAgo } } }),
        this.prisma.lead.count({ where: { userId, status: 'new' } }),
        this.prisma.lead.count({ where: { userId, status: 'contacted' } }),
        this.prisma.lead.count({ where: { userId, status: 'qualified' } }),
        this.prisma.lead.count({ where: { userId, status: 'lost' } }),
        this.prisma.lead.count({ where: { userId, status: 'won' } }),
        this.prisma.lead.count({ where: { userId, channel: 'whatsapp' } }),
        this.prisma.lead.count({ where: { userId, channel: 'instagram' } }),
      ]);

    return {
      total,
      this_week: thisWeek,
      new: newCount,
      contacted,
      qualified,
      lost,
      won,
      whatsapp: whatsappLeads,
      instagram: instagramLeads,
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
      'workflow_id',
      'execution_id',
      'notes',
      'created_at',
    ];
    const rows = leads.map((lead) => [
      lead.id,
      lead.channel,
      lead.status,
      lead.name ?? '',
      lead.phone ?? '',
      lead.username ?? '',
      lead.sourceMessage ?? '',
      lead.collected ? JSON.stringify(lead.collected) : '',
      lead.workflowId ?? '',
      lead.executionId ?? '',
      lead.notes ?? '',
      lead.createdAt?.toISOString() ?? '',
    ]);
    return buildCsv(headers, rows);
  }

  private normalizeSaveLeadDto(dto: SaveLeadDto): NormalizedLeadInput {
    const name = (dto.name ?? dto.contact_name)?.trim() || undefined;
    const phoneRaw = dto.phone ?? dto.contact_phone;
    const phone = phoneRaw ? this.normalizePhone(phoneRaw) : undefined;
    const sourceMessage = (dto.source_message ?? dto.message)?.trim() || undefined;
    const collected = dto.collected ?? dto.__collected;
    const collectedClean =
      collected && typeof collected === 'object' && Object.keys(collected).length > 0
        ? collected
        : undefined;

    return {
      channel: (dto.channel ?? 'whatsapp').trim() || 'whatsapp',
      name,
      phone: phone || undefined,
      username: (dto.username ?? dto.contact_username)?.trim() || undefined,
      sourceMessage,
      collected: collectedClean,
      contactId: dto.contact_id,
      conversationId: dto.conversation_id,
      workflowId: dto.workflow_id,
      executionId: dto.execution_id,
      notes: dto.notes?.trim() || undefined,
    };
  }

  private assertHasLeadData(data: NormalizedLeadInput): void {
    const hasCollected = data.collected && Object.keys(data.collected).length > 0;
    if (!data.name && !data.phone && !data.username && !data.sourceMessage && !hasCollected) {
      throw new BadRequestException(
        'Lead must include at least one of: contact_name, contact_phone, username, message, or collected answers.',
      );
    }
  }

  private async createLead(userId: number, data: NormalizedLeadInput): Promise<Lead> {
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

    await this.activity.log(
      userId,
      'lead_created',
      'New lead captured',
      data.name || data.phone || data.username || `${data.channel} lead`,
      {
        lead_id: lead.id,
        channel: data.channel,
        workflow_id: data.workflowId ?? null,
        execution_id: data.executionId ?? null,
      },
    );

    return lead;
  }

  private asString(value: unknown): string {
    return value === null || value === undefined ? '' : String(value);
  }

  private normalizePhone(phone: string): string {
    return extractDigits(phone);
  }
}
