import { Injectable } from '@nestjs/common';

interface Node {
  id: string;
  type: string;
  data?: Record<string, any>;
}
interface Edge {
  source?: string;
  target?: string;
  sourceHandle?: string | null;
}
interface Definition {
  nodes?: Node[];
  edges?: Edge[];
}

/** Structural validation of a workflow definition (ported from WorkflowValidator). */
@Injectable()
export class WorkflowValidator {
  validate(definition: Definition | null | undefined): string[] {
    const errors: string[] = [];

    if (!definition || !definition.nodes || definition.nodes.length === 0) {
      errors.push('Workflow must have at least one node');
      return errors;
    }

    const nodes = definition.nodes;
    const edges = definition.edges ?? [];

    const triggerNodes = nodes.filter((n) => n.type === 'trigger');
    if (triggerNodes.length === 0) {
      errors.push('Workflow must have a trigger node');
    }
    if (triggerNodes.length > 1) {
      errors.push('Workflow can only have one trigger node');
    }

    const nodeIds = nodes.map((n) => n.id);
    const connected: Record<string, boolean> = {};

    for (const edge of edges) {
      connected[edge.source ?? ''] = true;
      connected[edge.target ?? ''] = true;
      if (edge.source === edge.target) {
        errors.push('Circular loop detected');
      }
    }

    for (const node of nodes) {
      if (node.type !== 'trigger' && !connected[node.id]) {
        errors.push(`Node ${node.id} is disconnected`);
      }
      if (node.type === 'collect_input') {
        const field = node.data?.field;
        const question = node.data?.question;
        if (!field || !String(field).trim()) {
          errors.push(`collect_input node ${node.id} requires a field name`);
        }
        if (!question || !String(question).trim()) {
          errors.push(`collect_input node ${node.id} requires a question`);
        }
      }
    }

    if (this.hasCycle(edges, nodeIds)) {
      errors.push('Workflow contains circular dependencies');
    }

    return errors;
  }

  private hasCycle(edges: Edge[], nodeIds: string[]): boolean {
    const graph: Record<string, string[]> = {};
    for (const id of nodeIds) {
      graph[id] = [];
    }
    for (const edge of edges) {
      if (edge.source !== undefined && graph[edge.source]) {
        graph[edge.source].push(edge.target ?? '');
      }
    }

    const visited: Record<string, boolean> = {};
    const stack: Record<string, boolean> = {};

    const dfs = (node: string): boolean => {
      if (stack[node]) return true;
      if (visited[node]) return false;
      visited[node] = true;
      stack[node] = true;
      for (const neighbor of graph[node] ?? []) {
        if (dfs(neighbor)) return true;
      }
      delete stack[node];
      return false;
    };

    return nodeIds.some((id) => dfs(id));
  }
}
