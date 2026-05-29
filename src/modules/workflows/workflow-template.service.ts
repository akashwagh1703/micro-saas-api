import { Injectable } from '@nestjs/common';
import { Workflow } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WORKFLOW_TEMPLATES, WorkflowDefinition, findTemplate } from './workflow-templates';

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
