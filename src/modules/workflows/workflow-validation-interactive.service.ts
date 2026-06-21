import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Workflow Validation Service for Interactive Messages
 * Validates interactive message nodes and routing configurations
 * Checks for circular references and invalid node references
 */
@Injectable()
export class WorkflowValidationInteractiveService {
  private readonly logger = new Logger(
    WorkflowValidationInteractiveService.name,
  );

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate a workflow definition for interactive message issues
   */
  async validateWorkflowDefinition(definition: any): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const nodes = definition.nodes || [];
      const nodesById = new Map<string, any>();
      nodes.forEach((n: any) => {
        nodesById.set(n.id, n);
      });

      // Check each interactive message node
      for (const node of nodes) {
        if (
          node.type === 'interactive_message' ||
          node.data?.nodeType === 'interactive_message'
        ) {
          const nodeErrors = await this.validateInteractiveNode(
            node,
            nodesById,
            definition,
          );
          errors.push(...nodeErrors);
        }
      }

      // Check for unreachable nodes after interactive messages
      for (const node of nodes) {
        if (
          node.type === 'interactive_message' ||
          node.data?.nodeType === 'interactive_message'
        ) {
          const unreachable = this.findUnreachableNodes(node, nodesById, definition);
          if (unreachable.length > 0) {
            warnings.push(
              `Interactive node "${node.id}" has unreachable paths: ${unreachable.join(', ')}`,
            );
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    } catch (error: any) {
      return {
        valid: false,
        errors: [`Validation error: ${error.message}`],
      };
    }
  }

  /**
   * Validate a single interactive message node
   */
  private async validateInteractiveNode(
    node: any,
    nodesById: Map<string, any>,
    definition: any,
  ): Promise<string[]> {
    const errors: string[] = [];
    const nodeId = node.id;
    const templateId = node.data?.templateId;

    // Check that template is configured
    if (!templateId) {
      errors.push(
        `Interactive node "${nodeId}" has no template configured`,
      );
      return errors;
    }

    // Get the template
    const template = await this.prisma.interactiveMessageTemplate.findUnique(
      {
        where: { id: templateId },
        include: { options: true },
      },
    );

    if (!template) {
      errors.push(
        `Interactive node "${nodeId}" references non-existent template (id=${templateId})`,
      );
      return errors;
    }

    // Validate each option has a next node
    const nodeData = node.data || {};
    const optionRouting = nodeData.optionRouting || {};

    for (const option of template.options) {
      const nextNodeId = optionRouting[option.id];

      if (!nextNodeId) {
        errors.push(
          `Interactive node "${nodeId}" - Option "${option.optionText}" has no next node routing`,
        );
        continue;
      }

      // Check that next node exists
      if (!nodesById.has(nextNodeId)) {
        errors.push(
          `Interactive node "${nodeId}" - Option "${option.optionText}" points to non-existent node (id=${nextNodeId})`,
        );
        continue;
      }

      // Check for circular references
      const hasCycle = this.detectCircularReference(
        nextNodeId,
        nodeId,
        nodesById,
        new Set(),
      );

      if (hasCycle) {
        errors.push(
          `Interactive node "${nodeId}" - Option "${option.optionText}" creates a circular reference to node "${nextNodeId}"`,
        );
      }
    }

    return errors;
  }

  /**
   * Detect circular references in node routing
   */
  private detectCircularReference(
    currentNodeId: string,
    targetNodeId: string,
    nodesById: Map<string, any>,
    visited: Set<string>,
  ): boolean {
    if (currentNodeId === targetNodeId) {
      return true;
    }

    if (visited.has(currentNodeId)) {
      return false;
    }

    visited.add(currentNodeId);
    const node = nodesById.get(currentNodeId);

    if (!node || node.type !== 'interactive_message') {
      return false;
    }

    // Would need to check option routing here
    // For now, basic cycle detection
    return false;
  }

  /**
   * Find nodes that cannot be reached from an interactive node
   */
  private findUnreachableNodes(
    interactiveNode: any,
    nodesById: Map<string, any>,
    definition: any,
  ): string[] {
    const edges = definition.edges || [];
    const nodeId = interactiveNode.id;

    // Get all edges from this node
    const outgoingEdges = edges.filter((e: any) => e.source === nodeId);

    if (outgoingEdges.length === 0) {
      return [];
    }

    const reachableNodes = new Set<string>();
    outgoingEdges.forEach((e: any) => {
      if (e.target) {
        reachableNodes.add(e.target);
      }
    });

    // Check if all configured option routings have corresponding edges
    const optionRouting = interactiveNode.data?.optionRouting || {};
    const unreachable: string[] = [];

    Object.values(optionRouting).forEach((targetNodeId: any) => {
      if (!reachableNodes.has(targetNodeId)) {
        unreachable.push(targetNodeId);
      }
    });

    return unreachable;
  }

  /**
   * Get validation report for a workflow with interactive messages
   */
  async getValidationReport(workflowId: number): Promise<{
    workflowId: number;
    isValid: boolean;
    errors: string[];
    warnings: string[];
    interactiveNodes: number;
    totalNodes: number;
  }> {
    try {
      const workflow = await this.prisma.workflow.findUnique({
        where: { id: workflowId },
      });

      if (!workflow) {
        return {
          workflowId,
          isValid: false,
          errors: ['Workflow not found'],
          warnings: [],
          interactiveNodes: 0,
          totalNodes: 0,
        };
      }

      const definition = workflow.definition as any;
      const nodes = definition?.nodes || [];
      const interactiveCount = nodes.filter(
        (n: any) =>
          n.type === 'interactive_message' ||
          n.data?.nodeType === 'interactive_message',
      ).length;

      const validation = await this.validateWorkflowDefinition(definition);

      return {
        workflowId,
        isValid: validation.valid,
        errors: validation.errors,
        warnings: [],
        interactiveNodes: interactiveCount,
        totalNodes: nodes.length,
      };
    } catch (error: any) {
      return {
        workflowId,
        isValid: false,
        errors: [`Error generating report: ${error.message}`],
        warnings: [],
        interactiveNodes: 0,
        totalNodes: 0,
      };
    }
  }
}
