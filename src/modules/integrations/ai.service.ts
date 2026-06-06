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
    const prompt = this.replaceVariables(config.prompt ?? '', variables);
    const result = await this.complete(userId, prompt, {
      provider: config.provider,
      model: config.model,
      temperature: config.temperature,
      max_tokens: config.max_tokens ?? 256,
    });

    if (!result.success) {
      return { ...result, fallback: config.fallback_message ?? null };
    }
    return result;
  }

  /** Raw chat completion using the user's configured AI provider (or overrides). */
  async complete(
    userId: number,
    prompt: string,
    options: {
      provider?: string;
      model?: string;
      temperature?: number;
      max_tokens?: number;
    } = {},
  ): Promise<AiResult> {
    const provider =
      options.provider ?? (await this.settings.get(userId, 'ai_provider')) ?? 'openrouter';
    const model =
      options.model ?? (await this.settings.get(userId, 'ai_model')) ?? 'openai/gpt-4o-mini';
    const temperature = Number(options.temperature ?? 0.4);
    const maxTokens = parseInt(String(options.max_tokens ?? 256), 10);

    const apiKey =
      provider === 'openai'
        ? await this.settings.get(userId, 'openai_api_key')
        : await this.settings.get(userId, 'openrouter_api_key');

    if (!apiKey) {
      return {
        success: false,
        error: 'AI API key not configured',
        fallback: null,
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
          timeout: 60000,
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
        fallback: null,
      };
    } catch (e: any) {
      this.logger.error(`AI completion failed: ${e.message}`);
      return { success: false, error: e.message, fallback: null };
    }
  }

  /**
   * Multi-turn chat completion — accepts a full messages array so callers can
   * pass a system role and conversation history.
   * Uses the same provider/model resolution as complete().
   */
  async completeWithMessages(
    userId: number,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options: {
      model?: string;
      temperature?: number;
      max_tokens?: number;
    } = {},
  ): Promise<AiResult> {
    const provider = (await this.settings.get(userId, 'ai_provider')) ?? 'openrouter';
    const model    = options.model ?? (await this.settings.get(userId, 'ai_model')) ?? 'openai/gpt-4o-mini';
    const temperature = Number(options.temperature ?? 0.5);
    const maxTokens   = parseInt(String(options.max_tokens ?? 512), 10);

    const apiKey =
      provider === 'openai'
        ? await this.settings.get(userId, 'openai_api_key')
        : await this.settings.get(userId, 'openrouter_api_key');

    if (!apiKey) {
      return { success: false, error: 'AI API key not configured', fallback: null };
    }

    try {
      const baseUrl =
        provider === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1';

      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        { model, messages, temperature, max_tokens: maxTokens },
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 60000,
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
      return { success: false, error: response.data?.error?.message ?? 'AI request failed' };
    } catch (e: any) {
      this.logger.error(`AI (messages) completion failed: ${e.message}`);
      return { success: false, error: e.message };
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
