import { ParsedCareerProfile } from './career-parsed-profile.types';

export type FieldConfidence = 'high' | 'medium' | 'low';

export interface ParsedProfileValidation {
  fieldConfidence: Partial<Record<string, FieldConfidence>>;
  rejected: {
    skills?: string[];
    experience?: Array<{ title?: string; company?: string; reason: string }>;
    preferred_roles?: string[];
    education?: string[];
    certifications?: string[];
    projects?: string[];
    languages?: string[];
    fields?: string[];
  };
  validatedFieldCount: number;
  totalFieldCount: number;
  overallConfidence: FieldConfidence;
}

export interface ValidateParsedOptions {
  enabled?: boolean;
}

const COMPANY_SUFFIX =
  /\b(pvt\.?\s*ltd\.?|private limited|limited|ltd\.?|llp|inc\.?|corp\.?|corporation|technologies|technology|tech|solutions|services|consulting|private)\b/gi;

const GENERIC_JOB_TITLES =
  /^(intern|trainee|associate|consultant|engineer|developer|manager|analyst|specialist)$/i;

const SKILL_STOPWORDS = new Set([
  'experience',
  'education',
  'skills',
  'skill',
  'summary',
  'objective',
  'profile',
  'projects',
  'certifications',
  'present',
  'current',
  'employment',
  'work',
  'history',
]);

const DATE_OR_RANGE = /\d{4}\s*[-–—]|present|current/i;

const SKILL_ALIASES: Record<string, string[]> = {
  'node.js': ['node.js', 'nodejs', 'node js', 'node'],
  react: ['react', 'reactjs', 'react.js'],
  'vue.js': ['vue.js', 'vuejs', 'vue'],
  javascript: ['javascript', 'js'],
  typescript: ['typescript', 'ts'],
  postgresql: ['postgresql', 'postgres'],
  mongodb: ['mongodb', 'mongo'],
  mysql: ['mysql'],
  'spring boot': ['spring boot', 'springboot'],
  'rest apis': ['rest api', 'rest apis', 'restful'],
  '.net': ['.net', 'dotnet', 'dot net'],
  'c#': ['c#', 'csharp'],
  'c++': ['c++', 'cpp'],
};

/** Strip AI/heuristic fields that cannot be found in extracted resume text (R2). */
export function validateParsedProfile(
  parsed: ParsedCareerProfile,
  sourceText: string,
  options?: ValidateParsedOptions,
): { profile: ParsedCareerProfile; validation: ParsedProfileValidation } {
  if (options?.enabled === false || !sourceText?.trim()) {
    return {
      profile: parsed,
      validation: emptyValidation(parsed),
    };
  }

  const blob = normalizeSourceBlob(sourceText);
  const out: ParsedCareerProfile = { ...parsed };
  const fieldConfidence: ParsedProfileValidation['fieldConfidence'] = {};
  const rejected: ParsedProfileValidation['rejected'] = {};

  if (out.full_name) {
    const conf = scoreNameConfidence(out.full_name, blob);
    fieldConfidence.full_name = conf;
    if (conf === 'low') {
      out.full_name = undefined;
      rejected.fields = [...(rejected.fields ?? []), 'full_name'];
    }
  }

  if (out.email) {
    const conf = emailInSource(out.email, blob) ? 'high' : 'low';
    fieldConfidence.email = conf;
    if (conf === 'low') {
      out.email = undefined;
      rejected.fields = [...(rejected.fields ?? []), 'email'];
    }
  }

  if (out.phone) {
    const conf = phoneInSource(out.phone, sourceText) ? 'high' : 'low';
    fieldConfidence.phone = conf;
    if (conf === 'low') {
      out.phone = undefined;
      rejected.fields = [...(rejected.fields ?? []), 'phone'];
    }
  }

  if (out.current_location) {
    const conf = locationInSource(out.current_location, blob) ? 'high' : 'medium';
    fieldConfidence.current_location = conf;
    if (conf === 'medium' && !locationInSource(out.current_location, blob, true)) {
      out.current_location = undefined;
      rejected.fields = [...(rejected.fields ?? []), 'current_location'];
    }
  }

  if (out.skills?.length) {
    const kept: string[] = [];
    const dropped: string[] = [];
    for (const skill of out.skills) {
      if (skillInSource(skill, blob, sourceText)) {
        kept.push(skill);
      } else {
        dropped.push(skill);
      }
    }
    out.skills = kept.length > 0 ? kept : undefined;
    if (dropped.length > 0) {
      rejected.skills = dropped;
    }
    fieldConfidence.skills = kept.length > 0 ? (dropped.length === 0 ? 'high' : 'medium') : 'low';
  }

  if (out.experience?.length) {
    const kept: NonNullable<ParsedCareerProfile['experience']> = [];
    const dropped: NonNullable<ParsedProfileValidation['rejected']['experience']> = [];
    for (const entry of out.experience) {
      const support = scoreExperienceSupport(entry, blob);
      if (support.supported) {
        kept.push(entry);
      } else {
        dropped.push({
          title: entry.title,
          company: entry.company,
          reason: support.reason,
        });
      }
    }
    out.experience = kept.length > 0 ? kept : undefined;
    if (dropped.length > 0) {
      rejected.experience = dropped;
    }
    fieldConfidence.experience = kept.length > 0 ? (dropped.length === 0 ? 'high' : 'medium') : 'low';
  }

  if (out.preferred_roles?.length) {
    const kept: string[] = [];
    const dropped: string[] = [];
    for (const role of out.preferred_roles) {
      if (roleInSource(role, blob, out.experience ?? [])) {
        kept.push(role);
      } else {
        dropped.push(role);
      }
    }
    out.preferred_roles = kept.length > 0 ? kept : undefined;
    if (dropped.length > 0) {
      rejected.preferred_roles = dropped;
    }
    fieldConfidence.preferred_roles =
      kept.length > 0 ? (dropped.length === 0 ? 'high' : 'medium') : 'low';
  } else if (out.experience?.length) {
    out.preferred_roles = out.experience
      .map((e) => e.title)
      .filter((t): t is string => Boolean(t?.trim()))
      .slice(0, 3);
  }

  if (out.education?.length) {
    const kept: NonNullable<ParsedCareerProfile['education']> = [];
    const dropped: string[] = [];
    for (const edu of out.education) {
      if (educationInSource(edu, blob)) {
        kept.push(edu);
      } else {
        dropped.push(edu.degree ?? edu.institution ?? 'education');
      }
    }
    out.education = kept.length > 0 ? kept : undefined;
    if (dropped.length > 0) {
      rejected.education = dropped;
    }
  }

  for (const key of ['certifications', 'projects', 'languages'] as const) {
    const values = out[key];
    if (!values?.length) continue;
    const kept: string[] = [];
    const dropped: string[] = [];
    for (const item of values) {
      if (phraseInSource(item, blob)) {
        kept.push(item);
      } else {
        dropped.push(item);
      }
    }
    out[key] = kept.length > 0 ? kept : undefined;
    if (dropped.length > 0) {
      rejected[key] = dropped;
    }
  }

  for (const key of ['current_salary', 'expected_salary', 'notice_period', 'work_preference'] as const) {
    const value = out[key];
    if (!value?.trim()) continue;
    const conf = labeledValueInSource(value, blob, key) ? 'high' : 'low';
    fieldConfidence[key] = conf;
    if (conf === 'low') {
      out[key] = undefined;
      rejected.fields = [...(rejected.fields ?? []), key];
    }
  }

  if (out.preferred_locations?.length) {
    const kept = out.preferred_locations.filter((loc) => locationInSource(loc, blob));
    out.preferred_locations = kept.length > 0 ? kept : undefined;
  }

  const validation = buildValidationSummary(fieldConfidence, rejected);
  return { profile: out, validation };
}

export function formatValidationHint(validation: ParsedProfileValidation | null): string | null {
  if (!validation) return null;
  const notes: string[] = [];
  if (validation.rejected.skills?.length) {
    notes.push(`${validation.rejected.skills.length} skill(s) not found in your resume text`);
  }
  if (validation.rejected.experience?.length) {
    notes.push(`${validation.rejected.experience.length} job(s) removed (not in resume text)`);
  }
  if (validation.rejected.preferred_roles?.length) {
    notes.push(`${validation.rejected.preferred_roles.length} target role(s) not found in resume text`);
  }
  if (notes.length === 0) return null;
  return `_Note: ${notes.join('; ')}. I'll ask if anything is missing._`;
}

function emptyValidation(parsed: ParsedCareerProfile): ParsedProfileValidation {
  const keys = Object.keys(parsed).filter((k) => {
    const v = (parsed as Record<string, unknown>)[k];
    return v != null && (!Array.isArray(v) || v.length > 0);
  });
  return {
    fieldConfidence: {},
    rejected: {},
    validatedFieldCount: keys.length,
    totalFieldCount: keys.length,
    overallConfidence: 'high',
  };
}

function buildValidationSummary(
  fieldConfidence: ParsedProfileValidation['fieldConfidence'],
  rejected: ParsedProfileValidation['rejected'],
): ParsedProfileValidation {
  const scores = Object.values(fieldConfidence).map(confidenceToScore);
  const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 1;
  const rejectionCount =
    (rejected.skills?.length ?? 0) +
    (rejected.experience?.length ?? 0) +
    (rejected.preferred_roles?.length ?? 0) +
    (rejected.fields?.length ?? 0);

  return {
    fieldConfidence,
    rejected,
    validatedFieldCount: scores.filter((s) => s >= 0.5).length,
    totalFieldCount: scores.length,
    overallConfidence: avg >= 0.85 && rejectionCount === 0 ? 'high' : avg >= 0.55 ? 'medium' : 'low',
  };
}

function confidenceToScore(conf: FieldConfidence): number {
  if (conf === 'high') return 1;
  if (conf === 'medium') return 0.7;
  return 0.2;
}

function normalizeSourceBlob(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function scoreNameConfidence(name: string, blob: string): FieldConfidence {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return 'low';
  const hits = tokens.filter((t) => blob.includes(t)).length;
  if (hits === tokens.length) return 'high';
  if (hits >= Math.min(2, tokens.length)) return 'medium';
  return 'low';
}

function emailInSource(email: string, blob: string): boolean {
  return blob.includes(email.toLowerCase().trim());
}

function phoneInSource(phone: string, sourceText: string): boolean {
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (digits.length < 10) return false;
  return sourceText.replace(/\D/g, '').includes(digits);
}

function locationInSource(location: string, blob: string, strict = false): boolean {
  const loc = location.toLowerCase().trim();
  if (!loc) return false;
  if (blob.includes(loc)) return true;
  const tokens = loc.split(/\s+/).filter((t) => t.length >= 3);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((t) => blob.includes(t)).length;
  return strict ? hits === tokens.length : hits >= 1;
}

function phraseInSource(phrase: string, blob: string): boolean {
  const p = phrase.toLowerCase().trim();
  if (!p) return false;
  if (blob.includes(p)) return true;
  const tokens = p.split(/\s+/).filter((t) => t.length > 2);
  if (tokens.length >= 2) {
    return tokens.every((t) => blob.includes(t));
  }
  return p.length >= 4 && blob.includes(p);
}

function skillInSource(skill: string, blob: string, rawText: string): boolean {
  const lower = skill.toLowerCase().trim();
  if (!lower || lower.length > 35) return false;
  if (SKILL_STOPWORDS.has(lower)) return false;
  if (DATE_OR_RANGE.test(skill)) return false;
  if (/\s+at\s+/i.test(skill)) return false;
  if (lower.split(/\s+/).length > 4) return false;
  if (/^(skills?|experience|education|summary|objective)[:\s]/i.test(skill)) return false;

  if (blob.includes(lower)) {
    if (lower.length <= 25 && !/\s+at\s+/i.test(skill) && !DATE_OR_RANGE.test(skill)) {
      return true;
    }
    return !looksLikeResumeLine(skill, blob);
  }

  const compactBlob = blob.replace(/[^a-z0-9+# ]/g, '');
  const compactSkill = lower.replace(/[^a-z0-9+# ]/g, '').replace(/\s+/g, '');
  if (compactSkill.length >= 2 && compactBlob.replace(/\s+/g, '').includes(compactSkill)) {
    return true;
  }

  const aliases = SKILL_ALIASES[lower] ?? [];
  for (const alias of aliases) {
    if (blob.includes(alias) || rawText.toLowerCase().includes(alias)) {
      return true;
    }
  }

  const tokens = lower.split(/\s+/).filter((t) => t.length > 2);
  if (tokens.length >= 2) {
    return tokens.every((t) => blob.includes(t));
  }

  return false;
}

function normalizeCompanyKey(company: string): string {
  return company
    .toLowerCase()
    .replace(COMPANY_SUFFIX, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function companyInSource(company: string, blob: string): boolean {
  const norm = company.toLowerCase().trim();
  if (!norm) return false;
  if (blob.includes(norm)) return true;

  const key = normalizeCompanyKey(company);
  if (key.length >= 4) {
    const compactBlob = blob.replace(/[^a-z0-9]/g, '');
    if (compactBlob.includes(key)) return true;
  }

  const tokens = norm
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !COMPANY_SUFFIX.test(t));
  return tokens.some((t) => blob.includes(t));
}

function titleInSource(title: string, blob: string): boolean {
  const norm = title.toLowerCase().trim();
  if (!norm) return false;
  if (blob.includes(norm)) return true;

  const tokens = norm.split(/\s+/).filter((t) => t.length > 2);
  if (tokens.length >= 2) {
    return tokens.every((t) => blob.includes(t));
  }

  return norm.length >= 5 && blob.includes(norm);
}

function scoreExperienceSupport(
  entry: NonNullable<ParsedCareerProfile['experience']>[number],
  blob: string,
): { supported: boolean; reason: string } {
  const company = entry.company?.trim();
  const title = entry.title?.trim();
  const companyOk = company ? companyInSource(company, blob) : false;
  const titleOk = title ? titleInSource(title, blob) : false;

  if (companyOk) {
    return { supported: true, reason: 'company_in_source' };
  }
  if (titleOk && !company) {
    return { supported: true, reason: 'title_in_source' };
  }
  if (titleOk && company && !companyOk) {
    if (title && GENERIC_JOB_TITLES.test(title)) {
      return { supported: false, reason: 'generic_title_without_company' };
    }
    return { supported: true, reason: 'title_in_source' };
  }
  if (!company && !title) {
    return { supported: false, reason: 'empty_entry' };
  }
  return { supported: false, reason: 'not_in_source_text' };
}

function roleInSource(
  role: string,
  blob: string,
  experience: NonNullable<ParsedCareerProfile['experience']>,
): boolean {
  const trimmed = role.trim();
  if (!trimmed || trimmed.length > 70) return false;
  if (/^(skills?|experience|education|summary|objective|contact)[:\s]/i.test(trimmed)) {
    return false;
  }
  if (DATE_OR_RANGE.test(trimmed) || /\s+at\s+/i.test(trimmed)) return false;
  if (titleInSource(trimmed, blob)) return true;
  return experience.some((e) => e.title && fuzzyRoleMatch(role, e.title));
}

function looksLikeResumeLine(skill: string, blob: string): boolean {
  const lower = skill.toLowerCase();
  if (/\s+at\s+/.test(lower)) return true;
  if (DATE_OR_RANGE.test(skill)) return true;

  const idx = blob.indexOf(lower);
  if (idx < 0) return false;
  const lineStart = blob.lastIndexOf('\n', idx) + 1;
  const lineEnd = blob.indexOf('\n', idx);
  const line = blob.slice(lineStart, lineEnd >= 0 ? lineEnd : undefined).trim();

  if (/^(experience|education|skills?|summary|objective|work history)$/i.test(line)) {
    return true;
  }
  if (/\s+at\s+/i.test(line) && line.toLowerCase().includes(lower)) {
    return true;
  }
  if (DATE_OR_RANGE.test(line) && line.length <= 30) {
    return true;
  }
  if (line.toLowerCase() === lower && line.split(/\s+/).length > 5) {
    return true;
  }
  return false;
}

function fuzzyRoleMatch(a: string, b: string): boolean {
  const left = a.toLowerCase().trim();
  const right = b.toLowerCase().trim();
  return left === right || left.includes(right) || right.includes(left);
}

function educationInSource(
  edu: NonNullable<ParsedCareerProfile['education']>[number],
  blob: string,
): boolean {
  const degreeOk = edu.degree ? phraseInSource(edu.degree, blob) : false;
  const instOk = edu.institution ? phraseInSource(edu.institution, blob) : false;
  return degreeOk || instOk;
}

function labeledValueInSource(value: string, blob: string, field: string): boolean {
  const v = value.toLowerCase().replace(/\s+/g, ' ').trim();
  if (blob.includes(v)) return true;

  const label =
    field === 'current_salary'
      ? 'salary'
      : field === 'expected_salary'
        ? 'expected salary'
        : field === 'notice_period'
          ? 'notice'
          : 'work';

  const idx = blob.indexOf(label);
  if (idx >= 0) {
    const window = blob.slice(idx, idx + 80);
    const digits = v.replace(/[^0-9.]/g, '');
    if (digits && window.includes(digits)) return true;
  }

  return false;
}
