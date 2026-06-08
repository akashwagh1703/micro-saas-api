import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../../settings/settings.service';

export interface CareerAiUsageStats {
  month: string;
  total_tokens: number;
  requests: number;
  by_context: Record<string, number>;
}

const USAGE_KEY = 'career_ai_usage';

@Injectable()
export class CareerAiUsageService {
  constructor(
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  async record(
    userId: number,
    context: string,
    usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number } | null,
  ): Promise<void> {
    const month = new Date().toISOString().slice(0, 7);
    const tokens =
      usage?.total_tokens ??
      (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);

    const raw = await this.settings.get(userId, USAGE_KEY);
    let stats: CareerAiUsageStats = {
      month,
      total_tokens: 0,
      requests: 0,
      by_context: {},
    };

    if (raw) {
      try {
        stats = JSON.parse(raw) as CareerAiUsageStats;
      } catch {
        // reset corrupt value
      }
    }

    if (stats.month !== month) {
      stats = { month, total_tokens: 0, requests: 0, by_context: {} };
    }

    stats.total_tokens += tokens;
    stats.requests += 1;
    stats.by_context[context] = (stats.by_context[context] ?? 0) + 1;

    await this.settings.set(userId, USAGE_KEY, JSON.stringify(stats));
  }

  async getMonthlyStats(userId: number): Promise<CareerAiUsageStats> {
    const month = new Date().toISOString().slice(0, 7);
    const raw = await this.settings.get(userId, USAGE_KEY);
    if (!raw) {
      return { month, total_tokens: 0, requests: 0, by_context: {} };
    }
    try {
      const stats = JSON.parse(raw) as CareerAiUsageStats;
      if (stats.month !== month) {
        return { month, total_tokens: 0, requests: 0, by_context: {} };
      }
      return stats;
    } catch {
      return { month, total_tokens: 0, requests: 0, by_context: {} };
    }
  }

  /** Soft limit — returns false when monthly token budget is exceeded. */
  async isWithinLimit(userId: number): Promise<{ allowed: boolean; message?: string }> {
    const limitRaw = this.config.get<string>('CAREER_AI_MONTHLY_TOKEN_LIMIT');
    const limit = parseInt(limitRaw ?? '0', 10);
    if (!limit || Number.isNaN(limit)) {
      return { allowed: true };
    }

    const stats = await this.getMonthlyStats(userId);
    if (stats.total_tokens >= limit) {
      return {
        allowed: false,
        message:
          'CareerAI AI usage limit reached for this month. Please try again next month or contact support.',
      };
    }
    return { allowed: true };
  }
}
