import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../integrations/ai.service';
import { WorkflowDefinition } from './workflow-templates';
import { WorkflowValidator } from './workflow-validator.service';
import { businessLabel, useCaseLabel } from './business-workflow';

const ALLOWED_NODE_TYPES = new Set([
  'trigger',
  'condition',
  'collect_input',
  'ai',
  'send_message',
  'api',
]);

export interface AiGeneratedWorkflow {
  definition: WorkflowDefinition;
  summary: string;
}

/**
 * Phase 4: uses AI to draft a workflow definition for "Other" businesses (and as a
 * fallback when curated templates do not fit). Output is validated before use.
 */
@Injectable()
export class AiWorkflowGeneratorService {
  private readonly logger = new Logger(AiWorkflowGeneratorService.name);

  constructor(
    private readonly ai: AiService,
    private readonly validator: WorkflowValidator,
  ) {}

  async generate(
    userId: number,
    businessCategory: string,
    useCase: string,
    businessDescription?: string | null,
  ): Promise<AiGeneratedWorkflow | null> {
    const basePrompt = this.buildPrompt(
      businessLabel(businessCategory),
      useCaseLabel(useCase),
      useCase,
      businessDescription,
    );

    let lastErrors: string[] = [];

    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt =
        attempt === 0
          ? basePrompt
          : `${basePrompt}\n\nYour previous JSON failed validation:\n${lastErrors.join('\n')}\n\nFix the issues and return ONLY valid JSON.`;

      const result = await this.ai.complete(userId, prompt, {
        temperature: 0.35,
        max_tokens: 3500,
      });

      if (!result.success || !result.content) {
        this.logger.warn(`AI workflow generation failed: ${result.error}`);
        return null;
      }

      const parsed = this.parseResponse(result.content);
      if (!parsed?.definition) {
        lastErrors = ['Response was not valid JSON with a definition object'];
        continue;
      }

      const definition = this.normalizeDefinition(parsed.definition);
      lastErrors = this.validator.validate(definition);

      if (lastErrors.length === 0) {
        return {
          definition,
          summary: String(parsed.summary ?? `AI workflow for ${useCaseLabel(useCase)}`),
        };
      }

      this.logger.warn(`AI workflow validation failed (attempt ${attempt + 1}): ${lastErrors.join('; ')}`);
    }

    return null;
  }

  private buildPrompt(
    businessName: string,
    useCaseName: string,
    useCase: string,
    businessDescription?: string | null,
  ): string {
    const businessLine = businessDescription?.trim()
      ? `${businessName} — ${businessDescription.trim()}`
      : businessName;

    const useCaseHints: Record<string, string> = {
      lead_generation:
        'Use 2–4 collect_input nodes to qualify the lead (e.g. need, budget, timeline), then api to save lead, then send_message confirmation.',
      appointment_booking:
        'Use collect_input nodes for date/time and reason, then send_message confirmation. Optionally one ai node for scheduling help.',
      faq_bot:
        'Use condition node(s) on keywords OR ai node for flexible answers, then send_message.',
      customer_support:
        'Use ai node with a helpful support prompt, then send_message with {{ai_response}}.',
      sales_assistant:
        'Use ai node tuned for sales, optionally collect_input for contact details, then send_message.',
      ai_chat:
        'Use ai node for conversational replies, then send_message with {{ai_response}}.',
    };

    return `You design WhatsApp automation workflows. Return ONLY valid JSON (no markdown fences) in this exact shape:
{
  "summary": "short one-line description",
  "definition": {
    "nodes": [ ... ],
    "edges": [ ... ]
  }
}

ALLOWED node types: trigger, collect_input, ai, send_message, api, condition

RULES:
- Exactly ONE trigger node with id "trigger-1" and type "trigger"
- Nodes must form a connected linear flow (edges link them in order)
- Each node needs: id (unique string), type, position {x,y}, data object
- position.y starts at 80 and increases by 120 for each subsequent node; position.x is 200
- trigger data: { "label": "Message Received" }
- collect_input data: { "label": "...", "field": "snake_case_name", "question": "..." }
- ai data: { "label": "...", "provider": "openrouter", "model": "openai/gpt-4o-mini", "prompt": "...", "temperature": 0.6, "max_tokens": 250, "fallback_message": "..." }
- send_message data: { "label": "...", "message": "..." } — use {{contact_name}}, {{message}}, {{ai_response}}, and collect_input field names as {{field}}
- api data (optional for leads): { "label": "Save Lead", "url": "https://your-crm.com/api/leads", "method": "POST", "headers": {"Content-Type":"application/json"}, "body": {"phone":"{{contact_phone}}","name":"{{contact_name}}"}, "timeout": 15, "retries": 2, "use_fallback": true }
- condition data: { "label": "...", "field": "message", "operator": "contains", "value": "keyword" } — only if needed; use sourceHandle "true" on edges from condition
- edges: { "id": "e1", "source": "node-id", "target": "node-id", "sourceHandle": null } (sourceHandle "true"/"false" only for condition branches)
- Maximum 10 nodes
- Keep messages concise and professional for WhatsApp

Business: ${businessLine}
Use case: ${useCaseName}
Guidance: ${useCaseHints[useCase] ?? 'Design a practical automation for this use case.'}

Design the workflow now. JSON only.`;
  }

  private parseResponse(content: string): { summary?: string; definition?: WorkflowDefinition } | null {
    try {
      const trimmed = content.trim();
      const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const jsonText = fenced ? fenced[1].trim() : trimmed;
      return JSON.parse(jsonText);
    } catch {
      return null;
    }
  }

  private normalizeDefinition(raw: WorkflowDefinition): WorkflowDefinition {
    const nodes = (raw.nodes ?? []).filter((n) => ALLOWED_NODE_TYPES.has(n.type));
    const edges = raw.edges ?? [];

    nodes.forEach((node, index) => {
      if (!node.position) {
        node.position = { x: 200, y: 80 + index * 120 };
      }
      if (!node.data) {
        node.data = {};
      }
      if (node.type === 'trigger' && !node.data.label) {
        node.data.label = 'Message Received';
      }
      if (node.type === 'ai') {
        node.data.provider ??= 'openrouter';
        node.data.model ??= 'openai/gpt-4o-mini';
        node.data.temperature ??= 0.6;
        node.data.max_tokens ??= 250;
      }
    });

    return { nodes, edges };
  }
}
