import { Injectable } from '@nestjs/common';
import { Workflow } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { WORKFLOW_TEMPLATES, WorkflowDefinition, findTemplate } from './workflow-templates';
import { findAnyTemplate } from './business-workflow-templates';
import { AiWorkflowGeneratorService } from './ai-workflow-generator.service';
import {
  businessLabel,
  businessPromptPrefix,
  resolveTemplateSlug,
  shouldUseAiGeneration,
  useCaseLabel,
} from './business-workflow';

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
        definition: template.definition as any,
        sourceTemplate: slug,
      },
    });
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
        return this.prisma.workflow.create({
          data: {
            userId,
            name,
            description: aiResult.summary,
            status: 'draft',
            isActive: false,
            triggerType: 'message_received',
            definition: aiResult.definition as any,
            sourceTemplate: 'ai-generated',
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

    const definition =
      template.category === 'guided'
        ? (JSON.parse(JSON.stringify(template.definition)) as WorkflowDefinition)
        : this.personalizeDefinition(template.definition, businessCategory);

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
}
