import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Workflow } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { LeadsService } from '../leads/leads.service';
import {
  buildSaveLeadApiConfig,
  LeadApiChannel,
} from '../leads/lead-api.config';
import { resolveLeadApiChannelFromTrigger } from './workflow-trigger-channel';
import { currentBusinessPublishedWhere, parseUseCases } from '../../common/workflow-scope';
import { validateBusinessSetup } from '../../platform/catalog-validation';
import { WORKFLOW_TEMPLATES, WorkflowDefinition, findTemplate } from './workflow-templates';
import { findAnyTemplate } from './business-workflow-templates';
import { AiWorkflowGeneratorService } from './ai-workflow-generator.service';
import {
  applyUseCaseTriggerKeywords,
  businessLabel,
  businessPromptPrefix,
  resolveTemplateSlug,
  shouldUseAiGeneration,
  useCaseLabel,
} from './business-workflow';
import { CAREER_AI_BUSINESS } from '../career/career.constants';

export interface TemplateSummary {
  slug: string;
  name: string;
  description: string;
  category: string;
  node_types: string[];
  node_count: number;
}

@Injectable()
export class WorkflowTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly aiGenerator: AiWorkflowGeneratorService,
    private readonly leads: LeadsService,
  ) {}

  listTemplates(): TemplateSummary[] {
    return WORKFLOW_TEMPLATES.map((t) => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
      category: t.category,
      node_types: this.extractNodeTypes(t.definition),
      node_count: t.definition.nodes?.length ?? 0,
    }));
  }

  async cloneForUser(userId: number, slug: string): Promise<Workflow | null> {
    const template = findTemplate(slug);
    if (!template) {
      return null;
    }

    const existing = await this.prisma.workflow.findFirst({
      where: { userId, sourceTemplate: slug },
    });
    if (existing) {
      return existing;
    }

    return this.prisma.workflow.create({
      data: {
        userId,
        name: template.name,
        description: template.description,
        status: 'draft',
        isActive: false,
        triggerType: template.trigger_type,
        definition: (await this.injectSaveLeadApi(userId, template.definition)) as any,
        sourceTemplate: slug,
      },
    });
  }

  /**
   * Saves business profile, enforces one active business at a time, and ensures
   * one workflow per selected use case for the current business.
   */
  async setupBusinessForUser(
    userId: number,
    businessCategory: string,
    useCases: string[],
    businessDescription?: string | null,
  ): Promise<Workflow[]> {
    const uniqueUseCases = [...new Set(useCases)];
    const currentCategory = await this.settings.get(userId, 'business_category');

    const validation = validateBusinessSetup({
      businessCategory,
      useCases: uniqueUseCases,
      currentCategory,
    });
    if (validation) {
      throw new UnprocessableEntityException({
        message: validation.message,
        errors: validation.errors,
      });
    }

    const currentSettings = await this.settings.getMany(userId, ['use_cases', 'use_case']);
    const currentUseCases = parseUseCases(currentSettings);
    const isBusinessChange = !!currentCategory && currentCategory !== businessCategory;

    if (isBusinessChange) {
      await this.assertNoPublishedWorkflows(userId, currentCategory, 'business_category');
      // Unpublish any other live workflows (legacy rows without businessCategory).
      await this.prisma.workflow.updateMany({
        where: {
          userId,
          isArchived: false,
          status: 'published',
          isActive: true,
        },
        data: { status: 'draft', isActive: false },
      });
      await this.prisma.workflow.updateMany({
        where: { userId, businessCategory: currentCategory, isArchived: false },
        data: { isArchived: true, status: 'draft', isActive: false },
      });
    } else if (currentCategory === businessCategory) {
      const removed = currentUseCases.filter((uc) => !uniqueUseCases.includes(uc));
      if (removed.length > 0) {
        const publishedRemoved = await this.prisma.workflow.count({
          where: {
            userId,
            businessCategory: currentCategory,
            isArchived: false,
            useCase: { in: removed },
            status: 'published',
            isActive: true,
          },
        });
        if (publishedRemoved > 0) {
          throw new UnprocessableEntityException({
            message: 'Pause published workflows before removing use cases.',
            errors: {
              use_cases: ['Unpublish workflows for use cases you want to remove.'],
            },
          });
        }
        await this.prisma.workflow.updateMany({
          where: {
            userId,
            businessCategory: currentCategory,
            isArchived: false,
            useCase: { in: removed },
          },
          data: { isArchived: true, status: 'draft', isActive: false },
        });
      }
    }

    await this.settings.set(userId, 'business_category', businessCategory);
    await this.settings.set(userId, 'use_cases', JSON.stringify(uniqueUseCases));
    if (businessDescription !== undefined && businessDescription !== null) {
      await this.settings.set(userId, 'business_description', businessDescription.trim());
    }
    if (businessCategory === 'salon') {
      await this.settings.ensureSalonServicesDefaults(userId);
    }

    // CareerAI uses a dedicated WhatsApp bot — no generic auto-reply workflows needed.
    if (businessCategory === CAREER_AI_BUSINESS) {
      return [];
    }

    const workflows: Workflow[] = [];
    for (const useCase of uniqueUseCases) {
      const workflow = await this.generateForUser(
        userId,
        businessCategory,
        useCase,
        businessDescription,
      );
      if (workflow) {
        workflows.push(workflow);
      }
    }

    return workflows;
  }

  private async assertNoPublishedWorkflows(
    userId: number,
    businessCategory: string,
    field: string,
  ): Promise<void> {
    const published = await this.prisma.workflow.count({
      where: currentBusinessPublishedWhere(userId, businessCategory),
    });
    if (published > 0) {
      throw new UnprocessableEntityException({
        message: 'Pause all published workflows before changing your business.',
        errors: {
          [field]: ['Unpublish every workflow for your current business first.'],
        },
      });
    }
  }

  /**
   * Builds a workflow tailored to a business + use case. Uses AI generation for
   * "Other" businesses (Phase 4), otherwise clones the closest curated template.
   */
  async generateForUser(
    userId: number,
    businessCategory: string,
    useCase: string,
    businessDescription?: string | null,
  ): Promise<Workflow | null> {
    const existing = await this.prisma.workflow.findFirst({
      where: { userId, businessCategory, useCase, isArchived: false },
    });
    if (existing) {
      return existing;
    }

    const description =
      businessDescription?.trim() ||
      (await this.settings.get(userId, 'business_description')) ||
      null;

    const name = `${businessLabel(businessCategory)} · ${useCaseLabel(useCase)}`;

    if (shouldUseAiGeneration(businessCategory)) {
      const aiResult = await this.aiGenerator.generate(
        userId,
        businessCategory,
        useCase,
        description,
      );

      if (aiResult) {
        let definition = applyUseCaseTriggerKeywords(aiResult.definition, useCase);
        definition = await this.injectSaveLeadApi(userId, definition);
        return this.prisma.workflow.create({
          data: {
            userId,
            name,
            description: aiResult.summary,
            status: 'draft',
            isActive: false,
            triggerType: 'message_received',
            definition: definition as any,
            sourceTemplate: 'ai-generated',
            businessCategory,
            useCase,
          },
        });
      }
      // Fall through to generic template if AI unavailable or invalid.
    }

    return this.generateFromTemplate(userId, businessCategory, useCase, name);
  }

  /** Preview which template or generation mode would be used. */
  previewGeneration(
    businessCategory: string,
    useCase: string,
    businessDescription?: string | null,
  ) {
    if (shouldUseAiGeneration(businessCategory)) {
      const desc = businessDescription?.trim();
      return {
        template_slug: 'ai-generated',
        template_name: 'AI-Generated Workflow',
        description: desc
          ? `AI will design a custom ${useCaseLabel(useCase).toLowerCase()} workflow for: ${desc}`
          : `AI will design a custom ${useCaseLabel(useCase).toLowerCase()} workflow for your business.`,
        node_count: null,
        node_types: ['trigger', 'collect_input', 'ai', 'send_message'],
        is_guided: false,
        generation_mode: 'ai',
      };
    }

    const slug = resolveTemplateSlug(businessCategory, useCase);
    const template = findAnyTemplate(slug);
    if (!template) {
      return null;
    }
    return {
      template_slug: slug,
      template_name: template.name,
      description: template.description,
      node_count: template.definition.nodes?.length ?? 0,
      node_types: this.extractNodeTypes(template.definition),
      is_guided: template.category === 'guided',
      generation_mode: 'template',
    };
  }

  private async generateFromTemplate(
    userId: number,
    businessCategory: string,
    useCase: string,
    name: string,
  ): Promise<Workflow | null> {
    const slug = resolveTemplateSlug(businessCategory, useCase);
    const template = findAnyTemplate(slug);
    if (!template) {
      return null;
    }

    let definition =
      template.category === 'guided'
        ? (JSON.parse(JSON.stringify(template.definition)) as WorkflowDefinition)
        : this.personalizeDefinition(template.definition, businessCategory);

    definition = applyUseCaseTriggerKeywords(definition, useCase);
    definition = await this.injectSaveLeadApi(userId, definition);

    return this.prisma.workflow.create({
      data: {
        userId,
        name,
        description: `Auto-generated for ${businessLabel(businessCategory)} (${useCaseLabel(useCase)}). Based on "${template.name}".`,
        status: 'draft',
        isActive: false,
        triggerType: template.trigger_type,
        definition: definition as any,
        sourceTemplate: slug,
        businessCategory,
        useCase,
      },
    });
  }

  /** Deep-clones a definition and prepends business context to every AI node prompt. */
  private personalizeDefinition(
    definition: WorkflowDefinition,
    businessCategory: string,
  ): WorkflowDefinition {
    const clone: WorkflowDefinition = JSON.parse(JSON.stringify(definition));
    const prefix = businessPromptPrefix(businessCategory);

    for (const node of clone.nodes ?? []) {
      if (node.type === 'ai' && node.data && typeof node.data.prompt === 'string') {
        if (!node.data.prompt.startsWith(prefix)) {
          node.data.prompt = `${prefix}${node.data.prompt}`;
        }
      }
    }

    return clone;
  }

  async seedAllForUser(userId: number): Promise<Workflow[]> {
    const created: Workflow[] = [];
    for (const template of WORKFLOW_TEMPLATES) {
      const existing = await this.prisma.workflow.findFirst({
        where: { userId, sourceTemplate: template.slug },
      });
      if (!existing) {
        const workflow = await this.cloneForUser(userId, template.slug);
        if (workflow) {
          created.push(workflow);
        }
      }
    }
    return created;
  }

  private extractNodeTypes(definition: WorkflowDefinition): string[] {
    return [...new Set((definition.nodes ?? []).map((n) => n.type))];
  }

  /** Fills save_lead nodes with this user's real API URL and Bearer token. */
  async injectSaveLeadApi(
    userId: number,
    definition: WorkflowDefinition,
  ): Promise<WorkflowDefinition> {
    const token = await this.leads.getOrCreateApiBearerToken(userId);
    const baseUrl = this.leads.resolveApiBaseUrl();
    const def = JSON.parse(JSON.stringify(definition)) as WorkflowDefinition;
    const trigger = (def.nodes ?? []).find((n) => n.type === 'trigger');
    const leadChannel = resolveLeadApiChannelFromTrigger(
      trigger?.data as Record<string, unknown> | undefined,
    ) as LeadApiChannel;

    for (const node of def.nodes ?? []) {
      if (node.type !== 'save_lead') {
        continue;
      }
      const collectedFields = Array.isArray(node.data?.collected_fields)
        ? (node.data.collected_fields as string[])
        : [];
      const notes = typeof node.data?.notes === 'string' ? node.data.notes : undefined;
      node.data = {
        ...node.data,
        api: buildSaveLeadApiConfig({
          apiBaseUrl: baseUrl,
          bearerToken: token,
          collectedFields,
          notes,
          channel: leadChannel,
        }),
      };
    }

    return def;
  }
}
