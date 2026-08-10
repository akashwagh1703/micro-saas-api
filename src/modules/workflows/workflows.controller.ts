import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogger } from '../../common/activity-logger.service';
import { paginate, resolvePage } from '../../common/pagination';
import { serializeWorkflow, serializeWorkflowExecution } from '../../common/serializers';
import { buildVisibleWorkflowsWhere } from '../../common/workflow-scope';
import { SettingsService } from '../settings/settings.service';
import { BillingService } from '../billing/billing.service';
import { WorkflowValidator } from './workflow-validator.service';
import { WorkflowTemplateService } from './workflow-template.service';
import { WorkflowTriggerService } from './workflow-trigger.service';
import { WorkflowDefinition } from './workflow-templates';
import { validateBusinessSetup } from '../../platform/catalog-validation';
import {
  CreateWorkflowDto,
  GenerateWorkflowDto,
  GenerateWorkflowQueryDto,
  SetupBusinessDto,
  UpdateWorkflowDto,
  ValidateDefinitionDto,
} from './dto/workflow.dto';

@Controller('workflows')
@UseGuards(TokenAuthGuard)
export class WorkflowsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: WorkflowValidator,
    private readonly templates: WorkflowTemplateService,
    private readonly activity: ActivityLogger,
    private readonly settings: SettingsService,
    private readonly billing: BillingService,
    private readonly triggers: WorkflowTriggerService,
  ) {}

  // --- Static / specific routes first (must precede ":id") ---

  @Get('templates/list')
  async templatesList(@CurrentUser('id') userId: number) {
    const templates = this.templates.listTemplates();
    const imported = (
      await this.prisma.workflow.findMany({
        where: { userId, sourceTemplate: { not: null } },
        select: { sourceTemplate: true },
      })
    ).map((w) => w.sourceTemplate);

    return {
      templates: templates.map((t) => ({ ...t, imported: imported.includes(t.slug) })),
    };
  }

  @Post('templates/seed-all')
  async seedAll(@CurrentUser('id') userId: number) {
    const created = await this.templates.seedAllForUser(userId);
    return { message: `${created.length} workflow(s) added`, count: created.length };
  }

  @Post('templates/:slug/clone')
  async cloneTemplate(
    @CurrentUser('id') userId: number,
    @Param('slug') slug: string,
    @Res() res: Response,
  ) {
    const existing = await this.prisma.workflow.findFirst({
      where: { userId, sourceTemplate: slug },
    });
    if (existing) {
      return res.status(200).json({
        workflow: serializeWorkflow(existing),
        already_existed: true,
        message: 'Template already in your account',
      });
    }

    const workflow = await this.templates.cloneForUser(userId, slug);
    if (!workflow) {
      return res.status(404).json({ message: 'Template not found' });
    }

    return res.status(201).json({
      workflow: serializeWorkflow(workflow),
      already_existed: false,
      message: 'Template added to your workflows',
    });
  }

  @Post('validate')
  validateDefinition(@Body() dto: ValidateDefinitionDto) {
    const errors = this.validator.validate(dto.definition);
    return { valid: errors.length === 0, errors };
  }

  @Get('generate/preview')
  async preview(@CurrentUser('id') userId: number, @Query() query: GenerateWorkflowQueryDto) {
    const currentCategory = await this.settings.get(userId, 'business_category');
    const validation = validateBusinessSetup({
      businessCategory: query.business_category,
      useCases: [query.use_case],
      currentCategory,
    });
    if (validation) {
      throw new UnprocessableEntityException({
        message: validation.message,
        errors: validation.errors,
      });
    }

    const result = this.templates.previewGeneration(
      query.business_category,
      query.use_case,
      query.business_description,
    );
    if (!result) {
      throw new NotFoundException('No template for this combination');
    }
    return result;
  }

  @Post('setup-business')
  async setupBusiness(@CurrentUser('id') userId: number, @Body() dto: SetupBusinessDto) {
    if (dto.business_category === 'other' && !dto.business_description?.trim()) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: { business_description: ['Please describe your business when selecting Other.'] },
      });
    }

    const workflows = await this.templates.setupBusinessForUser(
      userId,
      dto.business_category,
      dto.use_cases,
      dto.business_description,
    );

    await this.activity.log(
      userId,
      'business_setup',
      `Business configured: ${dto.business_category} (${dto.use_cases.length} use case(s))`,
    );

    const business_profile = await this.settings.getBusinessProfile(userId);

    return {
      business_category: dto.business_category,
      use_cases: dto.use_cases,
      business_profile,
      workflows: workflows.map(serializeWorkflow),
    };
  }

  @Post('generate')
  async generate(@CurrentUser('id') userId: number, @Body() dto: GenerateWorkflowDto) {
    const workflow = await this.templates.generateForUser(
      userId,
      dto.business_category,
      dto.use_case,
      dto.business_description,
    );
    if (!workflow) {
      throw new UnprocessableEntityException({ message: 'Could not generate a workflow' });
    }
    await this.activity.log(
      userId,
      'workflow_generated',
      `Guided workflow created: ${workflow.name}`,
    );
    return { workflow: serializeWorkflow(workflow) };
  }

  @Post('sync-appointment-booking')
  async syncAppointmentBooking(@CurrentUser('id') userId: number) {
    await this.billing.assertPlatformAccess(userId);
    const result = await this.templates.syncAllAppointmentBookingWorkflows(userId);
    await this.activity.log(
      userId,
      'workflow_synced',
      `Appointment booking workflows upgraded: ${result.upgraded}`,
    );
    return {
      message:
        result.upgraded > 0
          ? `Updated ${result.upgraded} appointment auto-reply workflow(s) with the latest booking flow. Republish if they were already live.`
          : 'Appointment auto-reply workflows are already up to date.',
      ...result,
    };
  }

  /** Upgrades catalog brochure/lead graphs to the commerce shop flow (Phase 4+). */
  @Post('sync-catalog-commerce')
  async syncCatalogCommerce(@CurrentUser('id') userId: number) {
    await this.billing.assertPlatformAccess(userId);
    const result = await this.templates.syncAllCatalogWorkflows(userId);
    await this.activity.log(
      userId,
      'workflow_synced',
      `Catalog commerce workflows upgraded: ${result.upgraded}`,
    );
    return {
      message:
        result.upgraded > 0
          ? `Updated ${result.upgraded} catalog workflow(s) to the WhatsApp shop flow (Website | Catalog → order → QR). Republish if they were already live.`
          : 'Catalog shop workflows are already up to date.',
      ...result,
    };
  }

  @Post(':id/publish')
  async publish(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    await this.billing.assertPlatformAccess(userId);
    let workflow = await this.findOrFail(userId, id);
    const upgradedAppointment = await this.templates.upgradeAppointmentWorkflowIfNeeded(
      userId,
      workflow,
    );
    if (upgradedAppointment) {
      workflow = upgradedAppointment;
    }
    const upgradedCatalog = await this.templates.upgradeCatalogWorkflowIfNeeded(workflow);
    if (upgradedCatalog) {
      workflow = upgradedCatalog;
    }
    const errors = this.validator.validate(workflow.definition as any);
    if (errors.length > 0) {
      throw new UnprocessableEntityException({ errors });
    }
    const updated = await this.prisma.workflow.update({
      where: { id },
      data: { status: 'published', isActive: true },
    });
    const synced = await this.triggers.onPublished(updated);
    const upgraded = !!(upgradedAppointment || upgradedCatalog);
    return {
      workflow: serializeWorkflow(synced),
      upgraded,
      hint: upgradedAppointment
        ? 'Workflow was refreshed to the latest appointment booking flow before going live.'
        : upgradedCatalog
          ? 'Workflow was refreshed to the latest Catalog shop flow (Website | Catalog → order → QR) before going live.'
          : undefined,
    };
  }

  @Post(':id/unpublish')
  async unpublish(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    await this.findOrFail(userId, id);
    const updated = await this.prisma.workflow.update({
      where: { id },
      data: { status: 'draft', isActive: false },
    });
    await this.triggers.onUnpublished(id);
    return { workflow: serializeWorkflow(updated) };
  }

  @Get(':id/executions')
  async executions(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page: string | undefined,
    @Req() req: Request,
  ) {
    await this.findOrFail(userId, id);

    const perPage = 20;
    const currentPage = resolvePage(page);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.workflowExecution.findMany({
        where: { userId, workflowId: id },
        include: { logs: true },
        orderBy: { createdAt: 'desc' },
        skip: (currentPage - 1) * perPage,
        take: perPage,
      }),
      this.prisma.workflowExecution.count({ where: { userId, workflowId: id } }),
    ]);

    const path = `${req.protocol}://${req.get('host')}${req.path}`;
    return paginate(items, total, currentPage, perPage, path, serializeWorkflowExecution);
  }

  // --- Resource routes ---

  @Get()
  async index(
    @CurrentUser('id') userId: number,
    @Query('page') page: string | undefined,
    @Req() req: Request,
  ) {
    const perPage = 15;
    const currentPage = resolvePage(page);

    const where = await buildVisibleWorkflowsWhere(userId, this.settings);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.workflow.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (currentPage - 1) * perPage,
        take: perPage,
      }),
      this.prisma.workflow.count({ where }),
    ]);

    const path = `${req.protocol}://${req.get('host')}${req.path}`;
    return paginate(items, total, currentPage, perPage, path, serializeWorkflow);
  }

  @Post()
  async store(@CurrentUser('id') userId: number, @Body() dto: CreateWorkflowDto) {
    const businessCategory = await this.settings.get(userId, 'business_category');
    const workflow = await this.prisma.workflow.create({
      data: {
        userId,
        name: dto.name,
        description: dto.description ?? null,
        triggerType: dto.trigger_type ?? 'message_received',
        status: 'draft',
        definition: (dto.definition ?? this.defaultDefinition()) as any,
        businessCategory: businessCategory ?? null,
      },
    });

    await this.activity.log(userId, 'workflow_created', `Workflow created: ${workflow.name}`);
    return { workflow: serializeWorkflow(workflow) };
  }

  @Get(':id')
  async show(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    const workflow = await this.findOrFail(userId, id);
    return { workflow: serializeWorkflow(workflow) };
  }

  @Put(':id')
  @Patch(':id')
  async update(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWorkflowDto,
  ) {
    await this.findOrFail(userId, id);

    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.trigger_type !== undefined) data.triggerType = dto.trigger_type;
    if (dto.is_active !== undefined) data.isActive = dto.is_active;

    if (dto.definition !== undefined) {
      const errors = this.validator.validate(dto.definition);
      if (errors.length > 0) {
        throw new UnprocessableEntityException({ errors });
      }
      data.definition = await this.templates.injectSaveLeadApi(
        userId,
        dto.definition as WorkflowDefinition,
      );
    }

    const workflow = await this.prisma.workflow.update({ where: { id }, data });
    const synced = await this.triggers.syncFromDefinition(workflow, {
      active: workflow.status === 'published' && workflow.isActive,
    });
    return { workflow: serializeWorkflow(synced) };
  }

  @Delete(':id')
  async destroy(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    await this.findOrFail(userId, id);
    await this.triggers.onUnpublished(id);
    const deleted = await this.prisma.workflow.deleteMany({
      where: { id, userId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('No query results for model [Workflow].');
    }
    return { message: 'Workflow deleted' };
  }

  private async findOrFail(userId: number, id: number) {
    const scope = await buildVisibleWorkflowsWhere(userId, this.settings);
    const workflow = await this.prisma.workflow.findFirst({ where: { ...scope, id } });
    if (!workflow) {
      throw new NotFoundException('No query results for model [Workflow].');
    }
    return workflow;
  }

  private defaultDefinition() {
    return {
      nodes: [
        {
          id: 'trigger-1',
          type: 'trigger',
          position: { x: 100, y: 100 },
          data: { label: 'Message Received' },
        },
      ],
      edges: [],
    };
  }
}
