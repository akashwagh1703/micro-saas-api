import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { SettingsService } from '../settings/settings.service';

export interface AiResult {
  success: boolean;
  content?: string | null;
  usage?: any;
  error?: string;
  fallback?: string | null;
}

/** Generates chat completions for AI workflow nodes (OpenAI or OpenRouter). */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly settings: SettingsService) {}

  async generate(
    userId: number,
    config: Record<string, any>,
    variables: Record<string, any> = {},
  ): Promise<AiResult> {
    const provider = config.provider ?? 'openrouter';
    const prompt = this.replaceVariables(config.prompt ?? '', variables);
    const model = config.model ?? 'openai/gpt-4o-mini';
    const temperature = Number(config.temperature ?? 0.7);
    const maxTokens = parseInt(String(config.max_tokens ?? 256), 10);

    const apiKey =
      provider === 'openai'
        ? await this.settings.get(userId, 'openai_api_key')
        : await this.settings.get(userId, 'openrouter_api_key');

    if (!apiKey) {
      return {
        success: false,
        error: 'AI API key not configured',
        fallback: config.fallback_message ?? null,
      };
    }

    try {
      const baseUrl =
        provider === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1';

      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          max_tokens: maxTokens,
        },
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 30000,
          validateStatus: () => true,
        },
      );

      if (response.status >= 200 && response.status < 300) {
        return {
          success: true,
          content: response.data?.choices?.[0]?.message?.content ?? null,
          usage: response.data?.usage ?? null,
        };
      }

      return {
        success: false,
        error: response.data?.error?.message ?? 'AI request failed',
        fallback: config.fallback_message ?? null,
      };
    } catch (e: any) {
      this.logger.error(`AI generation failed: ${e.message}`);
      return { success: false, error: e.message, fallback: config.fallback_message ?? null };
    }
  }

  private replaceVariables(text: string, variables: Record<string, any>): string {
    let result = text;
    for (const [key, value] of Object.entries(variables)) {
      result = result.split(`{{${key}}}`).join(String(value ?? ''));
    }
    return result;
  }
}
