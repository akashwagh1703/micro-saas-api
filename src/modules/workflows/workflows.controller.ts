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
import { WorkflowDefinition } from './workflow-templates';
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
  preview(@Query() query: GenerateWorkflowQueryDto) {
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

    return {
      business_category: dto.business_category,
      use_cases: dto.use_cases,
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

  @Post(':id/publish')
  async publish(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    await this.billing.assertPlatformAccess(userId);
    const workflow = await this.findOrFail(userId, id);
    const errors = this.validator.validate(workflow.definition as any);
    if (errors.length > 0) {
      throw new UnprocessableEntityException({ errors });
    }
    const updated = await this.prisma.workflow.update({
      where: { id },
      data: { status: 'published', isActive: true },
    });
    return { workflow: serializeWorkflow(updated) };
  }

  @Post(':id/unpublish')
  async unpublish(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    await this.findOrFail(userId, id);
    const updated = await this.prisma.workflow.update({
      where: { id },
      data: { status: 'draft', isActive: false },
    });
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
    return { workflow: serializeWorkflow(workflow) };
  }

  @Delete(':id')
  async destroy(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    // Must belong to the authenticated user and be visible in their current business scope.
    await this.findOrFail(userId, id);
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
