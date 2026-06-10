import { CareerJob } from '@prisma/client';
import { normalizeSkillToken } from './job-sources/job-source.utils';

export const MATCH_LEARNING_KEY = 'match_learning';

export const MATCH_FEEDBACK_EVENTS = [
  'viewed',
  'applied',
  'dismissed',
  'cover_letter_generated',
] as const;

export type MatchFeedbackEvent = (typeof MATCH_FEEDBACK_EVENTS)[number];

export interface MatchLearningPrefs {
  companyBoost: Record<string, number>;
  titleBoost: Record<string, number>;
  skillBoost: Record<string, number>;
  blockedCompanies: string[];
  blockedTitleTokens: string[];
  eventCounts: {
    applied: number;
    dismissed: number;
    cover_letter: number;
  };
  updatedAt?: string;
}

export function emptyMatchLearningPrefs(): MatchLearningPrefs {
  return {
    companyBoost: {},
    titleBoost: {},
    skillBoost: {},
    blockedCompanies: [],
    blockedTitleTokens: [],
    eventCounts: { applied: 0, dismissed: 0, cover_letter: 0 },
  };
}

export function readMatchLearningPrefs(onboardingData: unknown): MatchLearningPrefs {
  const data = (onboardingData as Record<string, unknown>) ?? {};
  const raw = data[MATCH_LEARNING_KEY] as Partial<MatchLearningPrefs> | undefined;
  const base = emptyMatchLearningPrefs();

  if (!raw || typeof raw !== 'object') {
    return base;
  }

  return {
    companyBoost: sanitizeBoostMap(raw.companyBoost),
    titleBoost: sanitizeBoostMap(raw.titleBoost),
    skillBoost: sanitizeBoostMap(raw.skillBoost),
    blockedCompanies: sanitizeStringList(raw.blockedCompanies),
    blockedTitleTokens: sanitizeStringList(raw.blockedTitleTokens),
    eventCounts: {
      applied: positiveInt(raw.eventCounts?.applied),
      dismissed: positiveInt(raw.eventCounts?.dismissed),
      cover_letter: positiveInt(raw.eventCounts?.cover_letter),
    },
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  };
}

export function mergeMatchLearningPrefs(
  existing: unknown,
  patch: Partial<MatchLearningPrefs>,
): MatchLearningPrefs {
  const current = readMatchLearningPrefs(existing);
  return {
    companyBoost: { ...current.companyBoost, ...(patch.companyBoost ?? {}) },
    titleBoost: { ...current.titleBoost, ...(patch.titleBoost ?? {}) },
    skillBoost: { ...current.skillBoost, ...(patch.skillBoost ?? {}) },
    blockedCompanies: patch.blockedCompanies ?? current.blockedCompanies,
    blockedTitleTokens: patch.blockedTitleTokens ?? current.blockedTitleTokens,
    eventCounts: { ...current.eventCounts, ...(patch.eventCounts ?? {}) },
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeCompanyKey(company: string | null | undefined): string {
  return (company ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function tokenizeJobTitle(title: string | null | undefined): string[] {
  if (!title?.trim()) {
    return [];
  }
  return title
    .toLowerCase()
    .replace(/[^a-z0-9+\-#/.\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_TITLE_TOKENS.has(token));
}

export function jobSkillTokens(job: CareerJob): string[] {
  const fromRequired = Array.isArray(job.requiredSkills)
    ? (job.requiredSkills as unknown[]).map((s) => normalizeSkillToken(String(s))).filter(Boolean)
    : [];
  return [...new Set(fromRequired)].slice(0, 12);
}

export function computeLearningAdjustment(
  job: CareerJob,
  prefs: MatchLearningPrefs,
  maxAdjust: number,
): { adjustment: number; reasons: string[] } {
  const reasons: string[] = [];
  let adj = 0;
  const company = normalizeCompanyKey(job.company);

  if (company && prefs.blockedCompanies.includes(company)) {
    return {
      adjustment: -maxAdjust,
      reasons: ['Previously dismissed this employer'],
    };
  }

  if (company) {
    const companyBoost = prefs.companyBoost[company] ?? 0;
    if (companyBoost !== 0) {
      adj += companyBoost;
      reasons.push(
        companyBoost > 0
          ? `Preferred employer (+${companyBoost})`
          : `Less preferred employer (${companyBoost})`,
      );
    }
  }

  for (const token of tokenizeJobTitle(job.title)) {
    if (prefs.blockedTitleTokens.includes(token)) {
      adj -= 4;
      reasons.push(`Skipped similar role: ${token}`);
      continue;
    }
    const titleBoost = prefs.titleBoost[token] ?? 0;
    if (titleBoost !== 0) {
      adj += titleBoost;
    }
  }

  for (const skill of jobSkillTokens(job)) {
    const skillBoost = prefs.skillBoost[skill] ?? 0;
    if (skillBoost > 0) {
      adj += Math.min(3, skillBoost);
    } else if (skillBoost < 0) {
      adj += Math.max(-2, skillBoost);
    }
  }

  adj = Math.max(-maxAdjust, Math.min(maxAdjust, Math.round(adj)));
  return { adjustment: adj, reasons: [...new Set(reasons)].slice(0, 3) };
}

export function learningPatchForPositiveSignal(job: CareerJob): Partial<MatchLearningPrefs> {
  const company = normalizeCompanyKey(job.company);
  const companyBoost: Record<string, number> = {};
  if (company) {
    companyBoost[company] = 4;
  }

  const titleBoost: Record<string, number> = {};
  for (const token of tokenizeJobTitle(job.title)) {
    titleBoost[token] = 2;
  }

  const skillBoost: Record<string, number> = {};
  for (const skill of jobSkillTokens(job)) {
    skillBoost[skill] = 2;
  }

  return {
    companyBoost,
    titleBoost,
    skillBoost,
    eventCounts: { applied: 1, dismissed: 0, cover_letter: 0 },
  };
}

export function learningPatchForCoverLetter(job: CareerJob): Partial<MatchLearningPrefs> {
  const company = normalizeCompanyKey(job.company);
  const companyBoost: Record<string, number> = {};
  if (company) {
    companyBoost[company] = 2;
  }

  const titleBoost: Record<string, number> = {};
  for (const token of tokenizeJobTitle(job.title)) {
    titleBoost[token] = 1;
  }

  const skillBoost: Record<string, number> = {};
  for (const skill of jobSkillTokens(job).slice(0, 6)) {
    skillBoost[skill] = 1;
  }

  return {
    companyBoost,
    titleBoost,
    skillBoost,
    eventCounts: { applied: 0, dismissed: 0, cover_letter: 1 },
  };
}

export function learningPatchForDismiss(
  job: CareerJob,
  priorCompanyDismissals: number,
): Partial<MatchLearningPrefs> {
  const company = normalizeCompanyKey(job.company);
  const companyBoost: Record<string, number> = {};
  if (company) {
    companyBoost[company] = -5;
  }

  const titleBoost: Record<string, number> = {};
  const blockedTitleTokens = tokenizeJobTitle(job.title).slice(0, 4);
  for (const token of blockedTitleTokens) {
    titleBoost[token] = -3;
  }

  const blockedCompanies =
    company && priorCompanyDismissals >= 1 ? [company] : [];

  return {
    companyBoost,
    titleBoost,
    blockedCompanies,
    blockedTitleTokens,
    eventCounts: { applied: 0, dismissed: 1, cover_letter: 0 },
  };
}

const STOP_TITLE_TOKENS = new Set([
  'and',
  'for',
  'the',
  'with',
  'job',
  'role',
  'senior',
  'junior',
  'lead',
  'head',
  'intern',
  'trainee',
]);

function sanitizeBoostMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value);
    if (key && !Number.isNaN(n)) {
      out[key.toLowerCase()] = Math.max(-15, Math.min(15, Math.round(n)));
    }
  }
  return out;
}

function sanitizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return [...new Set(raw.map((v) => String(v).toLowerCase().trim()).filter(Boolean))].slice(0, 50);
}

function positiveInt(value: unknown): number {
  const n = Number(value);
  return Number.isNaN(n) || n < 0 ? 0 : Math.floor(n);
}

/** Merge boost maps with caps per key. */
export function accumulateBoostMaps(
  current: Record<string, number>,
  delta: Record<string, number>,
  cap: number,
): Record<string, number> {
  const out = { ...current };
  for (const [key, value] of Object.entries(delta)) {
    const next = (out[key] ?? 0) + value;
    out[key] = Math.max(-cap, Math.min(cap, next));
  }
  return out;
}
