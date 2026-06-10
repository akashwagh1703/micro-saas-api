/** Shared helpers for normalising and storing jobs from any CareerJobSource. */

export const JOB_SKILL_LIST = [
  'react', 'angular', 'vue', 'nodejs', 'node.js', 'nestjs', 'express',
  'typescript', 'javascript', 'python', 'java', 'php', 'laravel', 'django',
  'postgresql', 'mysql', 'mongodb', 'redis', 'aws', 'azure', 'gcp',
  'docker', 'kubernetes', 'git', 'html', 'css', 'tailwind', 'graphql',
  'rest', 'sql', 'linux', 'flutter', 'react native', 'kotlin', 'swift',
  'figma', 'excel', 'tally', 'salesforce', 'sap', 'photoshop',
];

/** External job sources whose listings expire on refresh cycles. */
export const EXTERNAL_JOB_SOURCES = ['adzuna', 'jsearch', 'naukri', 'linkedin'] as const;

/** Canonical skill tokens for matching and job normalization. */
export const SKILL_SYNONYMS: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  node: 'nodejs',
  'node.js': 'nodejs',
  reactjs: 'react',
  'react.js': 'react',
  vuejs: 'vue',
  nextjs: 'next.js',
  'next.js': 'next.js',
  postgres: 'postgresql',
  pg: 'postgresql',
  mongo: 'mongodb',
  k8s: 'kubernetes',
  kube: 'kubernetes',
  aws: 'aws',
  gcp: 'gcp',
  azure: 'azure',
};

export function normalizeSkillToken(skill: string): string {
  const trimmed = skill.toLowerCase().trim().replace(/\s+/g, ' ');
  return SKILL_SYNONYMS[trimmed] ?? trimmed;
}

export function normalizeSkillList(skills: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of skills) {
    const token = normalizeSkillToken(raw);
    if (token.length < 2 || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

export function extractSkillsFromDescription(description: string, title = ''): string[] {
  const lower = `${title} ${description}`.toLowerCase();
  return normalizeSkillList(JOB_SKILL_LIST.filter((s) => lower.includes(s)));
}

export type JobSeniority = 'junior' | 'mid' | 'senior' | 'lead' | 'unknown';

export function detectSeniority(title: string, description = ''): JobSeniority {
  const text = `${title} ${description}`.toLowerCase();
  if (/\b(principal|staff|director|head of|vp |vice president|chief)\b/.test(text)) {
    return 'lead';
  }
  if (/\b(lead|architect|manager)\b/.test(text)) {
    return 'lead';
  }
  if (/\b(senior|sr\.?)\b/.test(text)) {
    return 'senior';
  }
  if (/\b(junior|jr\.?|fresher|graduate|entry[\s-]?level|trainee|intern)\b/.test(text)) {
    return 'junior';
  }
  if (/\b(mid[\s-]?level|intermediate)\b/.test(text)) {
    return 'mid';
  }
  return 'unknown';
}

export type JobWorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown';

export function detectWorkMode(
  title: string,
  description = '',
  location = '',
  jobType = '',
): JobWorkMode {
  const text = `${title} ${description} ${location} ${jobType}`.toLowerCase();
  if (/\b(fully remote|100% remote|work from home|wfh|remote[\s-]?only)\b/.test(text)) {
    return 'remote';
  }
  if (/\bremote\b/.test(text) && !/\b(no remote|not remote|non[\s-]?remote)\b/.test(text)) {
    return 'remote';
  }
  if (/\bhybrid\b/.test(text)) {
    return 'hybrid';
  }
  if (/\b(on[\s-]?site|in[\s-]?office|office[\s-]?based)\b/.test(text)) {
    return 'onsite';
  }
  return 'unknown';
}

/** Parse Indian salary strings into raw INR (not LPA). */
export function parseSalaryFromText(text: string | null | undefined): {
  min: number | null;
  max: number | null;
} {
  if (!text?.trim()) {
    return { min: null, max: null };
  }

  const raw = text.replace(/,/g, '').toLowerCase();

  const lpaRange = raw.match(/(\d+(?:\.\d+)?)\s*(?:–|-|to)\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakh|lac|l\b)/i);
  if (lpaRange) {
    const min = Math.round(parseFloat(lpaRange[1]) * 100_000);
    const max = Math.round(parseFloat(lpaRange[2]) * 100_000);
    return { min, max };
  }

  const singleLpa = raw.match(/(\d+(?:\.\d+)?)\s*(?:lpa|lakh|lac|l\b)/i);
  if (singleLpa) {
    const val = Math.round(parseFloat(singleLpa[1]) * 100_000);
    return { min: val, max: val };
  }

  const inrRange = raw.match(/₹?\s*(\d+)\s*(?:–|-|to)\s*₹?\s*(\d+)/);
  if (inrRange) {
    let min = parseInt(inrRange[1], 10);
    let max = parseInt(inrRange[2], 10);
    if (min < 1000) {
      min *= 100_000;
      max *= 100_000;
    }
    return { min, max };
  }

  return { min: null, max: null };
}

export function mergeJobTags(
  existing: unknown,
  enrichment: { workMode?: JobWorkMode; seniority?: JobSeniority },
): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : { sourceTags: Array.isArray(existing) ? existing : [] };

  return {
    ...base,
    workMode: enrichment.workMode ?? base.workMode ?? 'unknown',
    seniority: enrichment.seniority ?? base.seniority ?? 'unknown',
  };
}

export function parseExperienceRange(description: string): { min?: number; max?: number } {
  const range = description.match(/(\d+)\s*[-–to]+\s*(\d+)\s*(?:\+?\s*)?(?:years?|yrs?|y\.?o\.?e\.?)/i);
  if (range) {
    return { min: parseInt(range[1], 10), max: parseInt(range[2], 10) };
  }

  const minimum = description.match(/(?:minimum|min\.?|at least)\s*(\d+)\s*(?:\+?\s*)?(?:years?|yrs?)/i);
  if (minimum) {
    return { min: parseInt(minimum[1], 10) };
  }

  const plus = description.match(/(\d+)\+\s*(?:years?|yrs?)/i);
  if (plus) {
    return { min: parseInt(plus[1], 10) };
  }

  return {};
}

export function formatSalaryInr(min: number | null, max: number | null): string | null {
  if (!min && !max) return null;
  const toDisplay = (n: number) =>
    n > 100_000 ? `₹${(n / 100_000).toFixed(1)}L` : `₹${n.toLocaleString()}`;
  if (min && max) return `${toDisplay(min)}–${toDisplay(max)} PA`;
  if (min) return `${toDisplay(min)}+ PA`;
  return null;
}

export function normalizeContractType(ct?: string | null): string | null {
  if (!ct) return null;
  const m = ct.toLowerCase();
  if (m.includes('full')) return 'full_time';
  if (m.includes('part')) return 'part_time';
  if (m.includes('contract') || m.includes('freelance')) return 'contract';
  return m;
}

export function thirtyDaysFromNow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

/** Truncate to fit PostgreSQL varchar limits on career_jobs. */
export function clipField(value: string | null | undefined, maxLen: number): string | null {
  if (!value) return null;
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

export function formatUpsertError(error: unknown): string {
  if (error instanceof Error) {
    const meta =
      'meta' in error && error.meta ? ` meta=${JSON.stringify(error.meta)}` : '';
    return `${error.message || error.name}${meta}`.trim();
  }
  return String(error);
}

/** Readable message for axios / network failures (RapidAPI, Adzuna, etc.). */
export function formatHttpError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return String(error);
  }

  const err = error as {
    message?: string;
    code?: string;
    hostname?: string;
    response?: { status?: number; data?: unknown };
  };

  const status = err.response?.status;
  const body = err.response?.data;

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const nested =
      record.error && typeof record.error === 'object'
        ? (record.error as Record<string, unknown>).message
        : null;
    const apiMessage =
      (typeof record.message === 'string' && record.message) ||
      (typeof nested === 'string' && nested) ||
      null;
    if (status && apiMessage) return `HTTP ${status}: ${apiMessage}`;
  }

  if (status) {
    return `HTTP ${status}: ${err.message ?? 'request failed'}`;
  }

  if (err.code === 'ENOTFOUND') {
    const host = err.hostname ?? 'remote host';
    return `DNS lookup failed for ${host} — check server internet/DNS, not a missing env var`;
  }

  if (err.code === 'ECONNREFUSED') {
    return `Connection refused — ${err.message ?? 'network blocked or wrong URL'}`;
  }

  return err.message ?? String(error);
}
