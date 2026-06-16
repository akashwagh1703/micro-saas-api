import { Injectable, Logger } from '@nestjs/common';
import axios, { Method } from 'axios';
import { assertAllowedUrl, guardedHttpAgents } from '../../common/net/ssrf-guard';
import { applyResponseMapping } from '../../common/template-variables.util';
import { CredentialVaultService } from './credential-vault.service';

export interface ExternalApiResult {
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
  mapped?: Record<string, unknown>;
}

export interface ExternalApiExecuteOptions {
  userId?: number;
}

/** Executes the generic HTTP "API" workflow node with {{variable}} and {{vault:name}} substitution. */
@Injectable()
export class ExternalApiService {
  private readonly logger = new Logger(ExternalApiService.name);

  constructor(private readonly vault: CredentialVaultService) {}

  async execute(
    config: Record<string, any>,
    variables: Record<string, any> = {},
    options: ExternalApiExecuteOptions = {},
  ): Promise<ExternalApiResult> {
    const userId = options.userId;
    const method = String(config.method ?? 'GET').toUpperCase();
    const rawHeaders = config.headers ?? {};
    const bodySource = config.body ?? {};
    const timeout = parseInt(String(config.timeout ?? 15), 10) * 1000;
    const retries = parseInt(String(config.retries ?? 1), 10);

    let url: string;
    let headers: Record<string, string>;
    let body: unknown;

    try {
      if (userId) {
        url = await this.vault.resolveTemplateString(userId, config.url ?? '', variables);
        headers = this.buildHeaders(
          (await this.vault.resolveTemplateObject(userId, rawHeaders, variables)) as Record<
            string,
            unknown
          >,
        );
        body = await this.vault.resolveTemplateObject(userId, bodySource, variables);
        const authHeaders = await this.vault.buildAuthHeaders(userId, config.auth_ref);
        headers = { ...headers, ...authHeaders };
      } else {
        url = this.replaceVariables(config.url ?? '', variables);
        headers = this.buildHeaders(this.replaceVariablesInObject(rawHeaders, variables));
        body = this.replaceVariablesInObject(bodySource, variables);
      }

      assertAllowedUrl(url);
    } catch (e: any) {
      this.logger.warn(`API node blocked: ${e.message}`);
      return { success: false, error: e.message };
    }

    const { httpAgent, httpsAgent } = guardedHttpAgents();
    let lastError: string | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const isBodyMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
        const response = await axios.request({
          url,
          method: method as Method,
          headers,
          timeout,
          httpAgent,
          httpsAgent,
          maxRedirects: 3,
          validateStatus: () => true,
          ...(isBodyMethod ? { data: body } : { params: body }),
        });

        const success = response.status >= 200 && response.status < 300;
        const mapped = applyResponseMapping(response.data, config.response_mapping);

        return {
          success,
          status: response.status,
          data: response.data,
          mapped,
          error: success ? undefined : `HTTP ${response.status}`,
        };
      } catch (e: any) {
        lastError = e.message;
        this.logger.warn(`API node attempt ${attempt} failed: ${lastError}`);
      }
    }

    return { success: false, error: lastError ?? 'API request failed' };
  }

  private buildHeaders(headers: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      result[key] = String(value ?? '');
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
