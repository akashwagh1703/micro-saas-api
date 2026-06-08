/** Shared helpers for normalising and storing jobs from any CareerJobSource. */

export const JOB_SKILL_LIST = [
  'react', 'angular', 'vue', 'nodejs', 'node.js', 'nestjs', 'express',
  'typescript', 'javascript', 'python', 'java', 'php', 'laravel', 'django',
  'postgresql', 'mysql', 'mongodb', 'redis', 'aws', 'azure', 'gcp',
  'docker', 'kubernetes', 'git', 'html', 'css', 'tailwind', 'graphql',
  'rest', 'sql', 'linux', 'flutter', 'react native', 'kotlin', 'swift',
  'figma', 'excel', 'tally', 'salesforce', 'sap', 'photoshop',
];

export function extractSkillsFromDescription(description: string): string[] {
  const lower = description.toLowerCase();
  return JOB_SKILL_LIST.filter((s) => lower.includes(s));
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

/** External job sources whose listings expire on refresh cycles. */
export const EXTERNAL_JOB_SOURCES = ['adzuna', 'naukri', 'linkedin'] as const;
