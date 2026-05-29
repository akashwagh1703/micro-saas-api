import { Injectable, Logger } from '@nestjs/common';
import axios, { Method } from 'axios';

export interface ExternalApiResult {
  success: boolean;
  status?: number;
  data?: any;
  error?: string;
}

/** Executes the generic HTTP "API" workflow node with {{variable}} substitution. */
@Injectable()
export class ExternalApiService {
  private readonly logger = new Logger(ExternalApiService.name);

  async execute(
    config: Record<string, any>,
    variables: Record<string, any> = {},
  ): Promise<ExternalApiResult> {
    const url = this.replaceVariables(config.url ?? '', variables);
    const method = String(config.method ?? 'GET').toUpperCase();
    const headers = this.buildHeaders(config.headers ?? {}, variables);
    const body = this.replaceVariablesInObject(config.body ?? {}, variables);
    const timeout = parseInt(String(config.timeout ?? 15), 10) * 1000;
    const retries = parseInt(String(config.retries ?? 1), 10);

    let lastError: string | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const isBodyMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
        const response = await axios.request({
          url,
          method: method as Method,
          headers,
          timeout,
          validateStatus: () => true,
          ...(isBodyMethod ? { data: body } : { params: body }),
        });

        return {
          success: response.status >= 200 && response.status < 300,
          status: response.status,
          data: response.data,
        };
      } catch (e: any) {
        lastError = e.message;
        this.logger.warn(`API node attempt ${attempt} failed: ${lastError}`);
      }
    }

    return { success: false, error: lastError ?? 'API request failed' };
  }

  private buildHeaders(
    headers: Record<string, any>,
    variables: Record<string, any>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      result[key] = this.replaceVariables(String(value), variables);
    }
    return result;
  }

  private replaceVariables(text: string, variables: Record<string, any>): string {
    let result = text;
    for (const [key, value] of Object.entries(variables)) {
      result = result.split(`{{${key}}}`).join(String(value ?? ''));
    }
    return result;
  }

  private replaceVariablesInObject(data: any, variables: Record<string, any>): any {
    try {
      const json = JSON.stringify(data ?? {});
      const replaced = this.replaceVariables(json, variables);
      return JSON.parse(replaced);
    } catch {
      return {};
    }
  }
}
