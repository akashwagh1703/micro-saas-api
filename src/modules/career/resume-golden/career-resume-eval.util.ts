import { ParsedCareerProfile } from '../career-parsed-profile.types';
import {
  extractBasicFieldsFromResume,
  mergeParsedProfiles,
  normalizeRawAiParse,
} from '../career-resume-parse.util';
import {
  CaseEvalResult,
  EvalPipelineMode,
  FieldScore,
  GoldenEvalReport,
  GoldenResumeCase,
  GoldenResumeExpectation,
} from './career-resume-eval.types';

const FIELD_WEIGHTS: Record<string, number> = {
  full_name: 1.5,
  email: 1.2,
  phone: 1.2,
  skills: +2,
  experience: 2,
  current_location: 1,
  preferred_roles: 1,
  current_salary: 0.5,
  expected_salary: 0.5,
  notice_period: 0.5,
  work_preference: 0.5,
};

export function runPipeline(caseDef: GoldenResumeCase, mode: EvalPipelineMode): ParsedCareerProfile | null {
  const text = caseDef.extracted_text;
  const basic = extractBasicFieldsFromResume(text);
  const ai = caseDef.mock_ai ? normalizeRawAiParse(caseDef.mock_ai) ?? caseDef.mock_ai : null;

  switch (mode) {
    case 'heuristic':
      return mergeParsedProfiles(null, basic, text);
    case 'ai-only':
      return ai ? mergeParsedProfiles(ai, null, text) : null;
    case 'merged':
    default:
      return mergeParsedProfiles(ai, basic, text);
  }
}

export function evaluateCase(
  caseDef: GoldenResumeCase,
  parsed: ParsedCareerProfile | null,
  pipeline: EvalPipelineMode,
): CaseEvalResult {
  const optional = new Set(caseDef.optional_fields ?? []);
  const fieldScores: FieldScore[] = [];

  if (!parsed) {
    return {
      id: caseDef.id,
      description: caseDef.description,
      tags: caseDef.tags ?? [],
      pipeline,
      fieldScores: [{ field: '_parse', score: 0, note: 'Parser returned null' }],
      overallScore: 0,
    };
  }

  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const key = field as keyof GoldenResumeExpectation;
    if (optional.has(key)) {
      fieldScores.push({ field, score: 1, skipped: true, note: 'optional' });
      continue;
    }

    const expected = caseDef.expected[key];
    if (expected === undefined || expected === null || (Array.isArray(expected) && expected.length === 0)) {
      fieldScores.push({ field, score: 1, skipped: true, note: 'not in expected' });
      continue;
    }

    const score = scoreField(key, expected, parsed);
    fieldScores.push({ ...score, field });
    void weight;
  }

  const skillsScore = fieldScores.find((f) => f.field === 'skills');
  const expScore = fieldScores.find((f) => f.field === 'experience');

  return {
    id: caseDef.id,
    description: caseDef.description,
    tags: caseDef.tags ?? [],
    pipeline,
    fieldScores,
    overallScore: weightedOverall(fieldScores),
    skillsRecall: skillsScore?.note?.includes('recall=')
      ? parseFloat(skillsScore.note.split('recall=')[1]?.split(',')[0] ?? '0')
      : undefined,
    skillsPrecision: skillsScore?.note?.includes('precision=')
      ? parseFloat(skillsScore.note.split('precision=')[1] ?? '0')
      : undefined,
    experienceMatchRate: expScore?.score,
  };
}

export function buildReport(
  cases: CaseEvalResult[],
  pipeline: EvalPipelineMode,
): GoldenEvalReport {
  const evaluatedFields: Record<string, { total: number; count: number }> = {};
  const tagBuckets: Record<string, { total: number; count: number }> = {};

  for (const c of cases) {
    for (const tag of c.tags) {
      if (!tagBuckets[tag]) tagBuckets[tag] = { total: 0, count: 0 };
      tagBuckets[tag].total += c.overallScore;
      tagBuckets[tag].count += 1;
    }

    for (const fs of c.fieldScores) {
      if (fs.skipped) continue;
      if (!evaluatedFields[fs.field]) evaluatedFields[fs.field] = { total: 0, count: 0 };
      evaluatedFields[fs.field].total += fs.score;
      evaluatedFields[fs.field].count += 1;
    }
  }

  const byField: GoldenEvalReport['aggregates']['byField'] = {};
  for (const [field, bucket] of Object.entries(evaluatedFields)) {
    byField[field] = {
      avgScore: bucket.count > 0 ? round(bucket.total / bucket.count) : 0,
      evaluated: bucket.count,
    };
  }

  const byTag: GoldenEvalReport['aggregates']['byTag'] = {};
  for (const [tag, bucket] of Object.entries(tagBuckets)) {
    byTag[tag] = {
      avgScore: bucket.count > 0 ? round(bucket.total / bucket.count) : 0,
      count: bucket.count,
    };
  }

  const overallScore =
    cases.length > 0 ? round(cases.reduce((s, c) => s + c.overallScore, 0) / cases.length) : 0;

  return {
    runAt: new Date().toISOString(),
    pipeline,
    caseCount: cases.length,
    cases,
    aggregates: { overallScore, byField, byTag },
  };
}

function scoreField(
  field: keyof GoldenResumeExpectation,
  expected: unknown,
  parsed: ParsedCareerProfile,
): Omit<FieldScore, 'field'> {
  switch (field) {
    case 'full_name':
      return scoreName(String(expected), parsed.full_name);
    case 'email':
      return scoreExact(String(expected).toLowerCase(), (parsed.email ?? '').toLowerCase());
    case 'phone':
      return scorePhone(String(expected), parsed.phone);
    case 'current_location':
      return scoreLocation(String(expected), parsed.current_location);
    case 'skills':
      return scoreSkills(expected as string[], parsed.skills ?? []);
    case 'experience':
      return scoreExperience(
        expected as GoldenResumeExpectation['experience'],
        parsed.experience ?? [],
      );
    case 'preferred_roles':
      return scoreStringSet(expected as string[], parsed.preferred_roles ?? [], 0.6);
    case 'current_salary':
    case 'expected_salary':
    case 'notice_period':
    case 'work_preference':
      return scoreFuzzyString(String(expected), String((parsed as Record<string, unknown>)[field] ?? ''));
    default:
      return { score: 1, skipped: true, note: 'unsupported field' };
  }
}

function scoreName(expected: string, actual?: string): Omit<FieldScore, 'field'> {
  if (!actual?.trim()) {
    return { score: 0, expected, actual, note: 'missing' };
  }
  const e = normalizeName(expected);
  const a = normalizeName(actual);
  if (e === a) {
    return { score: 1, expected, actual };
  }
  const eTokens = e.split(/\s+/);
  const aTokens = a.split(/\s+/);
  const overlap = eTokens.filter((t) => aTokens.includes(t)).length;
  const score = overlap >= Math.min(2, eTokens.length) ? 0.85 : overlap >= 1 ? 0.5 : 0;
  return { score, expected, actual, note: score < 1 ? 'partial name match' : undefined };
}

function scoreExact(expected: string, actual: string): Omit<FieldScore, 'field'> {
  const score = expected && actual && expected === actual ? 1 : 0;
  return { score, expected, actual: actual || undefined };
}

function scorePhone(expected: string, actual?: string): Omit<FieldScore, 'field'> {
  const e = digits(expected).slice(-10);
  const a = digits(actual ?? '').slice(-10);
  const score = e.length === 10 && e === a ? 1 : 0;
  return { score, expected, actual };
}

function scoreLocation(expected: string, actual?: string): Omit<FieldScore, 'field'> {
  if (!actual?.trim()) {
    return { score: 0, expected, actual, note: 'missing' };
  }
  const e = expected.toLowerCase();
  const a = actual.toLowerCase();
  if (a.includes(e) || e.includes(a)) {
    return { score: 1, expected, actual };
  }
  return { score: 0, expected, actual, note: 'location mismatch' };
}

function scoreSkills(expected: string[], actual: string[]): Omit<FieldScore, 'field'> {
  const exp = new Set(expected.map(normalizeSkillKey));
  const act = new Set(actual.map(normalizeSkillKey));
  let hit = 0;
  for (const skill of exp) {
    if (act.has(skill)) hit += 1;
  }
  const recall = exp.size > 0 ? hit / exp.size : 1;
  let precisionHits = 0;
  for (const skill of act) {
    if (exp.has(skill)) precisionHits += 1;
  }
  const precision = act.size > 0 ? precisionHits / act.size : 1;
  const score = round(recall * 0.7 + precision * 0.3);
  return {
    score,
    expected,
    actual,
    note: `recall=${round(recall)},precision=${round(precision)}`,
  };
}

function scoreExperience(
  expected: GoldenResumeExpectation['experience'],
  actual: ParsedCareerProfile['experience'],
): Omit<FieldScore, 'field'> {
  if (!expected?.length) {
    return { score: 1, skipped: true, note: 'not in expected' };
  }
  const jobs = actual ?? [];
  let matched = 0;
  for (const exp of expected) {
    const found = jobs.some((job) => {
      const titleOk = fuzzyContains(job.title ?? '', exp.title);
      const companyOk = !exp.company || fuzzyContains(job.company ?? '', exp.company);
      return titleOk && companyOk;
    });
    if (found) matched += 1;
  }
  const score = round(matched / expected.length);
  return { score, expected, actual: jobs, note: `${matched}/${expected.length} jobs matched` };
}

function scoreStringSet(
  expected: string[],
  actual: string[],
  threshold: number,
): Omit<FieldScore, 'field'> {
  const exp = expected.map((s) => s.toLowerCase());
  const act = actual.map((s) => s.toLowerCase());
  let hit = 0;
  for (const e of exp) {
    if (act.some((a) => a.includes(e) || e.includes(a))) hit += 1;
  }
  const score = exp.length > 0 ? hit / exp.length : 1;
  return {
    score: score >= threshold ? 1 : round(score),
    expected,
    actual,
    note: `${hit}/${exp.length} roles matched`,
  };
}

function scoreFuzzyString(expected: string, actual: string): Omit<FieldScore, 'field'> {
  if (!expected.trim()) return { score: 1, skipped: true };
  if (!actual.trim()) return { score: 0, expected, actual, note: 'missing' };
  const e = expected.toLowerCase().replace(/\s+/g, '');
  const a = actual.toLowerCase().replace(/\s+/g, '');
  if (a.includes(e) || e.includes(a)) return { score: 1, expected, actual };
  return { score: 0, expected, actual };
}

function weightedOverall(fieldScores: FieldScore[]): number {
  let total = 0;
  let weight = 0;
  for (const fs of fieldScores) {
    if (fs.skipped) continue;
    const w = FIELD_WEIGHTS[fs.field] ?? 1;
    total += fs.score * w;
    weight += w;
  }
  return weight > 0 ? round(total / weight) : 0;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeSkillKey(skill: string): string {
  return skill.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function fuzzyContains(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  return h.includes(n) || n.split(/\s+/).every((token) => token.length > 2 && h.includes(token));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function formatReportTable(report: GoldenEvalReport): string {
  const lines: string[] = [];
  lines.push(`Resume golden eval — pipeline=${report.pipeline} — ${report.runAt}`);
  lines.push(`Cases: ${report.caseCount} | Overall: ${pct(report.aggregates.overallScore)}`);
  lines.push('');
  lines.push('Per case:');
  for (const c of report.cases) {
    const fails = c.fieldScores.filter((f) => !f.skipped && f.score < 0.8);
    const failNote = fails.length > 0 ? ` | weak: ${fails.map((f) => f.field).join(', ')}` : '';
    lines.push(`  ${c.id.padEnd(28)} ${pct(c.overallScore)}${failNote}`);
  }
  lines.push('');
  lines.push('By field (avg):');
  for (const [field, stat] of Object.entries(report.aggregates.byField).sort(
    (a, b) => a[1].avgScore - b[1].avgScore,
  )) {
    lines.push(`  ${field.padEnd(18)} ${pct(stat.avgScore)} (n=${stat.evaluated})`);
  }
  if (Object.keys(report.aggregates.byTag).length > 0) {
    lines.push('');
    lines.push('By tag:');
    for (const [tag, stat] of Object.entries(report.aggregates.byTag)) {
      lines.push(`  ${tag.padEnd(18)} ${pct(stat.avgScore)} (n=${stat.count})`);
    }
  }
  return lines.join('\n');
}

function pct(score: number): string {
  return `${Math.round(score * 100)}%`;
}
