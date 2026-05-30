import { Injectable } from '@nestjs/common';
import { Workflow } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WORKFLOW_TEMPLATES, WorkflowDefinition, findTemplate } from './workflow-templates';
import { findAnyTemplate } from './business-workflow-templates';
import {
  businessLabel,
  businessPromptPrefix,
  resolveTemplateSlug,
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
  constructor(private readonly prisma: PrismaService) {}

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
   * Builds a workflow tailored to a business + use case: picks the closest
   * starter template, personalizes its AI prompts with business context, and
   * saves it as a fresh draft (always created, never deduped).
   */
  async generateForUser(
    userId: number,
    businessCategory: string,
    useCase: string,
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
    const name = `${businessLabel(businessCategory)} · ${useCaseLabel(useCase)}`;

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

  /** Preview which template would be generated for a business + use case pair. */
  previewGeneration(businessCategory: string, useCase: string) {
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
    };
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
